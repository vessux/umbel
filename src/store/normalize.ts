import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { stringify as yamlStringify } from "yaml";
import { ARTIFACT_KINDS, type ArtifactKind } from "../bundle/kinds.ts";
import { readFrontmatter } from "../source/frontmatter.ts";

export interface IndexedArtifact {
  kind: ArtifactKind;
  leaf: string;
  dir: string;
}

export interface NormalizeResult {
  artifacts: IndexedArtifact[];
  warnings: string[];
}

const MARKERS: Record<ArtifactKind, string> = {
  skills: "SKILL.md",
  agents: "AGENT.md",
  hooks: "HOOK.md",
  mcps: "MCP.md",
};

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Turn a repo checkout into an umbel-shaped artifact tree under `dest`
 * (`<dest>/<kind>/<leaf>/<MARKER>` + sidecars). Deterministic — a pure function
 * of the checkout bytes. Unions every layout that matches. Later tasks add the
 * `.claude-plugin/` converters (they reuse `register` and `uniqueLeaf`).
 */
export function normalizeRepo(src: string, dest: string): NormalizeResult {
  const seen = new Set<string>(); // `${kind}/${leaf}`
  const artifacts: IndexedArtifact[] = [];
  const warnings: string[] = [];

  // Reserve a (kind, leaf) slot; return its dest dir, or null if already taken.
  function register(kind: ArtifactKind, leaf: string): string | null {
    const key = `${kind}/${leaf}`;
    if (seen.has(key)) {
      warnings.push(`duplicate ${key} — keeping the first`);
      return null;
    }
    seen.add(key);
    const dir = join(dest, kind, leaf);
    artifacts.push({ kind, leaf, dir });
    return dir;
  }
  // Reserve + copy an umbel-shaped source dir verbatim.
  function place(kind: ArtifactKind, leaf: string, fromDir: string): void {
    const to = register(kind, leaf);
    if (to === null) return;
    mkdirSync(to, { recursive: true });
    cpSync(fromDir, to, { recursive: true, dereference: true });
  }
  const uniqueLeaf = makeUniqueLeaf(seen); // used by the converters in later tasks

  indexUmbelShaped(src, place);

  // Lone SKILL.md at the repo root: leaf = frontmatter name, else repo basename.
  if (existsSync(join(src, "SKILL.md"))) {
    const fm = readFrontmatter(join(src, "SKILL.md"));
    const to = register("skills", fm.name ?? basename(src));
    if (to !== null) {
      mkdirSync(to, { recursive: true });
      for (const name of readdirSync(src)) {
        if (name === ".git") continue;
        const from = join(src, name);
        if (isDir(from)) continue; // sidecar dirs of a lone skill are ambiguous — skip
        cpSync(from, join(to, name), { dereference: true });
      }
    }
  }

  const plugin = readPluginJson(src, warnings);
  if (plugin !== null) {
    indexPluginAgents(join(src, plugin.agents ?? "agents"), register);
    if (existsSync(join(src, plugin.commands ?? "commands"))) {
      warnings.push("commands/ present — umbel has no 'commands' kind; skipped");
    }
    const hooksJson = resolveHooksJson(src, plugin.hooks);
    if (existsSync(hooksJson)) convertHooksJson(hooksJson, src, register, uniqueLeaf, warnings);
  }

  artifacts.sort((a, b) =>
    a.kind === b.kind ? a.leaf.localeCompare(b.leaf) : a.kind.localeCompare(b.kind),
  );
  return { artifacts, warnings };
}

// Disambiguate same-derived leaves within one normalize run: base, base-2, …
function makeUniqueLeaf(seen: Set<string>) {
  return (base: string, kind: ArtifactKind): string => {
    let leaf = base;
    let n = 1;
    while (seen.has(`${kind}/${leaf}`)) leaf = `${base}-${++n}`;
    return leaf;
  };
}

// Scan `<src>/<kind>/<leaf>/<MARKER>` (kind trees) and `<src>/<leaf>/<MARKER>`
// (repo-of-dirs) for every kind.
function indexUmbelShaped(
  src: string,
  place: (k: ArtifactKind, leaf: string, dir: string) => void,
): void {
  for (const kind of ARTIFACT_KINDS) {
    const treeBase = join(src, kind);
    if (isDir(treeBase)) {
      for (const leaf of readdirSync(treeBase).sort()) {
        const dir = join(treeBase, leaf);
        if (existsSync(join(dir, MARKERS[kind]))) place(kind, leaf, dir);
      }
    }
  }
  const RESERVED = ["skills", "agents", "hooks", "mcps", ".git", ".claude-plugin"];
  for (const leaf of readdirSync(src).sort()) {
    if (RESERVED.includes(leaf)) continue;
    const dir = join(src, leaf);
    if (!isDir(dir)) continue;
    for (const kind of ARTIFACT_KINDS) {
      if (existsSync(join(dir, MARKERS[kind]))) place(kind, leaf, dir);
    }
  }
}

interface PluginJson {
  agents?: string;
  hooks?: string;
  mcpServers?: string | Record<string, Record<string, unknown>>;
  commands?: string;
}

function readPluginJson(src: string, warnings: string[]): PluginJson | null {
  const p = join(src, ".claude-plugin", "plugin.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as PluginJson;
  } catch {
    warnings.push("plugin.json malformed — skipping .claude-plugin layout");
    return null;
  }
}

// Convert CC agent .md FILES under agentsDir into agents/<name>/AGENT.md dirs.
function indexPluginAgents(
  agentsDir: string,
  register: (k: ArtifactKind, leaf: string) => string | null,
): void {
  if (!isDir(agentsDir)) return;
  for (const name of readdirSync(agentsDir).sort()) {
    if (!name.endsWith(".md")) continue;
    const dir = register("agents", name.slice(0, -3));
    if (dir === null) continue;
    mkdirSync(dir, { recursive: true });
    cpSync(join(agentsDir, name), join(dir, "AGENT.md"), { dereference: true });
  }
}

const PLUGIN_ROOT_RE = /^\$\{CLAUDE_PLUGIN_ROOT\}\/(\S+)/;

function slug(s: string): string {
  const out = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return out.length > 0 ? out : "x";
}

function writeArtifactMd(destDir: string, marker: string, fm: Record<string, unknown>): void {
  mkdirSync(destDir, { recursive: true });
  writeFileSync(join(destDir, marker), `---\n${yamlStringify(fm, { lineWidth: 0 })}---\n`);
}

/**
 * If a command's leading program is `${CLAUDE_PLUGIN_ROOT}/<relpath>`, copy that
 * file/dir from the checkout into `destDir/<relpath>` (preserving structure + exec
 * bit) and return the command rewritten to `./<relpath>`. Literal programs pass
 * through unchanged. Warns when the command has additional plugin-root refs in args.
 */
function convertCommand(
  command: string,
  srcRoot: string,
  destDir: string,
  warnings: string[],
  what: string,
): string {
  const trimmed = command.trimStart();
  const m = trimmed.match(PLUGIN_ROOT_RE);
  const rest = trimmed.replace(/^\S+/, "").trimStart();
  if (rest.includes("${CLAUDE_PLUGIN_ROOT}")) {
    warnings.push(
      `${what}: command references \${CLAUDE_PLUGIN_ROOT} in arguments — converted best-effort, review it`,
    );
  }
  if (!m) return command;
  const rel = m[1]!;
  const from = join(srcRoot, rel);
  if (existsSync(from)) {
    const to = join(destDir, rel);
    mkdirSync(join(to, ".."), { recursive: true });
    cpSync(from, to, { recursive: true, dereference: true });
  } else {
    warnings.push(`${what}: \${CLAUDE_PLUGIN_ROOT}/${rel} not found in the repo`);
  }
  return `./${rel}${rest.length > 0 ? ` ${rest}` : ""}`;
}

interface RawHookCommand {
  type?: string;
  command?: string;
  [k: string]: unknown;
}

function convertHooksJson(
  hooksJsonPath: string,
  srcRoot: string,
  register: (k: ArtifactKind, leaf: string) => string | null,
  uniqueLeaf: (base: string, kind: ArtifactKind) => string,
  warnings: string[],
): void {
  let parsed: { hooks?: Record<string, Array<{ matcher?: string; hooks?: RawHookCommand[] }>> };
  try {
    parsed = JSON.parse(readFileSync(hooksJsonPath, "utf8"));
  } catch {
    warnings.push(`unreadable ${hooksJsonPath} — hooks skipped`);
    return;
  }
  const events = parsed.hooks ?? {};
  for (const [event, specs] of Object.entries(events)) {
    for (const spec of specs) {
      const matcher = spec.matcher ?? "";
      for (const cmd of spec.hooks ?? []) {
        if (cmd.type !== "command" || typeof cmd.command !== "string") {
          warnings.push(`${event}: non-command hook skipped`);
          continue;
        }
        const scriptRel = cmd.command.trimStart().match(PLUGIN_ROOT_RE)?.[1];
        const base = scriptRel
          ? slug(basename(scriptRel).replace(/\.\w+$/, ""))
          : slug(`${event}-${matcher}`);
        const dir = register("hooks", uniqueLeaf(base, "hooks"));
        if (!dir) continue;
        const command = convertCommand(cmd.command, srcRoot, dir, warnings, `hook ${event}`);
        const { type: _t, command: _c, ...extras } = cmd;
        writeArtifactMd(dir, "HOOK.md", {
          name: basename(dir),
          event,
          matcher,
          command,
          ...extras,
        });
      }
    }
  }
}

// Resolve plugin.hooks: a .json file path, a dir (→ <dir>/hooks.json), or the default.
function resolveHooksJson(src: string, hooks: string | undefined): string {
  if (hooks === undefined) return join(src, "hooks/hooks.json");
  const p = join(src, hooks);
  return hooks.endsWith(".json") ? p : join(p, "hooks.json");
}
