import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyPlan } from "./applier/apply.ts";
import { BUNDLE_VERBS, helpText, parseArgs, parseSubcommand } from "./args.ts";
import { gcBundles, listBundleNames } from "./bundle/cache.ts";
import { compile } from "./bundle/compile.ts";
import { artifactRoots, bundleCacheRoot, projectBundlesDir, userBundlesDir } from "./bundle/env.ts";
import {
  type BundleIndex,
  loadBundleIndex,
  prepareBundleInvocation,
  resolveBundle,
  resolveBundleName,
} from "./bundle/exec.ts";
import { renderList } from "./bundle/list.ts";
import { readPin, removePin, writePin } from "./bundle/pin.ts";
import { renderShow } from "./bundle/show.ts";
import { detectCapabilities } from "./config.ts";
import { CliError, UsageError } from "./errors.ts";
import { renderPlanDiff } from "./planner/diff.ts";
import { buildPlan } from "./planner/plan.ts";
import { disambiguateSkills } from "./source/disambiguate.ts";
import { scanSource } from "./source/scan.ts";
import { probeAll } from "./state/probe.ts";
import { resolveInteractiveTargets, targetFromOverride } from "./target/resolve.ts";
import type { Capabilities, Options, Target } from "./types.ts";
import { runInitWizard } from "./ui/bundle-init.ts";
import { pickBundle } from "./ui/bundle-picker.ts";
import { askCustomPath, confirmApply } from "./ui/confirm.ts";
import { pickSkills } from "./ui/picker.ts";
import { promptTarget } from "./ui/target-prompt.ts";

function readVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [join(here, "../package.json"), join(here, "package.json")]) {
    try {
      const pkg = JSON.parse(readFileSync(candidate, "utf8")) as { version?: string };
      if (pkg.version) return pkg.version;
    } catch {}
  }
  return "0.0.0";
}

function termWidth(): number {
  return typeof process.stdout.columns === "number" && process.stdout.columns > 0
    ? process.stdout.columns
    : 80;
}

export async function run(argv: string[], env: NodeJS.ProcessEnv, cwd: string): Promise<number> {
  try {
    return await runInner(argv, env, cwd);
  } catch (err) {
    if (err instanceof CliError) {
      process.stderr.write(`${err.message}\n`);
      return err.exitCode;
    }
    throw err;
  }
}

async function runInner(argv: string[], env: NodeJS.ProcessEnv, cwd: string): Promise<number> {
  const sub = parseSubcommand(argv);
  if (sub.kind === "help") {
    process.stdout.write(helpText());
    return 0;
  }
  if (sub.kind === "version") {
    process.stdout.write(`umbel ${readVersion()}\n`);
    return 0;
  }
  if (sub.kind === "error") {
    process.stderr.write(`${sub.message}\n`);
    return 2;
  }
  if (sub.kind === "skills") {
    return runSkills(sub.rest, env, cwd);
  }
  return runBundleVerb(sub.verb, sub.rest, env, cwd);
}

async function runBundleVerb(
  verb: string,
  rest: string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
): Promise<number> {
  if (verb === "list") return runBundleList(env, cwd);
  if (verb === "show") return runBundleShow(rest, env, cwd);
  if (verb === "build") return runBundleBuild(rest, env, cwd);
  if (verb === "apply") return runBundleApply(rest, env, cwd);
  if (verb === "unpin") return runBundleUnpin(cwd);
  if (verb === "run") return runBundleRun(rest, env, cwd);
  if (verb === "gc") return runBundleGc(rest, env);
  return runBundleInit(env, cwd);
}

function runBundleGc(rest: string[], env: NodeJS.ProcessEnv): number {
  if (rest.length > 0) {
    process.stderr.write("umbel gc: takes no arguments\n");
    return 2;
  }
  const cacheRoot = bundleCacheRoot(env);
  const names = listBundleNames(cacheRoot);
  if (names.length === 0) {
    process.stdout.write("nothing to gc\n");
    return 0;
  }
  for (const name of names) {
    gcBundles(cacheRoot, name);
  }
  const noun = names.length === 1 ? "bundle" : "bundles";
  process.stdout.write(`gc'd ${names.length} ${noun}\n`);
  return 0;
}

function runBundleInit(env: NodeJS.ProcessEnv, cwd: string): Promise<number> {
  if (!isInteractive(env)) {
    process.stderr.write("umbel init: requires a TTY\n");
    return Promise.resolve(2);
  }
  return runInitWizard({
    userBundlesDir: userBundlesDir(env),
    projectBundlesDir: projectBundlesDir(cwd, homedir()),
    cwd,
    home: homedir(),
    artifactRoots: artifactRoots(env),
  });
}

function isInteractive(env: NodeJS.ProcessEnv): boolean {
  if (env.NO_TTY === "1") return false;
  return Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY);
}

async function pickBundleOrError(
  index: BundleIndex,
  env: NodeJS.ProcessEnv,
  cwd: string,
  verb: string,
): Promise<string | number> {
  if (!isInteractive(env)) {
    process.stderr.write(`umbel ${verb}: bundle name required (non-TTY)\n`);
    return 2;
  }
  if (index.entries.length === 0) {
    process.stderr.write(`umbel ${verb}: no bundles found\n`);
    return 3;
  }
  const pin = readPin(cwd, homedir());
  const pickOpts: Parameters<typeof pickBundle>[0] = {
    entries: index.entries,
    message: `Select bundle (${verb}):`,
  };
  if (pin) pickOpts.pinnedName = pin.name;
  const picked = await pickBundle(pickOpts);
  return picked ?? 2;
}

async function runBundleRun(rest: string[], env: NodeJS.ProcessEnv, cwd: string): Promise<number> {
  const idx = rest.indexOf("--");
  const ownArgs = idx === -1 ? rest : rest.slice(0, idx);
  const claudeArgs = idx === -1 ? [] : rest.slice(idx + 1);
  let resolvedName: string;
  let pickedIndex: BundleIndex | undefined;
  const resolved = resolveBundleName(ownArgs, env, cwd, homedir());
  if ("error" in resolved) {
    pickedIndex = loadBundleIndex(env, cwd);
    const picked = await pickBundleOrError(pickedIndex, env, cwd, "run");
    if (typeof picked === "number") return picked;
    resolvedName = picked;
  } else {
    resolvedName = resolved.name;
  }
  const prepared = prepareBundleInvocation({
    name: resolvedName,
    claudeArgs,
    env,
    cwd,
    ...(pickedIndex ? { preloadedIndex: pickedIndex } : {}),
  });
  const result = spawnSync(prepared.command, prepared.args, {
    env: prepared.env as NodeJS.ProcessEnv,
    stdio: "inherit",
  });
  if (result.error && (result.error as NodeJS.ErrnoException).code === "ENOENT") {
    process.stderr.write(`umbel run: '${prepared.command}' not found on PATH\n`);
    return 1;
  }
  return result.status ?? 1;
}

async function runBundleApply(
  rest: string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
): Promise<number> {
  const index = loadBundleIndex(env, cwd);
  let name = rest[0];
  if (name === undefined) {
    const picked = await pickBundleOrError(index, env, cwd, "apply");
    if (typeof picked === "number") return picked;
    name = picked;
  }
  const built = buildBundle(name, index, env);
  const path = writePin(cwd, homedir(), name);
  process.stdout.write(`pinned bundle '${name}' at ${path}\n`);
  process.stdout.write(`built ${built}\n`);
  return 0;
}

function buildBundle(
  name: string,
  index: BundleIndex,
  env: NodeJS.ProcessEnv,
  forceRebuild = false,
): string {
  const { resolved, sources } = resolveBundle(name, index, env);
  return compile(resolved, sources, { cacheRoot: bundleCacheRoot(env), forceRebuild });
}

function runBundleUnpin(cwd: string): number {
  const removed = removePin(cwd, homedir());
  if (removed) {
    process.stdout.write("unpinned\n");
  } else {
    process.stdout.write("no pin to remove\n");
  }
  return 0;
}

function runBundleList(env: NodeJS.ProcessEnv, cwd: string): number {
  const index = loadBundleIndex(env, cwd);
  process.stdout.write(
    renderList(index.entries, { userDir: index.userDir, projectDir: index.projectDir }),
  );
  return 0;
}

async function runBundleBuild(
  rest: string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
): Promise<number> {
  const args = rest.filter((a) => a !== "--no-cache");
  const noCache = rest.includes("--no-cache");
  const index = loadBundleIndex(env, cwd);
  let name = args[0];
  if (name === undefined) {
    const picked = await pickBundleOrError(index, env, cwd, "build");
    if (typeof picked === "number") return picked;
    name = picked;
  }
  const built = buildBundle(name, index, env, noCache);
  process.stdout.write(`${built}\n`);
  return 0;
}

async function runBundleShow(rest: string[], env: NodeJS.ProcessEnv, cwd: string): Promise<number> {
  const index = loadBundleIndex(env, cwd);
  let name = rest[0];
  if (name === undefined) {
    const picked = await pickBundleOrError(index, env, cwd, "show");
    if (typeof picked === "number") return picked;
    name = picked;
  }
  const { resolved, sources } = resolveBundle(name, index, env);
  const projectMcpPath = join(cwd, ".mcp.json");
  process.stdout.write(renderShow(resolved, sources, { projectMcpPath }));
  return 0;
}

async function runSkills(argv: string[], env: NodeJS.ProcessEnv, cwd: string): Promise<number> {
  const opts: Options = parseArgs(argv, { cwd, env });

  if (opts.help) {
    process.stdout.write(helpText());
    return 0;
  }
  if (opts.version) {
    process.stdout.write(`umbel ${readVersion()}\n`);
    return 0;
  }

  const caps: Capabilities = detectCapabilities({
    env,
    stdinIsTTY: Boolean(process.stdin.isTTY),
    stdoutIsTTY: Boolean(process.stdout.isTTY),
    skillsFlagPresent: opts.skills !== null,
  });

  if (caps.interactive) {
    return runInteractive(opts, caps, cwd);
  }
  return runNonInteractive(opts, caps);
}

async function runNonInteractive(opts: Options, caps: Capabilities): Promise<number> {
  if (opts.target === null) {
    throw new UsageError("--target is required in non-interactive mode");
  }
  if (opts.skills === null) {
    throw new UsageError("--skills is required in non-interactive mode");
  }

  const skills = disambiguateSkills(scanSource(opts.source));
  const target: Target = targetFromOverride(opts.target);
  const rows = probeAll(skills, target.path, opts.force);
  const selection = new Set(opts.skills);
  const plan = buildPlan(rows, selection, target, { force: opts.force });
  const diff = renderPlanDiff(plan, { color: caps.color });

  if (opts.dryRun) {
    process.stdout.write(`${diff}\n`);
    return 0;
  }
  process.stderr.write(`${diff}\n`);
  applyPlan(plan);
  return 0;
}

async function runInteractive(opts: Options, caps: Capabilities, cwd: string): Promise<number> {
  let target: Target;
  if (opts.target !== null) {
    target = targetFromOverride(opts.target);
  } else {
    const choices = resolveInteractiveTargets(cwd, homedir());
    target = await promptTarget(choices, async () => {
      const p = await askCustomPath();
      return isAbsolute(p) ? p : pathResolve(cwd, p);
    });
  }

  const skills = disambiguateSkills(scanSource(opts.source));
  const rows = probeAll(skills, target.path, opts.force);

  if (rows.length === 0) {
    process.stderr.write(`No skills found in ${opts.source}\n`);
    return 0;
  }

  const selection = await pickSkills(rows, caps, termWidth());

  const plan = buildPlan(rows, selection, target, { force: opts.force });
  const diff = renderPlanDiff(plan, { color: caps.color });
  process.stdout.write(`\n${diff}\n\n`);

  if (opts.dryRun) {
    return 0;
  }
  if (plan.entries.length === 0) {
    return 0;
  }

  const ok = await confirmApply();
  if (!ok) return 0;
  applyPlan(plan);
  return 0;
}

// BUNDLE_VERBS export retained for tests
export { BUNDLE_VERBS };
