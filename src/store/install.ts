import { UsageError } from "../errors.ts";
import { githubUrl, parseCoordinate } from "./coordinate.ts";
import { type LockEntry, type LockFile, serializeLock } from "./lock.ts";
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
      drift.push(`'${alias}' coordinate differs (manifest ${coordRaw} ≠ lock ${locked.coordinate})`);
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
