import { readFileSync } from "node:fs";
import matter from "gray-matter";
import { UsageError } from "../errors.ts";

/**
 * Internal type for the emitted settings.json `hooks` block.
 * Built by the compiler from resolved hook artifacts; not a bundle frontmatter shape.
 * Permissive on extras (async, timeout, ...) — passed through verbatim from HOOK.md.
 */
export interface HookCommand {
  type: "command";
  command: string;
  [extra: string]: unknown;
}

export interface HookSpec {
  matcher: string;
  hooks: HookCommand[];
}

export type HookConfig = Record<string, HookSpec[]>;

/**
 * Internal type for the emitted .mcp.json `mcpServers` block.
 * Built by the compiler from resolved MCP artifacts; not a bundle frontmatter shape.
 * Permissive on extras (transport, ...) — passed through verbatim from MCP.md.
 */
export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  [extra: string]: unknown;
}

export interface BundleSettings {
  model?: string;
  env?: Record<string, string>;
  statusLine?: { command: string };
  permissions?: unknown;
  outputStyle?: string;
}

export interface BundleManifest {
  name: string;
  description?: string;
  extends?: string[];
  skills?: string[];
  agents?: string[];
  /** List of qualified `<source>/<leaf>` refs. */
  hooks?: string[];
  /** List of qualified `<source>/<leaf>` refs. */
  mcps?: string[];
  mergeMcp?: boolean;
  /**
   * Opt-in full isolation. When true, the session loads ONLY the bundle's own
   * artifacts: the launch adds `--bare`, so Claude Code skips the user's
   * globally-enabled plugins, `~/.claude/skills`, and project-scope
   * auto-discovery. Default (false/absent) keeps today's additive behaviour —
   * `--plugin-dir` layers the bundle on top of whatever is already enabled.
   */
  isolate?: boolean;
  settings?: BundleSettings;
  body: string;
  sourcePath: string;
}

export interface ManifestResult {
  manifest: BundleManifest;
  warnings: string[];
}

const NAME_RE = /^[a-z][a-z0-9-]{1,40}$/;

function parseFrontmatter(
  path: string,
  raw: string,
): { data: Record<string, unknown>; body: string } {
  try {
    const parsed = matter(raw);
    return { data: parsed.data as Record<string, unknown>, body: parsed.content };
  } catch (e) {
    const first = e instanceof Error ? e.message.split("\n", 1)[0] : String(e);
    throw new UsageError(
      `bundle ${path}: invalid YAML in frontmatter: ${first}\nHint: if a value contains \`{...}\`, \`[...]\`, or unquoted colons (e.g. code snippets in description), wrap it as a YAML block scalar:\n  description: >-\n    your text here`,
    );
  }
}

export function loadManifest(path: string): ManifestResult {
  const raw = readFileSync(path, "utf8");
  const { data, body } = parseFrontmatter(path, raw);

  if (typeof data.name !== "string" || data.name.length === 0) {
    throw new UsageError(`bundle ${path}: 'name' is required`);
  }
  if (!NAME_RE.test(data.name)) {
    throw new UsageError(
      `bundle ${path}: invalid name '${data.name}' (must match ${NAME_RE.source})`,
    );
  }

  const manifest: BundleManifest = { name: data.name, sourcePath: path, body };

  if (data.description !== undefined) {
    manifest.description = data.description as string;
  }
  if (data.extends !== undefined) {
    if (!Array.isArray(data.extends) || !data.extends.every((e) => typeof e === "string")) {
      throw new UsageError(`bundle ${path}: 'extends' must be a list of names`);
    }
    manifest.extends = data.extends as string[];
  }
  if (data.skills !== undefined) {
    if (!Array.isArray(data.skills) || !data.skills.every((s) => typeof s === "string")) {
      throw new UsageError(
        `bundle ${path}: 'skills' must be a list of qualified <source>/<name> refs`,
      );
    }
    manifest.skills = data.skills as string[];
  }
  if (data.agents !== undefined) {
    if (!Array.isArray(data.agents) || !data.agents.every((a) => typeof a === "string")) {
      throw new UsageError(
        `bundle ${path}: 'agents' must be a list of qualified <source>/<name> refs`,
      );
    }
    manifest.agents = data.agents as string[];
  }
  if (data.hooks !== undefined) {
    if (!Array.isArray(data.hooks) || !data.hooks.every((h) => typeof h === "string")) {
      throw new UsageError(
        `bundle ${path}: 'hooks' must be a list of qualified <source>/<name> refs`,
      );
    }
    manifest.hooks = data.hooks as string[];
  }
  if (data.mcps !== undefined) {
    if (!Array.isArray(data.mcps) || !data.mcps.every((h) => typeof h === "string")) {
      throw new UsageError(
        `bundle ${path}: 'mcps' must be a list of qualified <source>/<name> refs`,
      );
    }
    manifest.mcps = data.mcps as string[];
  }
  if (data.mergeMcp !== undefined) {
    manifest.mergeMcp = data.mergeMcp as boolean;
  }
  if (data.isolate !== undefined) {
    if (typeof data.isolate !== "boolean") {
      throw new UsageError(`bundle ${path}: 'isolate' must be a boolean`);
    }
    manifest.isolate = data.isolate;
  }
  if (data.settings !== undefined) {
    const settings = data.settings as Record<string, unknown>;
    for (const key of Object.keys(settings)) {
      if (!SETTINGS_WHITELIST.has(key)) {
        throw new UsageError(
          `bundle ${path}: settings.${key} is not in the whitelist (allowed: ${[
            ...SETTINGS_WHITELIST,
          ].join(", ")})`,
        );
      }
    }
    manifest.settings = settings as BundleSettings;
  }

  const warnings: string[] = [];
  for (const key of Object.keys(data)) {
    if (KNOWN_FIELDS.has(key)) continue;
    // Hybrid validation (ADR-0012): a near-miss of a known field is almost
    // certainly a typo, which carries no forward-compat value — fail it hard so
    // the footgun (`skils:` silently dropping skills) dies at build time. A
    // genuinely-unknown field stays a warning, preserving forward-compat for
    // real future fields.
    const suggestion = nearestKnownField(key);
    if (suggestion) {
      throw new UsageError(
        `bundle ${path}: unknown field '${key}' — did you mean '${suggestion}'?`,
      );
    }
    warnings.push(`bundle ${path}: unknown field '${key}' (ignored)`);
  }

  return { manifest, warnings };
}

// Self-constraint (ADR-0012, enforce in review): umbel must NOT add a
// frontmatter field within edit-distance-1 of an existing one, or the near-miss
// rule below could false-positive a legitimate new field as a typo.
const KNOWN_FIELDS = new Set([
  "name",
  "description",
  "extends",
  "skills",
  "agents",
  "hooks",
  "mcps",
  "mergeMcp",
  "isolate",
  "settings",
]);

/** First known field within edit-distance 1 of `key`, or undefined. */
function nearestKnownField(key: string): string | undefined {
  for (const field of KNOWN_FIELDS) {
    if (withinEditDistance1(key, field)) return field;
  }
  return undefined;
}

/** True if `a` and `b` are within Levenshtein distance 1 (≤1 insert/delete/substitute). */
function withinEditDistance1(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  // Walk both strings; allow a single divergence.
  const [short, long] = la <= lb ? [a, b] : [b, a];
  let i = 0;
  let j = 0;
  let edited = false;
  while (i < short.length && j < long.length) {
    if (short[i] === long[j]) {
      i++;
      j++;
      continue;
    }
    if (edited) return false;
    edited = true;
    if (short.length === long.length) i++; // substitution
    j++; // consume the diverging char in the longer string
  }
  return true;
}

const SETTINGS_WHITELIST = new Set(["model", "env", "statusLine", "permissions", "outputStyle"]);
