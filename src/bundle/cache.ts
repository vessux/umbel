import {
  mkdirSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { basename, dirname, join, resolve as resolvePath } from "node:path";
import { HASH_HEX_LEN } from "./hash.ts";

export function bundleCachePath(cacheRoot: string, name: string, hash: string): string {
  return join(cacheRoot, "bundles", `${name}-${hash}`);
}

export function partialPath(cacheDir: string): string {
  return `${cacheDir}.partial`;
}

function byNameDir(cacheRoot: string): string {
  return join(cacheRoot, "bundles", "by-name");
}

function byNamePath(cacheRoot: string, name: string): string {
  return join(byNameDir(cacheRoot), name);
}

/**
 * Atomically updates `bundles/by-name/<name>` to point at `hashDir`.
 * Uses a relative symlink target (`../<hashdir-basename>`) so the cache root
 * can be relocated without breaking links.
 */
export function updateByNameSymlink(cacheRoot: string, name: string, hashDir: string): void {
  const dir = byNameDir(cacheRoot);
  mkdirSync(dir, { recursive: true });
  const final = join(dir, name);
  const relTarget = `../${basename(hashDir)}`;
  const tmp = join(dir, `.${name}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`);
  // symlink() fails if path exists; tmp is unique so it won't.
  symlinkSync(relTarget, tmp);
  try {
    renameSync(tmp, final);
  } catch (e) {
    // Clean up the tmp link if the rename couldn't replace.
    try {
      unlinkSync(tmp);
    } catch {
      // already gone
    }
    throw e;
  }
}

function readByNameTarget(cacheRoot: string, name: string): string | null {
  const link = byNamePath(cacheRoot, name);
  let target: string;
  try {
    target = readlinkSync(link);
  } catch {
    return null;
  }
  return resolvePath(dirname(link), target);
}

const HASH_SUFFIX = new RegExp(`-[0-9a-f]{${HASH_HEX_LEN}}$`);

function readBundlesDir(cacheRoot: string): string[] {
  try {
    return readdirSync(join(cacheRoot, "bundles"));
  } catch {
    return [];
  }
}

export function listBundleNames(cacheRoot: string): string[] {
  const names = new Set<string>();
  for (const e of readBundlesDir(cacheRoot)) {
    if (e === "by-name") continue;
    if (e.endsWith(".partial")) continue;
    if (!HASH_SUFFIX.test(e)) continue;
    names.add(e.replace(HASH_SUFFIX, ""));
  }
  return [...names].sort();
}

export function gcBundles(cacheRoot: string, name: string, keep = 3): void {
  const root = join(cacheRoot, "bundles");
  const protectedDir = readByNameTarget(cacheRoot, name);
  const prefix = `${name}-`;
  const candidates = readBundlesDir(cacheRoot)
    .filter((e) => e !== "by-name" && e.startsWith(prefix) && !e.endsWith(".partial"))
    .map((e) => {
      const full = join(root, e);
      let mtime = 0;
      try {
        mtime = statSync(full).mtimeMs;
      } catch {
        // ignore
      }
      return { dir: full, mtime };
    })
    .sort((a, b) => b.mtime - a.mtime);
  for (const c of candidates.slice(keep)) {
    if (protectedDir !== null && c.dir === protectedDir) continue;
    rmSync(c.dir, { recursive: true, force: true });
  }
}

export function ensureDir(p: string): void {
  mkdirSync(p, { recursive: true });
}
