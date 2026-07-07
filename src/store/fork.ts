import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { text } from "@clack/prompts";
import type { BundleEntry } from "../bundle/discover.ts";
import { projectBundlesDir } from "../bundle/env.ts";
import { type BundleIndex, loadBundleIndex } from "../bundle/exec.ts";
import { NAME_RE } from "../bundle/manifest.ts";
import { ConflictError, NotFoundError, UsageError } from "../errors.ts";
import { isInteractive } from "../tty.ts";
import { pickBundle } from "../ui/bundle-picker.ts";
import { assertSelected } from "../ui/prompt.ts";
import { lockPathFor } from "./lock.ts";
import { renameBundleEdit } from "./manifest-edit.ts";
import { lookupBundle, resolveTarget, resolveTargetOrPick } from "./target.ts";

export async function runFork(
  rest: string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
): Promise<number> {
  const { newnameArg, bundleFlag } = parseForkArgs(rest);
  const index = loadBundleIndex(env, cwd);
  const interactive = isInteractive(env);

  const source = await resolveForkSource(index, bundleFlag, cwd, env, interactive);
  const newname = await resolveNewname(newnameArg, source.name, interactive);
  if (!NAME_RE.test(newname)) {
    throw new UsageError(
      `umbel fork: invalid bundle name '${newname}' (must match ${NAME_RE.source})`,
    );
  }

  const destDir = projectBundlesDir(cwd, homedir());
  const destPath = join(destDir, `${newname}.md`);
  if (existsSync(destPath)) {
    throw new ConflictError(`umbel fork: bundle '${newname}' already exists at ${destPath}`);
  }

  const edited = renameBundleEdit(readFileSync(source.path, "utf8"), newname);
  mkdirSync(destDir, { recursive: true });
  writeFileSync(destPath, edited);

  const srcLock = lockPathFor(source.path);
  let lockCopied = false;
  if (existsSync(srcLock)) {
    writeFileSync(lockPathFor(destPath), readFileSync(srcLock, "utf8"));
    lockCopied = true;
  }

  process.stdout.write(`forked '${source.name}' → '${newname}' (project scope)\n`);
  process.stdout.write(`wrote ${destPath}\n`);
  if (lockCopied) process.stdout.write(`lock: ${lockPathFor(destPath)}\n`);
  return 0;
}

async function resolveForkSource(
  index: BundleIndex,
  bundleFlag: string | undefined,
  cwd: string,
  env: NodeJS.ProcessEnv,
  interactive: boolean,
): Promise<BundleEntry> {
  const res = resolveTarget(index, bundleFlag, cwd, homedir());
  if (res.kind === "resolved") return res.entry;
  if (res.kind === "multiple") {
    return resolveTargetOrPick(res, { index, env, verb: "fork", interactive });
  }
  // vanilla | absent — fork can branch from ANY discoverable bundle
  if (!interactive) {
    throw new UsageError(
      "umbel fork: no source bundle — pass --bundle <name> or pin one with 'umbel apply'",
    );
  }
  const name = await pickBundle({ entries: index.entries, message: "Select a bundle to fork:" });
  if (name === null) throw new NotFoundError("umbel fork: no bundles available to fork");
  return lookupBundle(index, name);
}

async function resolveNewname(
  arg: string | undefined,
  sourceName: string,
  interactive: boolean,
): Promise<string> {
  if (arg !== undefined) return arg;
  if (!interactive) return sourceName; // shadow; the dest collision check catches same-scope clashes
  return assertSelected(
    await text({
      message: "New bundle name:",
      placeholder: sourceName,
      defaultValue: sourceName,
      validate: (v) => (NAME_RE.test(v ?? "") ? undefined : `must match ${NAME_RE.source}`),
    }),
  );
}

function parseForkArgs(rest: string[]): { newnameArg?: string; bundleFlag?: string } {
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
      throw new UsageError(`umbel fork: unknown flag: ${a}`);
    } else {
      positionals.push(a);
    }
  }
  const [newnameArg, extra] = positionals;
  if (extra !== undefined) throw new UsageError(`umbel fork: unexpected argument: ${extra}`);
  return {
    ...(newnameArg !== undefined ? { newnameArg } : {}),
    ...(bundleFlag !== undefined ? { bundleFlag } : {}),
  };
}
