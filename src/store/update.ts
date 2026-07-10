import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { storeRootDir } from "../bundle/env.ts";
import { loadBundleIndex } from "../bundle/exec.ts";
import { findProjectRoot } from "../bundle/pin.ts";
import { NotFoundError, UsageError } from "../errors.ts";
import { isInteractive } from "../tty.ts";
import { confirmExecTrust } from "../ui/prompt.ts";
import { githubUrl, parseCoordinate } from "./coordinate.ts";
import { type LockEntry, type LockFile, lockPathFor, readLock, writeLock } from "./lock.ts";
import { checkoutPath, ensureCheckout, resolveBranchTip } from "./store.ts";
import { resolveTarget, resolveTargetOrPick } from "./target.ts";
import { type TrustChange, gateTrust, planTrust } from "./trust.ts";

interface Bump {
  alias: string;
  before: LockEntry | undefined;
  after: LockEntry;
  afterDir: string;
}

export async function runUpdate(
  rest: string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
): Promise<number> {
  const { bundleFlag, alias, yes } = parseUpdateArgs(rest);
  const index = loadBundleIndex(env, cwd);
  const res = resolveTarget(index, bundleFlag, cwd, homedir());
  const entry = await resolveTargetOrPick(res, {
    index,
    env,
    verb: "update",
    interactive: isInteractive(env),
    inProject: findProjectRoot(cwd, homedir()) !== null,
  });
  const deps = entry.manifest!.deps ?? {};
  const lockPath = lockPathFor(entry.path);
  const lock = readLock(lockPath);
  const storeRoot = storeRootDir(env);

  let aliases: string[];
  if (alias !== undefined) {
    if (!(alias in deps)) {
      throw new NotFoundError(
        `umbel update: '${alias}' is not a dependency of bundle '${entry.name}'`,
      );
    }
    aliases = [alias];
  } else {
    aliases = Object.keys(deps);
  }

  const bumps: Bump[] = [];
  const noops: string[] = [];
  for (const a of aliases) {
    const coord = parseCoordinate(deps[a]!);
    if (coord.transport !== "github") {
      // link:/local deps are live and unlocked — there is no pin to move.
      noops.push(`'${a}' is a ${coord.transport}: dependency (live, unlocked) — nothing to update`);
      continue;
    }
    const url = githubUrl(coord, env);
    const tip = resolveBranchTip({ url, ref: coord.ref, coord });
    if (tip === null) {
      // A tag/commit ref pins; `update` never moves it (ADR-0013).
      noops.push(`'${a}' is pinned to ${coord.ref} (not a branch) — nothing to update`);
      continue;
    }
    const locked = lock?.deps[a];
    if (locked !== undefined && locked.commit === tip && locked.coordinate === coord.raw) {
      noops.push(`'${a}' already up to date (${tip.slice(0, 12)})`);
      continue;
    }
    // Stake exactly the resolved tip (no re-clone TOCTOU) and hash its bytes.
    const checkout = ensureCheckout({ coord, url, storeRoot, lockedCommit: tip });
    bumps.push({
      alias: a,
      before: locked,
      after: {
        coordinate: coord.raw,
        commit: checkout.commit,
        contentHash: checkout.contentHash,
      },
      afterDir: checkout.dir,
    });
  }

  if (bumps.length === 0) {
    // A named alias reports why it didn't move; a bare `update` reports the bundle.
    process.stdout.write(
      alias !== undefined && noops[0] !== undefined
        ? `${noops[0]}\n`
        : `'${entry.name}' already up to date\n`,
    );
    return 0;
  }

  // Trust gate (ADR-0014): confirm any new/changed executable (hook/MCP) content
  // the bumps pull in before advancing the lock. Gate before writing so a refusal
  // leaves the lock untouched. Mirrors the install reconcile path.
  const changes: TrustChange[] = [];
  for (const b of bumps) {
    let beforeDir: string | null = null;
    if (b.before !== undefined && b.before.commit !== b.after.commit) {
      const priorDir = checkoutPath(
        storeRoot,
        parseCoordinate(b.before.coordinate),
        b.before.commit,
      );
      if (existsSync(priorDir)) beforeDir = priorDir;
    }
    changes.push(...planTrust(beforeDir, b.afterDir));
  }
  await gateTrust({
    changes,
    interactive: isInteractive(env),
    yes,
    confirm: confirmExecTrust,
    write: (s) => process.stderr.write(s),
    what: `bundle '${entry.name}'`,
  });

  // Merge bumps into the existing lock; untouched entries (pins, other deps) stay verbatim.
  const nextDeps: Record<string, LockEntry> = { ...(lock?.deps ?? {}) };
  for (const b of bumps) nextDeps[b.alias] = b.after;
  const nextLock: LockFile = { version: 1, deps: nextDeps };
  writeLock(lockPath, nextLock);

  for (const b of bumps) {
    const from = b.before !== undefined ? `${b.before.commit.slice(0, 12)} → ` : "";
    process.stdout.write(`updated '${b.alias}': ${from}${b.after.commit.slice(0, 12)}\n`);
  }
  process.stdout.write(`lock: ${lockPath}\n`);
  return 0;
}

export async function runOutdated(
  rest: string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
): Promise<number> {
  const { bundleFlag } = parseOutdatedArgs(rest);
  const index = loadBundleIndex(env, cwd);
  const res = resolveTarget(index, bundleFlag, cwd, homedir());
  const entry = await resolveTargetOrPick(res, {
    index,
    env,
    verb: "outdated",
    interactive: isInteractive(env),
    inProject: findProjectRoot(cwd, homedir()) !== null,
  });
  const deps = entry.manifest!.deps ?? {};
  const lock = readLock(lockPathFor(entry.path));

  // Read-only: only a lightweight ls-remote per dep, no checkout is staked and
  // the lock is never written. A tag/commit pin and a link: dep are skipped —
  // only a branch tracks, so only a branch can be "outdated".
  const rows: { alias: string; coordinate: string; from: string; to: string }[] = [];
  for (const a of Object.keys(deps)) {
    const coord = parseCoordinate(deps[a]!);
    if (coord.transport !== "github") continue;
    const tip = resolveBranchTip({ url: githubUrl(coord, env), ref: coord.ref, coord });
    if (tip === null) continue;
    const locked = lock?.deps[a];
    if (locked !== undefined && locked.commit !== tip) {
      rows.push({ alias: a, coordinate: coord.raw, from: locked.commit, to: tip });
    }
  }

  if (rows.length === 0) {
    process.stdout.write("all dependencies up to date\n");
    return 0;
  }
  for (const r of rows) {
    process.stdout.write(
      `${r.alias}  ${r.coordinate}  ${r.from.slice(0, 12)} → ${r.to.slice(0, 12)}\n`,
    );
  }
  return 0;
}

export function parseOutdatedArgs(rest: string[]): { bundleFlag?: string } {
  let bundleFlag: string | undefined;
  const positionals: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === "--bundle") {
      const v = rest[i + 1];
      if (v === undefined || v.startsWith("-")) throw new UsageError("--bundle requires a value");
      bundleFlag = v;
      i++;
    } else if (a.startsWith("--bundle=")) {
      const v = a.slice("--bundle=".length);
      if (v.length === 0) throw new UsageError("--bundle requires a value");
      bundleFlag = v;
    } else if (a.startsWith("-")) {
      throw new UsageError(`umbel outdated: unknown flag: ${a}`);
    } else {
      positionals.push(a);
    }
  }
  if (positionals[0] !== undefined) {
    throw new UsageError(`umbel outdated: unexpected argument: ${positionals[0]}`);
  }
  return { ...(bundleFlag !== undefined ? { bundleFlag } : {}) };
}

export function parseUpdateArgs(rest: string[]): {
  bundleFlag?: string;
  alias?: string;
  yes: boolean;
} {
  let bundleFlag: string | undefined;
  let yes = false;
  const positionals: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === "--yes") {
      yes = true;
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
      throw new UsageError(`umbel update: unknown flag: ${a}`);
    } else {
      positionals.push(a);
    }
  }
  if (positionals.length > 1) {
    throw new UsageError(`umbel update: unexpected argument: ${positionals[1]}`);
  }
  return {
    ...(bundleFlag !== undefined ? { bundleFlag } : {}),
    ...(positionals[0] !== undefined ? { alias: positionals[0] } : {}),
    yes,
  };
}
