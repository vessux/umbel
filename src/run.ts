import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { BUNDLE_VERBS, helpText, parseSubcommand } from "./args.ts";
import { gcBundles, listBundleNames } from "./bundle/cache.ts";
import { compile } from "./bundle/compile.ts";
import {
  artifactRoots,
  bundleCacheRoot,
  projectBundlesDir,
  shimDir,
  shimPath,
  stripFromPath,
  userBundlesDir,
} from "./bundle/env.ts";
import {
  type BundleIndex,
  loadBundleIndex,
  prepareBundleInvocation,
  resolveBundle,
  resolveBundleName,
} from "./bundle/exec.ts";
import { type RenderListOpts, renderList } from "./bundle/list.ts";
import {
  isMultiCandidatePin,
  readPin,
  removePin,
  writePin,
  writeVanillaPin,
} from "./bundle/pin.ts";
import { renderShow } from "./bundle/show.ts";
import { CliError } from "./errors.ts";
import { installShim, uninstallShim } from "./shim/install.ts";
import { runAdd } from "./store/add.ts";
import { runInstall } from "./store/install.ts";
import { runInitWizard } from "./ui/bundle-init.ts";
import { VANILLA_PICK, pickBundle, pickScopedBundle } from "./ui/bundle-picker.ts";

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
  if (verb === "add") return runAdd(rest, env, cwd);
  if (verb === "install") return runInstall(rest, env, cwd);
  if (verb === "gc") return runBundleGc(rest, env);
  if (verb === "shim") return runShim(rest, env);
  return runBundleInit(env, cwd);
}

function runShim(rest: string[], env: NodeJS.ProcessEnv): number {
  const action = rest[0];
  const path = shimPath(env);
  if (action === "path") {
    if (rest.length > 1) {
      process.stderr.write("umbel shim path: takes no arguments\n");
      return 2;
    }
    process.stdout.write(`${path}\n`);
    return 0;
  }
  if (action === "uninstall") {
    if (rest.length > 1) {
      process.stderr.write("umbel shim uninstall: takes no arguments\n");
      return 2;
    }
    const result = uninstallShim(path);
    process.stdout.write(
      result.removed ? `removed ${result.path}\n` : `no shim at ${result.path}\n`,
    );
    return 0;
  }
  if (action === "install") {
    const force = rest.slice(1).includes("--force");
    const extra = rest.slice(1).filter((a) => a !== "--force");
    if (extra.length > 0) {
      process.stderr.write(`umbel shim install: unexpected argument: ${extra[0]}\n`);
      return 2;
    }
    const result = installShim(path, { force });
    const verb = result.overwritten ? "overwrote" : "installed";
    process.stdout.write(`${verb} ${result.path}\n`);
    process.stdout.write("\nAdd this line to your shell rc (~/.zshrc or ~/.bashrc):\n");
    process.stdout.write(`  export PATH="${dirname(result.path)}:$PATH"\n`);
    return 0;
  }
  process.stderr.write("umbel shim: expected 'install', 'uninstall', or 'path'\n");
  return 2;
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
  const def = readPin(cwd, homedir())?.candidates[0];
  const pickOpts: Parameters<typeof pickBundle>[0] = {
    entries: index.entries,
    message: `Select bundle (${verb}):`,
  };
  if (def?.kind === "bundle") pickOpts.pinnedName = def.name;
  const picked = await pickBundle(pickOpts);
  return picked ?? 2;
}

type PickRunApply =
  | { kind: "bundle"; name: string }
  | { kind: "vanilla" }
  | { kind: "exit"; code: number };

/**
 * Interactive-only picker that prepends a `(vanilla)` row. Caller must have
 * already handled the non-interactive case.
 */
async function pickBundleOrVanilla(
  index: BundleIndex,
  cwd: string,
  verb: "run" | "apply",
): Promise<PickRunApply> {
  const def = readPin(cwd, homedir())?.candidates[0];
  const pickOpts: Parameters<typeof pickBundle>[0] = {
    entries: index.entries,
    message: `Select bundle (${verb}):`,
    includeVanilla: true,
  };
  if (def?.kind === "bundle") pickOpts.pinnedName = def.name;
  if (def?.kind === "vanilla") pickOpts.pinnedVanilla = true;
  const picked = await pickBundle(pickOpts);
  if (picked === null) return { kind: "exit", code: 2 };
  if (picked === VANILLA_PICK) return { kind: "vanilla" };
  return { kind: "bundle", name: picked };
}

function execVanilla(claudeArgs: string[], env: NodeJS.ProcessEnv): number {
  const { UMBEL_BUNDLE: _drop, ...rest } = env;
  void _drop;
  const spawnEnv: NodeJS.ProcessEnv = { ...rest, UMBEL_RESOLVED: "1" };
  const filteredPath = stripFromPath(env.PATH, shimDir(env));
  if (filteredPath !== undefined) spawnEnv.PATH = filteredPath;
  const result = spawnSync("claude", claudeArgs, {
    env: spawnEnv,
    stdio: "inherit",
  });
  if (result.error && (result.error as NodeJS.ErrnoException).code === "ENOENT") {
    process.stderr.write("umbel run: 'claude' not found on PATH\n");
    return 1;
  }
  return result.status ?? 1;
}

async function runBundleRun(rest: string[], env: NodeJS.ProcessEnv, cwd: string): Promise<number> {
  const idx = rest.indexOf("--");
  const ownArgs = idx === -1 ? rest : rest.slice(0, idx);
  const claudeArgs = idx === -1 ? [] : rest.slice(idx + 1);

  if (env.UMBEL_RESOLVED === "1" && ownArgs.length === 0 && !env.UMBEL_BUNDLE) {
    return execVanilla(claudeArgs, env);
  }

  const resolved = resolveBundleName(ownArgs, env, cwd, homedir());

  if (resolved.kind === "vanilla") {
    return execVanilla(claudeArgs, env);
  }

  let resolvedName: string;
  let pickedIndex: BundleIndex | undefined;
  if (resolved.kind === "multiple") {
    if (!isInteractive(env)) {
      const def = resolved.candidates[0]!;
      if (def.kind === "vanilla") return execVanilla(claudeArgs, env);
      resolvedName = def.name;
    } else {
      pickedIndex = loadBundleIndex(env, cwd);
      const picked = await pickScopedBundle({
        candidates: resolved.candidates,
        entries: pickedIndex.entries,
        message: "Select bundle (run):",
      });
      if (picked === VANILLA_PICK) return execVanilla(claudeArgs, env);
      resolvedName = picked;
    }
  } else if (resolved.kind === "unresolved") {
    if (!isInteractive(env)) {
      return execVanilla(claudeArgs, env);
    }
    pickedIndex = loadBundleIndex(env, cwd);
    const picked = await pickBundleOrVanilla(pickedIndex, cwd, "run");
    if (picked.kind === "exit") return picked.code;
    if (picked.kind === "vanilla") return execVanilla(claudeArgs, env);
    resolvedName = picked.name;
  } else {
    resolvedName = resolved.name;
  }

  const prepared = prepareBundleInvocation({
    name: resolvedName,
    claudeArgs,
    env,
    cwd,
    ...(pickedIndex ? { preloadedIndex: pickedIndex } : {}),
    // run launches claude right after building, so a cache-miss build would
    // otherwise look like a freeze before claude's first output appears.
    onBuild: () => process.stderr.write(`building bundle '${resolvedName}'…\n`),
  });
  // On the run path the harness TUI repaints over stderr immediately, erasing
  // any warning before it can be read (ADR-0012 Axis B). When interactive, gate
  // the launch on an explicit acknowledgment; non-TTY prints and proceeds (the
  // warning survives in CI logs there, no TUI to erase it).
  await gateWarnings(prepared.warnings, isInteractive(env), acknowledgeWarnings);
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
  if (isMultiCandidatePin(cwd, homedir())) {
    process.stderr.write(
      "umbel apply: refusing to overwrite a multi-candidate pin; run 'umbel unpin' first\n",
    );
    return 2;
  }
  const wantsVanilla = rest.includes("--vanilla");
  const positional = rest.filter((a) => !a.startsWith("--"));

  if (wantsVanilla) {
    if (positional.length > 0) {
      process.stderr.write("umbel apply: --vanilla cannot be combined with a bundle name\n");
      return 2;
    }
    const path = writeVanillaPin(cwd, homedir());
    process.stdout.write(`pinned vanilla (no bundle) at ${path}\n`);
    return 0;
  }

  const index = loadBundleIndex(env, cwd);
  let name = positional[0];
  if (name === undefined) {
    if (!isInteractive(env)) {
      process.stderr.write("umbel apply: bundle name required (non-TTY)\n");
      return 2;
    }
    const picked = await pickBundleOrVanilla(index, cwd, "apply");
    if (picked.kind === "exit") return picked.code;
    if (picked.kind === "vanilla") {
      const path = writeVanillaPin(cwd, homedir());
      process.stdout.write(`pinned vanilla (no bundle) at ${path}\n`);
      return 0;
    }
    name = picked.name;
  }

  const { cacheDir, warnings } = buildBundle(name, index, env);
  emitWarnings(warnings);
  const path = writePin(cwd, homedir(), name);
  process.stdout.write(`pinned bundle '${name}' at ${path}\n`);
  process.stdout.write(`built ${cacheDir}\n`);
  return 0;
}

function emitWarnings(warnings: string[]): void {
  for (const w of warnings) process.stderr.write(`${w}\n`);
}

/**
 * Warning gate for the run path (ADR-0012 Axis B). Always emits the warnings;
 * when interactive, additionally blocks on `prompt` so the user acknowledges
 * them before the harness TUI launches and repaints over them. `prompt` is
 * injected so the decision logic is testable without real stdin.
 */
export async function gateWarnings(
  warnings: string[],
  interactive: boolean,
  prompt: () => Promise<void>,
): Promise<void> {
  if (warnings.length === 0) return;
  emitWarnings(warnings);
  if (interactive) await prompt();
}

/** Block until the user presses Enter; Ctrl-C aborts with the standard 130. */
function acknowledgeWarnings(): Promise<void> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    rl.once("SIGINT", () => {
      rl.close();
      process.stderr.write("\naborted\n");
      process.exit(130);
    });
    rl.question("Press Enter to launch despite warnings (Ctrl-C to abort)… ", () => {
      rl.close();
      resolve();
    });
  });
}

function buildBundle(
  name: string,
  index: BundleIndex,
  env: NodeJS.ProcessEnv,
  forceRebuild = false,
): { cacheDir: string; warnings: string[] } {
  const { resolved, sources, warnings } = resolveBundle(name, index, env, { materialize: true });
  const { cacheDir } = compile(resolved, sources, {
    cacheRoot: bundleCacheRoot(env),
    forceRebuild,
  });
  return { cacheDir, warnings };
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
  const pin = readPin(cwd, homedir());
  const opts: RenderListOpts = {};
  if (pin) {
    opts.pinnedNames = pin.candidates.flatMap((c) => (c.kind === "bundle" ? [c.name] : []));
    if (pin.candidates.length > 1 && pin.candidates[0]!.kind === "bundle") {
      opts.defaultName = pin.candidates[0]!.name;
    }
  }
  process.stdout.write(
    renderList(index.entries, { userDir: index.userDir, projectDir: index.projectDir }, opts),
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
  const { cacheDir, warnings } = buildBundle(name, index, env, noCache);
  emitWarnings(warnings);
  process.stdout.write(`${cacheDir}\n`);
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
  const { resolved, sources, warnings } = resolveBundle(name, index, env);
  const projectMcpPath = join(cwd, ".mcp.json");
  process.stdout.write(renderShow(resolved, sources, { projectMcpPath, warnings }));
  return 0;
}

// BUNDLE_VERBS export retained for tests
export { BUNDLE_VERBS };
