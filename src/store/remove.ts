import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { loadBundleIndex } from "../bundle/exec.ts";
import type { BundleManifest } from "../bundle/manifest.ts";
import { NotFoundError, UsageError } from "../errors.ts";
import { isInteractive } from "../tty.ts";
import { type LockFile, lockPathFor, readLock, writeLock } from "./lock.ts";
import { removeDepEdit, removeRefEdit } from "./manifest-edit.ts";
import { resolveTarget, resolveTargetOrPick } from "./target.ts";

function ownRefs(m: BundleManifest): string[] {
  return [...(m.skills ?? []), ...(m.agents ?? []), ...(m.hooks ?? []), ...(m.mcps ?? [])];
}

export async function runRemove(
  rest: string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
): Promise<number> {
  const { targetArg, bundleFlag } = parseRemoveArgs(rest);
  const index = loadBundleIndex(env, cwd);
  const res = resolveTarget(index, bundleFlag, cwd, homedir());
  const entry = await resolveTargetOrPick(res, {
    index,
    env,
    verb: "remove",
    interactive: isInteractive(env),
  });
  const manifest = entry.manifest!;
  const raw = readFileSync(entry.path, "utf8");

  if (targetArg.includes("/")) {
    const ref = targetArg;
    const alias = ref.slice(0, ref.indexOf("/"));
    if (!ownRefs(manifest).includes(ref)) {
      const hint = manifest.extends?.length
        ? " (if it's inherited via 'extends', 'umbel fork' to diverge)"
        : "";
      throw new NotFoundError(
        `umbel remove: '${ref}' is not composed in bundle '${entry.name}'${hint}`,
      );
    }
    const edited = removeRefEdit(raw, ref);
    writeFileSync(entry.path, edited);
    process.stdout.write(`removed '${ref}' from bundle '${entry.name}'\n`);
    const remaining = ownRefs(manifest).filter((r) => r !== ref && r.startsWith(`${alias}/`));
    if (remaining.length === 0) {
      process.stdout.write(
        `note: dependency '${alias}' is now unused — 'umbel remove ${alias}' to drop it\n`,
      );
    }
    return 0;
  }

  const alias = targetArg;
  if (manifest.deps?.[alias] === undefined) {
    throw new NotFoundError(
      `umbel remove: dependency '${alias}' not found in bundle '${entry.name}'`,
    );
  }
  const edited = removeDepEdit(raw, alias);
  const lockPath = lockPathFor(entry.path);
  const lock = readLock(lockPath);
  writeFileSync(entry.path, edited);
  if (lock && lock.deps[alias] !== undefined) {
    const { [alias]: _drop, ...restDeps } = lock.deps;
    const nextLock: LockFile = { version: 1, deps: restDeps };
    writeLock(lockPath, nextLock);
  }
  process.stdout.write(`removed dependency '${alias}' from bundle '${entry.name}'\n`);
  return 0;
}

function parseRemoveArgs(rest: string[]): { targetArg: string; bundleFlag?: string } {
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
      throw new UsageError(`umbel remove: unknown flag: ${a}`);
    } else {
      positionals.push(a);
    }
  }
  const [targetArg, extra] = positionals;
  if (targetArg === undefined) {
    throw new UsageError("umbel remove: expected <alias> or <alias>/<leaf>");
  }
  if (extra !== undefined) throw new UsageError(`umbel remove: unexpected argument: ${extra}`);
  return { targetArg, ...(bundleFlag !== undefined ? { bundleFlag } : {}) };
}
