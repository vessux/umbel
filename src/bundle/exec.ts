import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { NotFoundError, UsageError } from "../errors.ts";
import { lockPathFor, readLock } from "../store/lock.ts";
import { computeClaudeArgs } from "./claude-args.ts";
import { compile } from "./compile.ts";
import { type ResolvedBundle, compose, composeChain } from "./compose.ts";
import { discoverBundles } from "./discover.ts";
import {
  artifactRoots,
  bundleCacheRoot,
  projectBundlesDir,
  shimDir,
  storeRootDir,
  stripFromPath,
  userBundlesDir,
} from "./env.ts";
import type { BundleManifest } from "./manifest.ts";
import { type Candidate, readPin } from "./pin.ts";
import { type ResolvedSources, resolveSources } from "./resolve.ts";

const VANILLA_ENV_SENTINEL = "__vanilla__";

export type ResolveResult =
  | { kind: "named"; name: string; via: "arg" | "env" | "pin" }
  | { kind: "vanilla"; via: "env" | "pin" }
  | { kind: "multiple"; candidates: Candidate[]; via: "pin" }
  | { kind: "unresolved"; message: string };

export function resolveBundleName(
  rest: string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
  home: string,
): ResolveResult {
  const arg = rest.find((a) => !a.startsWith("--"));
  if (arg !== undefined && arg.length > 0) return { kind: "named", name: arg, via: "arg" };
  const envName = env.UMBEL_BUNDLE;
  if (envName && envName.length > 0) {
    if (envName === VANILLA_ENV_SENTINEL) return { kind: "vanilla", via: "env" };
    return { kind: "named", name: envName, via: "env" };
  }
  const pin = readPin(cwd, home);
  if (pin) {
    if (pin.candidates.length === 1) {
      const c = pin.candidates[0]!;
      return c.kind === "vanilla"
        ? { kind: "vanilla", via: "pin" }
        : { kind: "named", name: c.name, via: "pin" };
    }
    return { kind: "multiple", candidates: pin.candidates, via: "pin" };
  }
  return {
    kind: "unresolved",
    message: "no bundle specified (pass <name>, set UMBEL_BUNDLE, or 'umbel apply' to pin)",
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
): { resolved: ResolvedBundle; sources: ResolvedSources; warnings: string[] } {
  const ix = new Map<string, BundleManifest>();
  for (const e of index.entries) {
    if (e.manifest && !ix.has(e.name)) ix.set(e.name, e.manifest);
  }
  if (!ix.has(name)) {
    const malformed = index.entries.find((e) => e.malformed && e.name === name);
    if (malformed) {
      throw new UsageError(malformed.error ?? `bundle '${name}' is malformed`);
    }
    throw new NotFoundError(`bundle '${name}' not found`);
  }
  // A parent reached transitively via `extends` may be present-but-malformed
  // (has no manifest, so it's absent from `ix`). Thread its error into compose
  // so linearize can report exit 2 (validation) rather than exit 3 (missing).
  const malformed = new Map<string, string>();
  for (const e of index.entries) {
    if (e.malformed && !ix.has(e.name) && !malformed.has(e.name)) {
      malformed.set(e.name, e.error ?? `bundle '${e.name}' is malformed`);
    }
  }
  const resolved = compose(name, ix, malformed);
  const chainNames = composeChain(name, ix);
  if (chainNames.length > 1 && chainNames.some((n) => ix.get(n)?.deps !== undefined)) {
    throw new UsageError(
      `bundle '${name}': 'deps:' combined with 'extends' is not supported yet (resolve-then-merge lands in a later slice)`,
    );
  }
  const chain = new Set(chainNames);
  const warnings = [
    ...new Set(
      index.entries
        .filter((e) => !e.shadowed && chain.has(e.name))
        .flatMap((e) => e.warnings ?? []),
    ),
  ];
  const projectSkillsDir = join(dirname(index.projectDir), "skills");
  const sources = resolveSources(resolved, {
    roots: artifactRoots(env),
    projectSkillsDir,
    ...(resolved.deps !== undefined
      ? {
          store: {
            deps: resolved.deps,
            lock: readLock(lockPathFor(resolved.sourcePath)) ?? undefined,
            root: storeRootDir(env),
          },
        }
      : {}),
  });
  return { resolved, sources, warnings };
}

export interface PrepareOpts {
  name: string;
  claudeArgs: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  /** Reuse a pre-discovered bundle index to avoid scanning the bundle dirs twice. */
  preloadedIndex?: BundleIndex;
  /** Forwarded to compile(); fires only on a cache miss (an actual build). */
  onBuild?: () => void;
}

export interface PreparedInvocation {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cacheDir: string;
  warnings: string[];
}

export function prepareBundleInvocation(opts: PrepareOpts): PreparedInvocation {
  const { name, claudeArgs, env, cwd } = opts;
  const index = opts.preloadedIndex ?? loadBundleIndex(env, cwd);
  const { resolved, sources, warnings } = resolveBundle(name, index, env);
  const { cacheDir, version } = compile(resolved, sources, {
    cacheRoot: bundleCacheRoot(env),
    ...(opts.onBuild ? { onBuild: opts.onBuild } : {}),
  });
  const spawnEnv: NodeJS.ProcessEnv = {
    ...env,
    UMBEL_BUNDLE: name,
    UMBEL_RESOLVED: "1",
    UMBEL_RESOLVED_DIR: cacheDir,
    UMBEL_BUNDLE_VERSION: version,
  };
  const filteredPath = stripFromPath(env.PATH, shimDir(env));
  if (filteredPath !== undefined) spawnEnv.PATH = filteredPath;
  return {
    command: "claude",
    args: [...computeClaudeArgs(resolved, cacheDir), ...claudeArgs],
    env: spawnEnv,
    cacheDir,
    warnings,
  };
}
