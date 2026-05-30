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

export function loadManifest(path: string): ManifestResult {
  const raw = readFileSync(path, "utf8");
  const parsed = matter(raw);
  const data = parsed.data as Record<string, unknown>;
  const body = parsed.content;

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
    manifest.extends = data.extends as string[];
  }
  if (data.skills !== undefined) {
    manifest.skills = data.skills as string[];
  }
  if (data.agents !== undefined) {
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
    if (!KNOWN_FIELDS.has(key)) {
      warnings.push(`bundle ${path}: unknown field '${key}' (ignored)`);
    }
  }

  return { manifest, warnings };
}

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

const SETTINGS_WHITELIST = new Set(["model", "env", "statusLine", "permissions", "outputStyle"]);
