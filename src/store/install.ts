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

function reconcileFrozen(_opts: ReconcileOpts): ReconcileResult {
  throw new Error("frozen reconcile not implemented yet");
}
