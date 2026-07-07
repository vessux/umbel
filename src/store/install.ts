import { storeRootDir } from "../bundle/env.ts";
import { loadBundleIndex } from "../bundle/exec.ts";
import { UsageError } from "../errors.ts";
import { resolveTargetBundle } from "./add.ts";
import { githubUrl, parseCoordinate } from "./coordinate.ts";
import {
  type LockEntry,
  type LockFile,
  lockPathFor,
  readLock,
  serializeLock,
  writeLock,
} from "./lock.ts";
import { ensureCheckout } from "./store.ts";

export interface ReconcileOpts {
  /** Manifest deps: alias → coordinate. */
  deps: Record<string, string>;
  lock: LockFile | null;
  storeRoot: string;
  env: NodeJS.ProcessEnv;
  /** Strict mode (`install --frozen`): assert no drift, materialize exactly, write nothing. */
  frozen: boolean;
}

export interface ReconcileResult {
  lock: LockFile;
  /** The next lock differs from the input lock. Always false when frozen. */
  changed: boolean;
  added: string[];
  removed: string[];
  kept: string[];
}

export function runInstall(rest: string[], env: NodeJS.ProcessEnv, cwd: string): number {
  const { frozen, bundleFlag } = parseInstallArgs(rest);
  const index = loadBundleIndex(env, cwd);
  const entry = resolveTargetBundle(index, bundleFlag, cwd, "install");
  const manifest = entry.manifest!;
  const deps = manifest.deps ?? {};
  const lockPath = lockPathFor(entry.path);
  const lock = readLock(lockPath);

  const result = reconcile({ deps, lock, storeRoot: storeRootDir(env), env, frozen });

  if (frozen) {
    const n = Object.keys(result.lock.deps).length;
    process.stdout.write(
      `verified ${n} dependenc${n === 1 ? "y" : "ies"} against ${lockPath} (frozen)\n`,
    );
    return 0;
  }
  if (result.changed) {
    writeLock(lockPath, result.lock);
    const parts: string[] = [];
    if (result.added.length) parts.push(`resolved ${result.added.join(", ")}`);
    if (result.kept.length) parts.push(`kept ${result.kept.join(", ")}`);
    if (result.removed.length) parts.push(`dropped ${result.removed.join(", ")}`);
    process.stdout.write(`${parts.join("; ") || "reconciled"}\n`);
    process.stdout.write(`lock: ${lockPath}\n`);
    return 0;
  }
  process.stdout.write(`'${entry.name}' already up to date\n`);
  return 0;
}

function parseInstallArgs(rest: string[]): { frozen: boolean; bundleFlag?: string } {
  let frozen = false;
  let bundleFlag: string | undefined;
  const positionals: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === "--frozen") {
      frozen = true;
    } else if (a === "--bundle") {
      const v = rest[i + 1];
      if (v === undefined || v.startsWith("-")) throw new UsageError("--bundle requires a value");
      bundleFlag = v;
      i++;
    } else if (a.startsWith("--bundle=")) {
      const v = a.slice("--bundle=".length);
      if (v.length === 0) throw new UsageError("--bundle requires a value");
      bundleFlag = v;
    } else if (a.startsWith("-")) {
      throw new UsageError(`umbel install: unknown flag: ${a}`);
    } else {
      positionals.push(a);
    }
  }
  // A bare positional is the target bundle name (uniform with the other verbs).
  if (positionals.length > 1) {
    throw new UsageError(`umbel install: unexpected argument: ${positionals[1]}`);
  }
  if (positionals[0] !== undefined) bundleFlag = bundleFlag ?? positionals[0];
  return { frozen, ...(bundleFlag !== undefined ? { bundleFlag } : {}) };
}

export function reconcile(opts: ReconcileOpts): ReconcileResult {
  if (opts.frozen) return reconcileFrozen(opts);

  const { deps, lock, storeRoot, env } = opts;
  const current = lock?.deps ?? {};
  const nextDeps: Record<string, LockEntry> = {};
  const added: string[] = [];
  const kept: string[] = [];

  for (const alias of Object.keys(deps)) {
    const coordRaw = deps[alias]!;
    const coord = parseCoordinate(coordRaw);
    const existing = current[alias];
    if (existing && existing.coordinate === coordRaw) {
      // Keep the pin verbatim (never bump). Still materialize its exact bytes.
      ensureCheckout({
        coord,
        url: githubUrl(coord, env),
        storeRoot,
        lockedCommit: existing.commit,
      });
      nextDeps[alias] = { ...existing };
      kept.push(alias);
    } else {
      // New dep or changed coordinate → resolve the ref tip fresh.
      const checkout = ensureCheckout({ coord, url: githubUrl(coord, env), storeRoot });
      nextDeps[alias] = {
        coordinate: coordRaw,
        commit: checkout.commit,
        contentHash: checkout.contentHash,
      };
      added.push(alias);
    }
  }

  const removed = Object.keys(current).filter((a) => !(a in deps));
  const nextLock: LockFile = { version: 1, deps: nextDeps };
  const changed = lock
    ? serializeLock(nextLock) !== serializeLock(lock)
    : Object.keys(nextDeps).length > 0;
  return { lock: nextLock, changed, added, removed, kept };
}

function reconcileFrozen(opts: ReconcileOpts): ReconcileResult {
  const { deps, lock, storeRoot, env } = opts;
  if (!lock) {
    if (Object.keys(deps).length === 0) {
      return { lock: { version: 1, deps: {} }, changed: false, added: [], removed: [], kept: [] };
    }
    throw new UsageError(
      "umbel install --frozen: no lock file found; run 'umbel install' first to create one",
    );
  }

  const drift: string[] = [];
  for (const alias of Object.keys(deps)) {
    const coordRaw = deps[alias]!;
    const locked = lock.deps[alias];
    if (!locked) {
      drift.push(`'${alias}' is in the manifest but not the lock`);
    } else if (locked.coordinate !== coordRaw) {
      drift.push(
        `'${alias}' coordinate differs (manifest ${coordRaw} ≠ lock ${locked.coordinate})`,
      );
    }
  }
  for (const alias of Object.keys(lock.deps)) {
    if (!(alias in deps)) drift.push(`'${alias}' is in the lock but not the manifest`);
  }
  if (drift.length > 0) {
    throw new UsageError(`umbel install --frozen: manifest/lock drift:\n  ${drift.join("\n  ")}`);
  }

  for (const alias of Object.keys(lock.deps)) {
    const locked = lock.deps[alias]!;
    const coord = parseCoordinate(locked.coordinate);
    const checkout = ensureCheckout({
      coord,
      url: githubUrl(coord, env),
      storeRoot,
      lockedCommit: locked.commit,
    });
    if (checkout.commit !== locked.commit) {
      throw new UsageError(
        `umbel install --frozen: '${alias}' resolved to ${checkout.commit.slice(0, 12)} but the lock pins ${locked.commit.slice(0, 12)}`,
      );
    }
    if (checkout.contentHash !== locked.contentHash) {
      throw new UsageError(
        `umbel install --frozen: '${alias}' content changed for the locked commit ${locked.commit.slice(0, 12)} (expected ${locked.contentHash.slice(0, 12)}, got ${checkout.contentHash.slice(0, 12)})`,
      );
    }
  }

  return { lock, changed: false, added: [], removed: [], kept: Object.keys(lock.deps) };
}
