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

export async function runImport(
  rest: string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
): Promise<number> {
  const { dirArg: parsedDirArg, nameArg } = parseImportArgs(rest);
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

  const artifacts = indexArtifacts(dirArg);
  if (artifacts.length === 0) {
    throw new UsageError(`umbel import: no artifacts found under ${dirArg}`);
  }

  const roots = artifactRoots(env);
  const bundlePath = join(userBundlesDir(env), `${name}.md`);
  if (existsSync(bundlePath)) {
    throw new ConflictError(`umbel import: bundle '${name}' already exists at ${bundlePath}`);
  }
  for (const kind of ARTIFACT_KINDS) {
    const poolDir = join(roots[kind], name);
    if (existsSync(poolDir)) {
      throw new ConflictError(
        `umbel import: '${name}' already exists in the ${kind} pool at ${poolDir} (pass a different name)`,
      );
    }
  }

  const refs: Record<ArtifactKind, string[]> = { skills: [], agents: [], hooks: [], mcps: [] };
  for (const a of artifacts) refs[a.kind].push(`${name}/${a.leaf}`);
  const description = umbelMeta?.description ?? pluginJson.description;

  // Atomic: the conflict checks proved none of these paths pre-existed, so on any
  // failure mid-copy we can safely remove everything we created — otherwise a
  // partial pool dir would block every future import of this name.
  try {
    for (const a of artifacts) {
      const dest = join(roots[a.kind], name, a.leaf);
      cpSync(a.dir, dest, { recursive: true, dereference: true });
    }
    mkdirSync(userBundlesDir(env), { recursive: true });
    writeFileSync(
      bundlePath,
      renderImportedManifest({
        name,
        ...(description !== undefined ? { description } : {}),
        refs,
        ...(umbelMeta?.settings !== undefined ? { settings: umbelMeta.settings } : {}),
        ...(umbelMeta?.mergeMcp !== undefined ? { mergeMcp: umbelMeta.mergeMcp } : {}),
      }),
    );
  } catch (e) {
    for (const kind of ARTIFACT_KINDS)
      rmSync(join(roots[kind], name), { recursive: true, force: true });
    rmSync(bundlePath, { force: true });
    throw e;
  }

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
  return `---\n${stringify(fm, { lineWidth: 0 })}---\n`;
}

function parseImportArgs(rest: string[]): { dirArg: string; nameArg?: string } {
  const positionals: string[] = [];
  let yes = false;
  for (const a of rest) {
    if (a === "--yes") yes = true;
    else if (a.startsWith("-")) throw new UsageError(`umbel import: unknown flag: ${a}`);
    else positionals.push(a);
  }
  void yes; // consumed by the trust gate in the next task
  const [dirArg, nameArg, extra] = positionals;
  if (dirArg === undefined)
    throw new UsageError("umbel import: directory required (umbel import <dir> [name])");
  if (extra !== undefined) throw new UsageError(`umbel import: unexpected argument: ${extra}`);
  return { dirArg, ...(nameArg !== undefined ? { nameArg } : {}) };
}
