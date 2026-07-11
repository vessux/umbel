import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
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

  const plugin = readPluginJson(src);
  if (plugin !== null) {
    indexPluginAgents(join(src, plugin.agents ?? "agents"), register);
    if (existsSync(join(src, plugin.commands ?? "commands"))) {
      warnings.push("commands/ present — umbel has no 'commands' kind; skipped");
    }
    // hooks + mcps converters are wired in a LATER task.
  }

  void uniqueLeaf; // wired to the converters in a later task

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

function readPluginJson(src: string): PluginJson | null {
  const p = join(src, ".claude-plugin", "plugin.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as PluginJson;
  } catch {
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
