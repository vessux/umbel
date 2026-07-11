import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { stringify } from "yaml";
import { artifactRoots, userBundlesDir } from "../bundle/env.ts";
import { ARTIFACT_KINDS, type ArtifactKind } from "../bundle/kinds.ts";
import { type BundleSettings, NAME_RE, loadManifest } from "../bundle/manifest.ts";
import { ConflictError, NotFoundError, UsageError } from "../errors.ts";
import { isInteractive } from "../tty.ts";
import { confirmExecTrust } from "../ui/prompt.ts";
import { gateTrust, planTrust } from "./trust.ts";

const MARKERS: Record<ArtifactKind, string> = {
  skills: "SKILL.md",
  agents: "AGENT.md",
  hooks: "HOOK.md",
  mcps: "MCP.md",
};

interface IndexedArtifact {
  kind: ArtifactKind;
  leaf: string;
  dir: string;
}

export interface ImportCoreOpts {
  dir: string;
  name: string;
  env: NodeJS.ProcessEnv;
  yes: boolean;
  description?: string;
  settings?: BundleSettings;
  mergeMcp?: boolean;
  headerComment?: string;
  what: string;
}

/**
 * Index `dir` for umbel-shaped artifacts, trust-gate its hook/MCP content, copy the
 * leaves into the pool under namespace = `name`, and mint a user-scope `<name>.md`
 * of bare `<name>/<leaf>` refs. Rolls back every created path on failure. Shared by
 * `import` and `adopt`.
 */
export async function importNormalizedDir(opts: ImportCoreOpts): Promise<IndexedArtifact[]> {
  const artifacts = indexArtifacts(opts.dir);
  if (artifacts.length === 0) {
    throw new UsageError(`umbel import: no artifacts found under ${opts.dir}`);
  }

  const roots = artifactRoots(opts.env);
  const bundlePath = join(userBundlesDir(opts.env), `${opts.name}.md`);
  for (const kind of ARTIFACT_KINDS) {
    const poolDir = join(roots[kind], opts.name);
    if (existsSync(poolDir)) {
      throw new ConflictError(
        `umbel import: '${opts.name}' already exists in the ${kind} pool at ${poolDir} (pass a different name)`,
      );
    }
  }

  const refs: Record<ArtifactKind, string[]> = { skills: [], agents: [], hooks: [], mcps: [] };
  for (const a of artifacts) refs[a.kind].push(`${opts.name}/${a.leaf}`);

  // Trust gate (ADR-0014): confirm new hook/MCP content before writing anything.
  await gateTrust({
    changes: planTrust(null, opts.dir),
    interactive: isInteractive(opts.env),
    yes: opts.yes,
    confirm: confirmExecTrust,
    write: (s) => process.stderr.write(s),
    what: opts.what,
  });

  // Copy artifacts into the pool, then mint the manifest. The pool conflict
  // checks proved those dirs didn't pre-exist, so on any failure we roll back
  // everything we created — otherwise a partial pool dir would block every
  // future import of this name.
  try {
    for (const a of artifacts) {
      const dest = join(roots[a.kind], opts.name, a.leaf);
      cpSync(a.dir, dest, { recursive: true, dereference: true });
    }
    mkdirSync(userBundlesDir(opts.env), { recursive: true });
    // Exclusive create ('wx') atomically fails if the manifest already exists,
    // rather than a check-then-write (a TOCTOU race); a pre-existing manifest is
    // a conflict we surface without clobbering it.
    writeFileSync(
      bundlePath,
      renderImportedManifest({
        name: opts.name,
        ...(opts.description !== undefined ? { description: opts.description } : {}),
        refs,
        ...(opts.settings !== undefined ? { settings: opts.settings } : {}),
        ...(opts.mergeMcp !== undefined ? { mergeMcp: opts.mergeMcp } : {}),
        ...(opts.headerComment !== undefined ? { headerComment: opts.headerComment } : {}),
      }),
      { flag: "wx" },
    );
  } catch (e) {
    for (const kind of ARTIFACT_KINDS)
      rmSync(join(roots[kind], opts.name), { recursive: true, force: true });
    if ((e as NodeJS.ErrnoException).code === "EEXIST") {
      throw new ConflictError(
        `umbel import: bundle '${opts.name}' already exists at ${bundlePath}`,
      );
    }
    // A non-EEXIST failure may have left a partial manifest we did create.
    rmSync(bundlePath, { force: true });
    throw e;
  }

  return artifacts;
}

export async function runImport(
  rest: string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
): Promise<number> {
  const { dirArg: parsedDirArg, nameArg, yes } = parseImportArgs(rest);
  const dirArg = resolve(cwd, parsedDirArg);
  if (!existsSync(dirArg)) {
    throw new NotFoundError(`umbel import: no such directory: ${dirArg}`);
  }
  const pluginJsonPath = join(dirArg, ".claude-plugin", "plugin.json");
  if (!existsSync(pluginJsonPath)) {
    throw new UsageError(
      `umbel import: ${dirArg} is not a plugin dir (no .claude-plugin/plugin.json)`,
    );
  }
  const pluginJson = readPluginJson(pluginJsonPath);
  const umbelMeta = readUmbelMeta(dirArg);

  const name = nameArg ?? umbelMeta?.name ?? pluginJson.name ?? basename(dirArg);
  if (!NAME_RE.test(name)) {
    throw new UsageError(
      `umbel import: invalid bundle name '${name}' (must match ${NAME_RE.source})`,
    );
  }

  const description = umbelMeta?.description ?? pluginJson.description;

  await importNormalizedDir({
    dir: dirArg,
    name,
    env,
    yes,
    ...(description !== undefined ? { description } : {}),
    ...(umbelMeta?.settings !== undefined ? { settings: umbelMeta.settings } : {}),
    ...(umbelMeta?.mergeMcp !== undefined ? { mergeMcp: umbelMeta.mergeMcp } : {}),
    what: `plugin '${name}' (import)`,
  });

  const bundlePath = join(userBundlesDir(env), `${name}.md`);
  process.stdout.write(`imported '${name}' from ${dirArg}\n`);
  process.stdout.write(`wrote ${bundlePath}\n`);
  process.stdout.write(`run: umbel apply ${name} && umbel run\n`);
  return 0;
}

function indexArtifacts(pluginDir: string): IndexedArtifact[] {
  const out: IndexedArtifact[] = [];
  for (const kind of ARTIFACT_KINDS) {
    const base = join(pluginDir, kind);
    let names: string[];
    try {
      names = readdirSync(base);
    } catch {
      continue;
    }
    for (const leaf of names.sort()) {
      const dir = join(base, leaf);
      if (existsSync(join(dir, MARKERS[kind]))) out.push({ kind, leaf, dir });
    }
  }
  return out;
}

function readPluginJson(path: string): { name?: string; description?: string } {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new UsageError(`umbel import: unreadable ${path}`);
  }
}

function readUmbelMeta(
  pluginDir: string,
):
  | { name: string; description?: string; settings?: BundleSettings; mergeMcp?: boolean }
  | undefined {
  const p = join(pluginDir, ".umbel", "bundle.md");
  if (!existsSync(p)) return undefined;
  const { manifest } = loadManifest(p);
  return {
    name: manifest.name,
    ...(manifest.description !== undefined ? { description: manifest.description } : {}),
    ...(manifest.settings !== undefined ? { settings: manifest.settings } : {}),
    ...(manifest.mergeMcp !== undefined ? { mergeMcp: manifest.mergeMcp } : {}),
  };
}

function renderImportedManifest(fields: {
  name: string;
  description?: string;
  refs: Record<ArtifactKind, string[]>;
  settings?: BundleSettings;
  mergeMcp?: boolean;
  headerComment?: string;
}): string {
  const fm: Record<string, unknown> = { name: fields.name };
  if (fields.description !== undefined) fm.description = fields.description;
  for (const kind of ARTIFACT_KINDS) {
    if (fields.refs[kind].length > 0) fm[kind] = fields.refs[kind];
  }
  if (fields.mergeMcp !== undefined) fm.mergeMcp = fields.mergeMcp;
  if (fields.settings !== undefined && Object.keys(fields.settings).length > 0) {
    fm.settings = fields.settings;
  }
  const header = fields.headerComment !== undefined ? `# ${fields.headerComment}\n` : "";
  return `---\n${header}${stringify(fm, { lineWidth: 0 })}---\n`;
}

function parseImportArgs(rest: string[]): { dirArg: string; nameArg?: string; yes: boolean } {
  const positionals: string[] = [];
  let yes = false;
  for (const a of rest) {
    if (a === "--yes") yes = true;
    else if (a.startsWith("-")) throw new UsageError(`umbel import: unknown flag: ${a}`);
    else positionals.push(a);
  }
  const [dirArg, nameArg, extra] = positionals;
  if (dirArg === undefined)
    throw new UsageError("umbel import: directory required (umbel import <dir> [name])");
  if (extra !== undefined) throw new UsageError(`umbel import: unexpected argument: ${extra}`);
  return { dirArg, yes, ...(nameArg !== undefined ? { nameArg } : {}) };
}
