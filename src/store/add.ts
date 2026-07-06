import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { storeRootDir } from "../bundle/env.ts";
import { type BundleIndex, loadBundleIndex } from "../bundle/exec.ts";
import { readPin } from "../bundle/pin.ts";
import { UsageError } from "../errors.ts";
import { listSkillLeaves } from "./artifacts.ts";
import { deriveAlias, githubUrl, parseCoordinate } from "./coordinate.ts";
import { type LockFile, lockPathFor, readLock, serializeLock, writeLock } from "./lock.ts";
import { addDepEdit } from "./manifest-edit.ts";
import { ensureCheckout } from "./store.ts";

export function runAdd(rest: string[], env: NodeJS.ProcessEnv, cwd: string): number {
  const { coordinateArg, leafArg, bundleFlag } = parseAddArgs(rest);
  const coord = parseCoordinate(coordinateArg);
  const alias = deriveAlias(coord);

  const index = loadBundleIndex(env, cwd);
  const entry = resolveTargetBundle(index, bundleFlag, cwd);

  const manifest = entry.manifest!;
  const existingCoord = manifest.deps?.[alias];
  if (existingCoord !== undefined && existingCoord !== coord.raw) {
    throw new UsageError(
      `umbel add: alias '${alias}' is already bound to ${existingCoord} in bundle '${entry.name}'`,
    );
  }

  const lockPath = lockPathFor(entry.path);
  const lock: LockFile = readLock(lockPath) ?? { version: 1, deps: {} };
  const locked = lock.deps[alias];
  const lockedCommit =
    locked !== undefined && locked.coordinate === coord.raw ? locked.commit : undefined;

  const checkout = ensureCheckout({
    coord,
    url: githubUrl(coord, env),
    storeRoot: storeRootDir(env),
    ...(lockedCommit !== undefined ? { lockedCommit } : {}),
  });

  const leaves = listSkillLeaves(checkout.dir);
  if (leaves.size === 0) {
    throw new UsageError(`umbel add: no skills found in ${coord.raw}`);
  }
  let leaf = leafArg;
  if (leaf === undefined) {
    if (leaves.size > 1) {
      const sorted = [...leaves.keys()].sort();
      const bundleHint = bundleFlag !== undefined ? ` --bundle ${entry.name}` : "";
      throw new UsageError(
        `umbel add: ${coord.raw} has ${leaves.size} skills; pick one: umbel add ${coord.raw} <leaf>${bundleHint}\n  ${sorted.join(", ")}`,
      );
    }
    leaf = [...leaves.keys()][0]!;
  }
  if (!leaves.has(leaf)) {
    throw new UsageError(
      `umbel add: skill '${leaf}' not found in ${coord.raw} (found: ${[...leaves.keys()].sort().join(", ")})`,
    );
  }

  const nextLock: LockFile = {
    version: 1,
    deps: {
      ...lock.deps,
      [alias]: {
        coordinate: coord.raw,
        commit: checkout.commit,
        contentHash: checkout.contentHash,
      },
    },
  };
  let currentLockRaw: string | null = null;
  try {
    currentLockRaw = readFileSync(lockPath, "utf8");
  } catch {}
  const lockChanged = currentLockRaw !== serializeLock(nextLock);

  const ref = `${alias}/${leaf}`;
  const raw = readFileSync(entry.path, "utf8");
  // Compute the manifest edit before any write: a throwing edit must not
  // leave an orphan lock entry behind.
  const edited = addDepEdit(raw, alias, coord.raw, ref);
  const manifestChanged = edited !== raw;

  if (lockChanged) writeLock(lockPath, nextLock);
  if (manifestChanged) writeFileSync(entry.path, edited);

  if (!lockChanged && !manifestChanged) {
    process.stdout.write(`'${alias}' already up to date (${checkout.commit.slice(0, 12)})\n`);
    return 0;
  }
  process.stdout.write(
    `added dependency '${alias}' → ${coord.raw} (${checkout.commit.slice(0, 12)})\n`,
  );
  process.stdout.write(`composed skills/${ref} into bundle '${entry.name}'\n`);
  process.stdout.write(`lock: ${lockPath}\n`);
  return 0;
}

function parseAddArgs(rest: string[]): {
  coordinateArg: string;
  leafArg?: string;
  bundleFlag?: string;
} {
  const positionals: string[] = [];
  let bundleFlag: string | undefined;
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
      throw new UsageError(`umbel add: unknown flag: ${a}`);
    } else {
      positionals.push(a);
    }
  }
  const [coordinateArg, leafArg, extra] = positionals;
  if (coordinateArg === undefined) {
    throw new UsageError("umbel add: coordinate required (e.g. github:<org>/<repo>@<tag>)");
  }
  if (extra !== undefined) throw new UsageError(`umbel add: unexpected argument: ${extra}`);
  return {
    coordinateArg,
    ...(leafArg !== undefined ? { leafArg } : {}),
    ...(bundleFlag !== undefined ? { bundleFlag } : {}),
  };
}

function resolveTargetBundle(index: BundleIndex, bundleFlag: string | undefined, cwd: string) {
  let name = bundleFlag;
  if (name === undefined) {
    const pin = readPin(cwd, homedir());
    const only = pin?.candidates.length === 1 ? pin.candidates[0] : undefined;
    if (only?.kind === "bundle") name = only.name;
  }
  if (name === undefined) {
    throw new UsageError(
      "umbel add: no target bundle (pass --bundle <name>, or pin one with 'umbel apply <name>')",
    );
  }
  const entry = index.entries.find((e) => e.name === name && !e.shadowed);
  if (entry === undefined) {
    throw new UsageError(`umbel add: bundle '${name}' not found`);
  }
  if (entry.malformed || entry.manifest === undefined) {
    throw new UsageError(entry.error ?? `umbel add: bundle '${name}' is malformed`);
  }
  return entry;
}
