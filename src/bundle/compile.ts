import {
  cpSync,
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import matter from "gray-matter";
import { stringify as yamlStringify } from "yaml";
import { UsageError } from "../errors.ts";
import {
  bundleCachePath,
  ensureDir,
  gcBundles,
  partialPath,
  updateByNameSymlink,
} from "./cache.ts";
import { computeClaudeArgs, formatClaudeInvocation } from "./claude-args.ts";
import { resolveCollisions, splitRef } from "./collision.ts";
import type { ResolvedBundle } from "./compose.ts";
import { hashBundle } from "./hash.ts";
import { ARTIFACT_KINDS, type ArtifactKind } from "./kinds.ts";
import type {
  BundleSettings,
  HookCommand,
  HookConfig,
  HookSpec,
  McpServerConfig,
} from "./manifest.ts";
import type { ResolvedSources } from "./resolve.ts";

export interface CompileOpts {
  cacheRoot: string;
  forceRebuild?: boolean;
  keepCache?: number;
}

export function compile(
  bundle: ResolvedBundle,
  sources: ResolvedSources,
  opts: CompileOpts,
): string {
  const hash = hashBundle(bundle, sources);
  const finalDir = bundleCachePath(opts.cacheRoot, bundle.name, hash);
  const partial = partialPath(finalDir);

  if (existsSync(finalDir) && !opts.forceRebuild) {
    // Cache hit: still refresh the by-name pointer so it tracks the most
    // recent build for this name (which is the one we were asked to produce).
    updateByNameSymlink(opts.cacheRoot, bundle.name, finalDir);
    return finalDir;
  }

  rmSync(partial, { recursive: true, force: true });
  if (opts.forceRebuild) {
    rmSync(finalDir, { recursive: true, force: true });
  }
  ensureDir(dirname(finalDir));
  buildLayout(bundle, sources, hash, partial);
  // Write bundle.md into `partial` but embed `finalDir` in the Invocation
  // block, so consumers reading the cache after the atomic rename see the
  // real path, not the `.partial` staging name.
  writeBundleMd(bundle, hash, partial, finalDir);
  // Atomic finalize
  renameSync(partial, finalDir);
  updateByNameSymlink(opts.cacheRoot, bundle.name, finalDir);

  gcBundles(opts.cacheRoot, bundle.name, opts.keepCache ?? 3);

  return finalDir;
}

function buildLayout(
  bundle: ResolvedBundle,
  sources: ResolvedSources,
  hash: string,
  dir: string,
): void {
  ensureDir(dir);

  // Plugin metadata
  const pluginDir = join(dir, ".claude-plugin");
  ensureDir(pluginDir);
  const plugin = {
    name: bundle.name,
    version: `0.0.0+${hash}`,
    description: bundle.description,
  };
  writeFileSync(join(pluginDir, "plugin.json"), JSON.stringify(plugin, null, 2));

  symlinkArtifacts(dir, "skills", "SKILL.md", sources.skills);
  symlinkArtifacts(dir, "agents", "AGENT.md", sources.agents);

  const hookConfig = emitHooks(dir, sources.hooks);

  const mcpServers = emitMcps(dir, sources.mcps);
  if (mcpServers && Object.keys(mcpServers).length > 0) {
    writeFileSync(join(dir, ".mcp.json"), JSON.stringify({ mcpServers }, null, 2));
  }

  // settings.json: merge bundle.settings + aggregated hooks.
  const settingsContent = buildSettings(bundle.settings, hookConfig);
  if (settingsContent !== null) {
    writeFileSync(join(dir, "settings.json"), JSON.stringify(settingsContent, null, 2));
  }
}

function symlinkArtifacts(
  dir: string,
  kind: "skills" | "agents",
  mdFile: string,
  map: Map<string, string>,
): void {
  if (map.size === 0) return;
  const subdir = join(dir, kind);
  ensureDir(subdir);

  const entries = readNamedArtifacts(map, mdFile, kind === "skills" ? "skill" : "agent");

  for (const { item: e, finalName, collides } of resolveCollisions(entries)) {
    const target = join(subdir, finalName);
    if (collides) {
      // CC's plugin loader identifies skills/agents by frontmatter `name:` —
      // colliding entries must be copied + rewritten so the cache dir name
      // matches the disambiguated identity.
      copyWithRenamedFrontmatter(e, target, mdFile, finalName);
    } else {
      symlinkSync(e.srcDir, target);
    }
  }
}

type NamedArtifactEntry = {
  ref: string;
  srcDir: string;
  source: string;
  canonical: string;
  fm: Record<string, unknown>;
  body: string;
};

function readNamedArtifacts(
  map: Map<string, string>,
  mdFile: string,
  kind: string,
): NamedArtifactEntry[] {
  const out: NamedArtifactEntry[] = [];
  for (const [ref, srcDir] of map) {
    const { source, leaf } = splitRef(ref);
    const { fm, body } = readArtifactFrontmatter(srcDir, mdFile, kind);
    out.push({ ref, srcDir, source, canonical: pickCanonicalName(fm, leaf), fm, body });
  }
  return out;
}

function readArtifactFrontmatter(
  srcDir: string,
  mdFile: string,
  kind: string,
): { fm: Record<string, unknown>; body: string } {
  const mdPath = join(srcDir, mdFile);
  let raw: string;
  try {
    raw = readFileSync(mdPath, "utf8");
  } catch {
    throw new UsageError(`${kind} ${srcDir}: missing ${mdFile}`);
  }
  try {
    const parsed = matter(raw);
    return { fm: parsed.data as Record<string, unknown>, body: parsed.content };
  } catch (e) {
    const first = e instanceof Error ? e.message.split("\n", 1)[0] : String(e);
    throw new UsageError(
      `${kind} ${srcDir}: invalid YAML in ${mdFile} frontmatter: ${first}\nHint: if a value contains \`{...}\`, \`[...]\`, or unquoted colons (e.g. code snippets in description), wrap it as a YAML block scalar:\n  description: >-\n    your text here`,
    );
  }
}

function pickCanonicalName(fm: Record<string, unknown>, fallback: string): string {
  return typeof fm.name === "string" && fm.name.length > 0 ? fm.name : fallback;
}

/**
 * Rewrite an artifact command string: leading `./<rel>` becomes
 * `${CLAUDE_PLUGIN_ROOT}/<kind>/<finalName>/<rel>`. Other forms pass through —
 * leaves `docker`, `npx`, absolute paths, etc. untouched.
 */
function rewritePluginRootCommand(command: string, kind: string, finalName: string): string {
  const trimmed = command.trimStart();
  if (trimmed.startsWith("./")) {
    return `\${CLAUDE_PLUGIN_ROOT}/${kind}/${finalName}/${trimmed.slice(2)}`;
  }
  return command;
}

function emitHooks(cacheDir: string, map: Map<string, string>): HookConfig | undefined {
  if (map.size === 0) return undefined;
  const hooksDir = join(cacheDir, "hooks");
  ensureDir(hooksDir);

  const entries = readNamedArtifacts(map, "HOOK.md", "hook");

  const out: HookConfig = {};
  for (const { item: e, finalName } of resolveCollisions(entries)) {
    // Sidecars need exec bit preserved (cp default preserves mode on macOS/Linux).
    cpSync(e.srcDir, join(hooksDir, finalName), { recursive: true, dereference: true });

    const event = e.fm.event;
    const matcher = e.fm.matcher;
    const command = e.fm.command;
    if (typeof event !== "string" || event.length === 0) {
      throw new UsageError(`hook ${e.ref}: frontmatter 'event' is required`);
    }
    if (typeof matcher !== "string") {
      throw new UsageError(`hook ${e.ref}: frontmatter 'matcher' is required`);
    }
    if (typeof command !== "string" || command.length === 0) {
      throw new UsageError(`hook ${e.ref}: frontmatter 'command' is required`);
    }

    const passThrough: Record<string, unknown> = { ...e.fm };
    for (const k of ["name", "description", "event", "matcher", "command"]) {
      delete passThrough[k];
    }

    const cmdEntry: HookCommand = {
      type: "command",
      command: rewritePluginRootCommand(command, "hooks", finalName),
      ...passThrough,
    };
    const spec: HookSpec = { matcher, hooks: [cmdEntry] };
    const specs = out[event] ?? [];
    specs.push(spec);
    out[event] = specs;
  }
  return out;
}

function emitMcps(
  cacheDir: string,
  map: Map<string, string>,
): Record<string, McpServerConfig> | undefined {
  if (map.size === 0) return undefined;
  const mcpsDir = join(cacheDir, "mcps");
  ensureDir(mcpsDir);

  const entries = readNamedArtifacts(map, "MCP.md", "mcp");

  const out: Record<string, McpServerConfig> = {};
  for (const { item: e, finalName } of resolveCollisions(entries)) {
    cpSync(e.srcDir, join(mcpsDir, finalName), { recursive: true, dereference: true });

    const command = e.fm.command;
    if (typeof command !== "string" || command.length === 0) {
      throw new UsageError(`mcp ${e.ref}: frontmatter 'command' is required`);
    }

    const passThrough: Record<string, unknown> = { ...e.fm };
    for (const k of ["name", "description", "command"]) {
      delete passThrough[k];
    }

    out[finalName] = {
      command: rewritePluginRootCommand(command, "mcps", finalName),
      ...passThrough,
    };
  }
  return out;
}

/**
 * Cache keys the compiler will write into `.mcp.json`, computed without
 * copying files or writing config. `show` consumes this for the
 * bundle-vs-project MCP diff.
 */
export function resolveMcpCanonicalNames(map: Map<string, string>): Set<string> {
  if (map.size === 0) return new Set();
  const entries = readNamedArtifacts(map, "MCP.md", "mcp");
  return new Set(resolveCollisions(entries).map((r) => r.finalName));
}

function copyWithRenamedFrontmatter(
  entry: NamedArtifactEntry,
  destDir: string,
  mdFile: string,
  newName: string,
): void {
  cpSync(entry.srcDir, destDir, { recursive: true, dereference: true });
  const rewritten = { ...entry.fm, name: newName };
  writeFileSync(join(destDir, mdFile), matter.stringify(entry.body, rewritten));
}

function buildSettings(
  settings: BundleSettings | undefined,
  hooks: HookConfig | undefined,
): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  if (settings) {
    Object.assign(out, settings);
  }
  if (hooks && Object.keys(hooks).length > 0) {
    out.hooks = hooks;
  }
  if (Object.keys(out).length === 0) return null;
  return out;
}

/**
 * Writes a self-describing `bundle.md` at the cache root.
 *
 * Spec: docs/bundles-spec.md → "Self-describing `bundle.md`".
 * The `## Invocation` block is the canonical bundle-features → claude-flags
 * mapping for any external consumer (sandbox tools, devcontainers, shell
 * wrappers).
 */
function writeBundleMd(
  bundle: ResolvedBundle,
  hash: string,
  writeDir: string,
  invocationPath: string,
): void {
  const frontmatter = resolvedFrontmatter(bundle, hash);
  const invocation = formatClaudeInvocation(computeClaudeArgs(bundle, invocationPath));

  const parts: string[] = [];
  parts.push("---\n");
  parts.push(yamlStringify(frontmatter));
  parts.push("---\n");
  if (bundle.body && bundle.body.trim().length > 0) {
    parts.push("\n");
    parts.push(bundle.body.endsWith("\n") ? bundle.body : `${bundle.body}\n`);
  }
  parts.push("\n## Invocation\n\n");
  parts.push("```bash\n");
  parts.push(invocation);
  parts.push("\n```\n");

  writeFileSync(join(writeDir, "bundle.md"), parts.join(""));
}

function resolvedFrontmatter(bundle: ResolvedBundle, hash: string): Record<string, unknown> {
  const out: Record<string, unknown> = { name: bundle.name, hash };
  if (bundle.description !== undefined) out.description = bundle.description;
  for (const f of ["skills", "agents", "hooks", "mcps"] as const) {
    const v = bundle[f];
    if (v !== undefined && v.length > 0) out[f] = v;
  }
  if (bundle.mergeMcp !== undefined) out.mergeMcp = bundle.mergeMcp;
  if (bundle.settings && Object.keys(bundle.settings).length > 0) {
    out.settings = bundle.settings;
  }
  return out;
}
