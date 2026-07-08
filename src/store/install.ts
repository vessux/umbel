import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolveLinkDir, storeRootDir } from "../bundle/env.ts";
import { loadBundleIndex } from "../bundle/exec.ts";
import { findProjectRoot } from "../bundle/pin.ts";
import { isDir } from "../claude-dirs.ts";
import { UsageError } from "../errors.ts";
import { isInteractive } from "../tty.ts";
import { confirmExecTrust } from "../ui/prompt.ts";
import { githubUrl, parseCoordinate } from "./coordinate.ts";
import {
  type LockEntry,
  type LockFile,
  lockPathFor,
  readLock,
  serializeLock,
  writeLock,
} from "./lock.ts";
import { checkoutPath, ensureCheckout } from "./store.ts";
import { resolveTarget, resolveTargetOrPick } from "./target.ts";
import { type TrustChange, gateTrust, planTrust } from "./trust.ts";

export interface ReconcileOpts {
  /** Manifest deps: alias → coordinate. */
  deps: Record<string, string>;
  lock: LockFile | null;
  storeRoot: string;
  env: NodeJS.ProcessEnv;
  /** Strict mode (`install --frozen`): assert no drift, materialize exactly, write nothing. */
  frozen: boolean;
  /** `--allow-missing`: tolerate an unresolvable `link:` path under `--frozen`. */
  allowMissing?: boolean;
}

export interface ReconcileResult {
  lock: LockFile;
  /** The next lock differs from the input lock. Always false when frozen. */
  changed: boolean;
  added: string[];
  removed: string[];
  kept: string[];
}

export async function runInstall(
  rest: string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
): Promise<number> {
  const { frozen, bundleFlag, yes, allowMissing } = parseInstallArgs(rest);
  const index = loadBundleIndex(env, cwd);
  const res = resolveTarget(index, bundleFlag, cwd, homedir());
  const entry = await resolveTargetOrPick(res, {
    index,
    env,
    verb: "install",
    interactive: isInteractive(env),
    inProject: findProjectRoot(cwd, homedir()) !== null,
  });
  const manifest = entry.manifest!;
  const deps = manifest.deps ?? {};
  const lockPath = lockPathFor(entry.path);
  const lock = readLock(lockPath);

  const result = reconcile({ deps, lock, storeRoot: storeRootDir(env), env, frozen, allowMissing });

  if (frozen) {
    const n = Object.keys(result.lock.deps).length;
    process.stdout.write(
      `verified ${n} dependenc${n === 1 ? "y" : "ies"} against ${lockPath} (frozen)\n`,
    );
    return 0;
  }

  // Trust gate (ADR-0014): only the `added` aliases pulled new or changed
  // content; `kept` aliases are byte-for-byte the locked (already-trusted)
  // pins. Frozen never reaches here — it materializes the committed lock and
  // returns above. Gate before writing the lock so a refusal writes nothing.
  const storeRoot = storeRootDir(env);
  const changes: TrustChange[] = [];
  for (const alias of result.added) {
    const next = result.lock.deps[alias]!;
    const afterDir = checkoutPath(storeRoot, parseCoordinate(next.coordinate), next.commit);
    const prior = lock?.deps[alias];
    let beforeDir: string | null = null;
    if (prior !== undefined) {
      const priorDir = checkoutPath(storeRoot, parseCoordinate(prior.coordinate), prior.commit);
      if (existsSync(priorDir)) beforeDir = priorDir;
    }
    changes.push(...planTrust(beforeDir, afterDir));
  }
  await gateTrust({
    changes,
    interactive: isInteractive(env),
    yes,
    confirm: confirmExecTrust,
    write: (s) => process.stderr.write(s),
    what: `bundle '${entry.name}'`,
  });

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

function parseInstallArgs(rest: string[]): {
  frozen: boolean;
  bundleFlag?: string;
  yes: boolean;
  allowMissing: boolean;
} {
  let frozen = false;
  let yes = false;
  let allowMissing = false;
  let bundleFlag: string | undefined;
  const positionals: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === "--frozen") {
      frozen = true;
    } else if (a === "--yes") {
      yes = true;
    } else if (a === "--allow-missing") {
      allowMissing = true;
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
  // The target bundle is --bundle OR a single bare positional, not both.
  if (positionals.length > 1) {
    throw new UsageError(`umbel install: unexpected argument: ${positionals[1]}`);
  }
  if (positionals[0] !== undefined) {
    if (bundleFlag !== undefined) {
      throw new UsageError(
        `umbel install: bundle specified twice (--bundle ${bundleFlag} and '${positionals[0]}')`,
      );
    }
    bundleFlag = positionals[0];
  }
  return { frozen, yes, allowMissing, ...(bundleFlag !== undefined ? { bundleFlag } : {}) };
}

/**
 * Fetch every locked dependency's checkout onto disk (a no-op when already
 * staked). This is the run/apply/build auto-materialize path: it consumes the
 * lock as truth and never rewrites it — reconciling a hand-edited manifest is
 * `install`'s job, so `run` stays a pure consumer and can't fail writing a
 * read-only bundle's lock.
 */
export function materializeFromLock(
  lock: LockFile | null,
  storeRoot: string,
  env: NodeJS.ProcessEnv,
): void {
  if (!lock) return;
  for (const alias of Object.keys(lock.deps)) {
    const entry = lock.deps[alias]!;
    const coord = parseCoordinate(entry.coordinate);
    ensureCheckout({ coord, url: githubUrl(coord, env), storeRoot, lockedCommit: entry.commit });
  }
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
    if (coord.transport === "link") {
      // link:/local deps are live and unlocked — never enter the lock. Flipping
      // an alias from github: to link: therefore drops its stale pin here (the
      // alias is absent from nextDeps), keeping every <alias>/<leaf> ref valid.
      continue;
    }
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

  // Split the manifest by transport: only github deps are pinned in the lock;
  // link:/local deps are live (reproducibility covers the git subset only).
  const gitDeps: string[] = [];
  const linkDeps: string[] = [];
  for (const alias of Object.keys(deps)) {
    (parseCoordinate(deps[alias]!).transport === "link" ? linkDeps : gitDeps).push(alias);
  }

  // A link: path must resolve unless --allow-missing (ADR-0013).
  if (!opts.allowMissing) {
    for (const alias of linkDeps) {
      const coord = parseCoordinate(deps[alias]!);
      const dir = resolveLinkDir(coord, env);
      if (!isDir(dir)) {
        throw new UsageError(
          `umbel install --frozen: link path '${dir}' for dependency '${alias}' (${coord.raw}) does not exist (pass --allow-missing to skip)`,
        );
      }
    }
  }

  if (!lock) {
    if (gitDeps.length === 0) {
      return {
        lock: { version: 1, deps: {} },
        changed: false,
        added: [],
        removed: [],
        kept: linkDeps,
      };
    }
    throw new UsageError(
      "umbel install --frozen: no lock file found; run 'umbel install' first to create one",
    );
  }

  const drift: string[] = [];
  for (const alias of gitDeps) {
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
    if (!gitDeps.includes(alias)) {
      drift.push(`'${alias}' is in the lock but is not a github: dependency in the manifest`);
    }
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
    // Defensive: ensureCheckout(lockedCommit) is contracted to return that exact
    // commit, so this can't fire today — it guards a future change that fetches
    // by ref. The reachable integrity gate is the content-hash check below.
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

  return {
    lock,
    changed: false,
    added: [],
    removed: [],
    kept: [...Object.keys(lock.deps), ...linkDeps],
  };
}
