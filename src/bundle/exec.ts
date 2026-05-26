import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { NotFoundError } from "../errors.ts";
import { computeClaudeArgs } from "./claude-args.ts";
import { compile } from "./compile.ts";
import { type ResolvedBundle, compose } from "./compose.ts";
import { discoverBundles } from "./discover.ts";
import { artifactRoots, bundleCacheRoot, projectBundlesDir, userBundlesDir } from "./env.ts";
import type { BundleManifest } from "./manifest.ts";
import { readPin } from "./pin.ts";
import { type ResolvedSources, resolveSources } from "./resolve.ts";

export type ResolveResult = { name: string; via: "arg" | "env" | "pin" } | { error: string };

export function resolveBundleName(
  rest: string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
  home: string,
): ResolveResult {
  const arg = rest.find((a) => !a.startsWith("--"));
  if (arg !== undefined && arg.length > 0) return { name: arg, via: "arg" };
  const envName = env.UMBEL_BUNDLE;
  if (envName && envName.length > 0) return { name: envName, via: "env" };
  const pin = readPin(cwd, home);
  if (pin) return { name: pin.name, via: "pin" };
  return {
    error: "no bundle specified (pass <name>, set UMBEL_BUNDLE, or 'umbel apply' to pin)",
  };
}

export interface BundleIndex {
  userDir: string;
  projectDir: string;
  entries: ReturnType<typeof discoverBundles>;
}

export function loadBundleIndex(env: NodeJS.ProcessEnv, cwd: string): BundleIndex {
  const userDir = userBundlesDir(env);
  const projectDir = projectBundlesDir(cwd, homedir());
  return { userDir, projectDir, entries: discoverBundles({ userDir, projectDir }) };
}

/**
 * Look up `name` in the bundle index, compose it (extends), and resolve its
 * sources. Throws NotFoundError when the bundle isn't in the index. Used by
 * `bundle build`, `bundle show`, and `bundle run` so they share the same
 * compose+resolve pipeline.
 */
export function resolveBundle(
  name: string,
  index: BundleIndex,
  env: NodeJS.ProcessEnv,
): { resolved: ResolvedBundle; sources: ResolvedSources } {
  const ix = new Map<string, BundleManifest>();
  for (const e of index.entries) {
    if (e.manifest && !ix.has(e.name)) ix.set(e.name, e.manifest);
  }
  if (!ix.has(name)) {
    throw new NotFoundError(`bundle '${name}' not found`);
  }
  const resolved = compose(name, ix);
  const projectSkillsDir = join(dirname(index.projectDir), "skills");
  const sources = resolveSources(resolved, {
    roots: artifactRoots(env),
    projectSkillsDir,
  });
  return { resolved, sources };
}

export interface PrepareOpts {
  name: string;
  claudeArgs: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  /** Reuse a pre-discovered bundle index to avoid scanning the bundle dirs twice. */
  preloadedIndex?: BundleIndex;
}

export interface PreparedInvocation {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cacheDir: string;
}

export function prepareBundleInvocation(opts: PrepareOpts): PreparedInvocation {
  const { name, claudeArgs, env, cwd } = opts;
  const index = opts.preloadedIndex ?? loadBundleIndex(env, cwd);
  const { resolved, sources } = resolveBundle(name, index, env);
  const cacheDir = compile(resolved, sources, { cacheRoot: bundleCacheRoot(env) });
  return {
    command: "claude",
    args: [...computeClaudeArgs(resolved, cacheDir), ...claudeArgs],
    env: { ...env, UMBEL_BUNDLE: name },
    cacheDir,
  };
}
