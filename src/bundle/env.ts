import { homedir } from "node:os";
import { isAbsolute, join, resolve as pathResolve } from "node:path";
import { findClaudeBundlesDir } from "../target/walk.ts";
import type { ArtifactRoots } from "./resolve.ts";

/**
 * Project-scope bundles dir: the `.claude/bundles/` ancestor walk result, with
 * a `<cwd>/.claude/bundles` fallback when no ancestor matches. Used for
 * discovery (the fallback dir may not exist yet; callers handle that).
 */
export function projectBundlesDir(cwd: string, home: string): string {
  return findClaudeBundlesDir(cwd, home) ?? join(cwd, ".claude", "bundles");
}

export function umbelArtifactsRoot(env: NodeJS.ProcessEnv): string {
  const root = env.UMBEL_ARTIFACTS_DIR;
  if (root && root.length > 0) return pathResolve(root);
  const xdg = env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".config");
  return join(base, "umbel");
}

/**
 * Generated/state data root, separate from the curated config root. The PATH
 * shim is generated ("Do not hand-edit"), so it belongs here under
 * `$XDG_DATA_HOME/umbel`, not in `$XDG_CONFIG_HOME/umbel` where it would be
 * swept into a version-controlled dotfiles tree.
 */
export function umbelDataRoot(env: NodeJS.ProcessEnv): string {
  const override = env.UMBEL_DATA_DIR;
  if (override && override.length > 0) return pathResolve(override);
  const xdg = env.XDG_DATA_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".local", "share");
  return join(base, "umbel");
}

export function shimDir(env: NodeJS.ProcessEnv): string {
  return join(umbelDataRoot(env), "bin");
}

export function storeRootDir(env: NodeJS.ProcessEnv): string {
  return join(umbelDataRoot(env), "store");
}

export function shimPath(env: NodeJS.ProcessEnv): string {
  return join(shimDir(env), "claude");
}

/**
 * Remove `dir` from a colon-separated PATH string. Returns the filtered PATH.
 * No-op if PATH is undefined or the dir isn't present.
 */
export function stripFromPath(path: string | undefined, dir: string): string | undefined {
  if (!path) return path;
  const parts = path.split(":").filter((p) => p !== dir);
  return parts.join(":");
}

export function userBundlesDir(env: NodeJS.ProcessEnv): string {
  return join(umbelArtifactsRoot(env), "bundles");
}

export function artifactRoots(env: NodeJS.ProcessEnv): ArtifactRoots {
  const base = umbelArtifactsRoot(env);
  return {
    skills: join(base, "skills"),
    agents: join(base, "agents"),
    hooks: join(base, "hooks"),
    mcps: join(base, "mcps"),
  };
}

export function bundleCacheRoot(env: NodeJS.ProcessEnv): string {
  const override = env.UMBEL_CACHE_DIR;
  if (override && override.length > 0) return pathResolve(override);
  const xdg = env.XDG_CACHE_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".cache");
  return join(base, "umbel");
}
