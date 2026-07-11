import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { emitPluginLayout } from "../bundle/compile.ts";
import { loadBundleIndex, resolveBundle } from "../bundle/exec.ts";
import { hashBundle } from "../bundle/hash.ts";
import { findProjectRoot } from "../bundle/pin.ts";
import { ConflictError, UsageError } from "../errors.ts";
import { isInteractive } from "../tty.ts";
import { lockPathFor } from "./lock.ts";
import { resolveTarget, resolveTargetOrPick } from "./target.ts";

export async function runPack(
  rest: string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
): Promise<number> {
  const { bundleFlag, outFlag } = parsePackArgs(rest);
  const index = loadBundleIndex(env, cwd);
  const res = resolveTarget(index, bundleFlag, cwd, homedir());
  const entry = await resolveTargetOrPick(res, {
    index,
    env,
    verb: "pack",
    interactive: isInteractive(env),
    inProject: findProjectRoot(cwd, homedir()) !== null,
  });

  const outDir = resolve(cwd, outFlag ?? entry.name);
  if (existsSync(outDir)) {
    throw new ConflictError(`umbel pack: ${outDir} already exists (pass a different --out)`);
  }

  const { resolved, sources } = resolveBundle(entry.name, index, env, { materialize: true });
  const version = `0.0.0+${hashBundle(resolved, sources)}`;

  const partial = `${outDir}.partial`;
  rmSync(partial, { recursive: true, force: true });

  emitPluginLayout(resolved, sources, version, partial, {
    artifactMode: "copy",
    mcpCommandBase: (canonical) => `\${CLAUDE_PLUGIN_ROOT}/mcps/${canonical}`,
    emitSettings: false,
  });

  const umbelDir = join(partial, ".umbel");
  mkdirSync(umbelDir, { recursive: true });
  writeFileSync(join(umbelDir, "bundle.md"), readFileSync(entry.path, "utf8"));
  const srcLock = lockPathFor(entry.path);
  if (existsSync(srcLock)) {
    writeFileSync(join(umbelDir, `${entry.name}.lock`), readFileSync(srcLock, "utf8"));
  }

  renameSync(partial, outDir);
  process.stdout.write(`packed '${entry.name}' → ${outDir}\n`);
  return 0;
}

function parsePackArgs(rest: string[]): { bundleFlag?: string; outFlag?: string } {
  const positionals: string[] = [];
  let bundleFlag: string | undefined;
  let outFlag: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === "--bundle" || a === "--out") {
      const v = rest[i + 1];
      if (v === undefined || v.startsWith("-")) throw new UsageError(`${a} requires a value`);
      if (a === "--bundle") bundleFlag = v;
      else outFlag = v;
      i++;
    } else if (a.startsWith("--bundle=")) {
      bundleFlag = requireValue(a, "--bundle=");
    } else if (a.startsWith("--out=")) {
      outFlag = requireValue(a, "--out=");
    } else if (a.startsWith("-")) {
      throw new UsageError(`umbel pack: unknown flag: ${a}`);
    } else {
      positionals.push(a);
    }
  }
  const [nameArg, extra] = positionals;
  if (extra !== undefined) throw new UsageError(`umbel pack: unexpected argument: ${extra}`);
  if (nameArg !== undefined) {
    if (bundleFlag !== undefined) {
      throw new UsageError(
        `umbel pack: bundle specified twice (--bundle ${bundleFlag} and '${nameArg}')`,
      );
    }
    bundleFlag = nameArg;
  }
  return {
    ...(bundleFlag !== undefined ? { bundleFlag } : {}),
    ...(outFlag !== undefined ? { outFlag } : {}),
  };
}

function requireValue(arg: string, prefix: string): string {
  const v = arg.slice(prefix.length);
  if (v.length === 0) throw new UsageError(`${prefix.slice(0, -1)} requires a value`);
  return v;
}
