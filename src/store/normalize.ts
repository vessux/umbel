import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { stringify as yamlStringify } from "yaml";
import { ARTIFACT_KINDS, type ArtifactKind } from "../bundle/kinds.ts";
import { readFrontmatter } from "../source/frontmatter.ts";
import { hashTree } from "./content-hash.ts";

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

// True when `child` resolves inside (or equal to) `root`.
function isWithin(root: string, child: string): boolean {
  const rel = relative(resolve(root), resolve(child));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

// Follow ALL symlinks and confirm the real path stays within `root`.
// Unreadable/broken path → treat as escaping (safe default).
function withinCheckout(root: string, p: string): boolean {
  try {
    return isWithin(root, realpathSync(p));
  } catch {
    return false;
  }
}

// cpSync that refuses any entry whose realpath escapes `root` — blocks symlink
// exfiltration (dereference:true would otherwise copy external target bytes into
// the derived tree). Returns false (and warns) if `from` itself escapes.
function safeCopyInto(
  from: string,
  to: string,
  root: string,
  warnings: string[],
  label: string,
): boolean {
  if (!withinCheckout(root, from)) {
    warnings.push(`${label}: '${from}' escapes the repo (symlink) — skipped`);
    return false;
  }
  cpSync(from, to, {
    recursive: true,
    dereference: true,
    filter: (s) => {
      if (withinCheckout(root, s)) return true;
      warnings.push(`${s}: symlink escapes the repo — skipped`);
      return false; // prune this entry/subtree; cp continues with the rest
    },
  });
  return true;
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
    if (!withinCheckout(src, fromDir)) {
      warnings.push(`${kind}/${leaf}: escapes the repo (symlink) — skipped`);
      return;
    }
    const to = register(kind, leaf);
    if (to === null) return;
    mkdirSync(to, { recursive: true });
    safeCopyInto(fromDir, to, src, warnings, `${kind}/${leaf}`);
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
        if (!withinCheckout(src, from)) {
          warnings.push(`skills/${basename(to)}/${name}: escapes the repo (symlink) — skipped`);
          continue;
        }
        cpSync(from, join(to, name), { dereference: true });
      }
    }
  }

  const plugin = readPluginJson(src, warnings);
  if (plugin !== null) {
    const agentsDir = join(src, plugin.agents ?? "agents");
    if (!isWithin(src, agentsDir)) {
      warnings.push(".claude-plugin agents path escapes the repo — skipped");
    } else {
      indexPluginAgents(agentsDir, src, register, warnings);
    }

    const commandsDir = join(src, plugin.commands ?? "commands");
    if (isWithin(src, commandsDir) && existsSync(commandsDir)) {
      warnings.push("commands/ present — umbel has no 'commands' kind; skipped");
    }

    const hooksJson = resolveHooksJson(src, plugin.hooks);
    if (!isWithin(src, hooksJson)) {
      warnings.push(".claude-plugin hooks path escapes the repo — skipped");
    } else if (existsSync(hooksJson)) {
      convertHooksJson(hooksJson, src, register, uniqueLeaf, warnings);
    }

    const inline = typeof plugin.mcpServers === "object" ? plugin.mcpServers : undefined;
    if (inline) convertMcpServers(inline, src, register, uniqueLeaf, warnings);
    const rootMcp = join(src, ".mcp.json");
    if (existsSync(rootMcp)) {
      try {
        const parsed = JSON.parse(readFileSync(rootMcp, "utf8")) as {
          mcpServers?: Record<string, Record<string, unknown>>;
        };
        if (parsed.mcpServers)
          convertMcpServers(parsed.mcpServers, src, register, uniqueLeaf, warnings);
      } catch {
        warnings.push(`unreadable ${rootMcp} — mcps skipped`);
      }
    }
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
  root: string,
  register: (k: ArtifactKind, leaf: string) => string | null,
  warnings: string[],
): void {
  if (!withinCheckout(root, agentsDir)) {
    warnings.push(".claude-plugin agents dir escapes the repo — skipped");
    return;
  }
  if (!isDir(agentsDir)) return;
  for (const name of readdirSync(agentsDir).sort()) {
    if (!name.endsWith(".md")) continue;
    const from = join(agentsDir, name);
    if (!withinCheckout(root, from)) {
      warnings.push(`agents/${name}: escapes the repo (symlink) — skipped`);
      continue;
    }
    const dir = register("agents", name.slice(0, -3));
    if (dir === null) continue;
    mkdirSync(dir, { recursive: true });
    cpSync(from, join(dir, "AGENT.md"), { dereference: true });
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
 * through unchanged. Refuses relpaths that escape the plugin root (path traversal)
 * and warns honestly about unresolvable `${CLAUDE_PLUGIN_ROOT}` refs in arguments.
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
  const argHasPlaceholder = rest.includes("${CLAUDE_PLUGIN_ROOT}");
  if (!m) {
    if (argHasPlaceholder) {
      warnings.push(
        `${what}: command references \${CLAUDE_PLUGIN_ROOT} but does not start with it; left unconverted, will not resolve at runtime — review`,
      );
    }
    return command;
  }
  const rel = m[1]!;
  if (
    isAbsolute(rel) ||
    !isWithin(srcRoot, join(srcRoot, rel)) ||
    !isWithin(destDir, join(destDir, rel))
  ) {
    warnings.push(
      `${what}: refuses \${CLAUDE_PLUGIN_ROOT}/${rel} — path escapes the plugin root; left unconverted`,
    );
    return command;
  }
  if (argHasPlaceholder) {
    warnings.push(
      `${what}: leading program converted; a \${CLAUDE_PLUGIN_ROOT} reference remains in arguments and will not resolve at runtime — review`,
    );
  }
  const from = join(srcRoot, rel);
  if (!existsSync(from)) {
    warnings.push(`${what}: \${CLAUDE_PLUGIN_ROOT}/${rel} not found in the repo`);
  } else if (!withinCheckout(srcRoot, from)) {
    warnings.push(
      `${what}: \${CLAUDE_PLUGIN_ROOT}/${rel} escapes the plugin root (symlink) — left unconverted`,
    );
    return command;
  } else {
    const to = join(destDir, rel);
    mkdirSync(dirname(to), { recursive: true });
    safeCopyInto(from, to, srcRoot, warnings, what);
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

function convertMcpServers(
  servers: Record<string, Record<string, unknown>>,
  srcRoot: string,
  register: (k: ArtifactKind, leaf: string) => string | null,
  uniqueLeaf: (base: string, kind: ArtifactKind) => string,
  warnings: string[],
): void {
  for (const [name, cfg] of Object.entries(servers)) {
    const command = cfg.command;
    if (typeof command !== "string" || command.length === 0) {
      warnings.push(`mcp '${name}': missing command — skipped`);
      continue;
    }
    const dir = register("mcps", uniqueLeaf(slug(name), "mcps"));
    if (!dir) continue;
    const rewritten = convertCommand(command, srcRoot, dir, warnings, `mcp ${name}`);
    const { command: _c, ...extras } = cfg;
    writeArtifactMd(dir, "MCP.md", { name, command: rewritten, ...extras });
  }
}

export interface EnsureNormalizedResult {
  dir: string;
  artifacts: IndexedArtifact[];
  warnings: string[];
}

// Index an already-materialized umbel-shaped derived dir (cache-hit path).
function indexNormalized(dir: string): IndexedArtifact[] {
  const out: IndexedArtifact[] = [];
  for (const kind of ARTIFACT_KINDS) {
    const base = join(dir, kind);
    if (!isDir(base)) continue;
    for (const leaf of readdirSync(base).sort()) {
      if (existsSync(join(base, leaf, MARKERS[kind])))
        out.push({ kind, leaf, dir: join(base, leaf) });
    }
  }
  out.sort((a, b) =>
    a.kind === b.kind ? a.leaf.localeCompare(b.leaf) : a.kind.localeCompare(b.kind),
  );
  return out;
}

/**
 * Content-addressed cache over `normalizeRepo`: materializes `checkoutDir` into
 * `<storeRoot>/derived/<hashTree(checkoutDir)>`, reusing that dir on repeat calls
 * instead of re-normalizing. Stages into a temp dir and renames into place so
 * concurrent callers racing on the same hash converge on one winner.
 */
const WARNINGS_SIDECAR = ".umbel-normalize.json";

export function ensureNormalized(checkoutDir: string, storeRoot: string): EnsureNormalizedResult {
  const hash = hashTree(checkoutDir);
  const finalDir = join(storeRoot, "derived", hash);
  if (existsSync(finalDir)) {
    let warnings: string[] = [];
    try {
      warnings = JSON.parse(readFileSync(join(finalDir, WARNINGS_SIDECAR), "utf8")).warnings ?? [];
    } catch {
      // Missing or stale sidecar → no persisted warnings to replay.
    }
    return { dir: finalDir, artifacts: indexNormalized(finalDir), warnings };
  }
  mkdirSync(join(storeRoot, "derived"), { recursive: true });
  const staging = join(
    storeRoot,
    "derived",
    `.staging-${process.pid}-${Math.random().toString(36).slice(2, 10)}`,
  );
  try {
    const { warnings } = normalizeRepo(checkoutDir, staging);
    writeFileSync(join(staging, WARNINGS_SIDECAR), JSON.stringify({ warnings }));
    if (!existsSync(finalDir)) {
      try {
        renameSync(staging, finalDir);
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code !== "ENOTEMPTY" && code !== "EEXIST") throw e;
      }
    }
    return { dir: finalDir, artifacts: indexNormalized(finalDir), warnings };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
