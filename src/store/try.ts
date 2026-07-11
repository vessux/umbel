import { spawnSync } from "node:child_process";
import { computeClaudeArgs } from "../bundle/claude-args.ts";
import { compile } from "../bundle/compile.ts";
import type { ResolvedBundle } from "../bundle/compose.ts";
import { bundleCacheRoot, shimDir, storeRootDir, stripFromPath } from "../bundle/env.ts";
import { ARTIFACT_KINDS, type ArtifactKind } from "../bundle/kinds.ts";
import type { ResolvedSources } from "../bundle/resolve.ts";
import { UsageError } from "../errors.ts";
import { isInteractive } from "../tty.ts";
import { confirmExecTrust } from "../ui/prompt.ts";
import { deriveAlias, githubUrl, parseCoordinate } from "./coordinate.ts";
import { parseGithubTarget } from "./github-target.ts";
import { ensureNormalized } from "./normalize.ts";
import { ensureCheckout, resolveDefaultBranch } from "./store.ts";
import { gateTrust, planTrust } from "./trust.ts";

export async function runTry(rest: string[], env: NodeJS.ProcessEnv, cwd: string): Promise<number> {
  void cwd;
  const dd = rest.indexOf("--");
  const own = dd === -1 ? rest : rest.slice(0, dd);
  const passthrough = dd === -1 ? [] : rest.slice(dd + 1);
  let yes = false;
  const positionals: string[] = [];
  for (const a of own) {
    if (a === "--yes") yes = true;
    else if (a.startsWith("-")) throw new UsageError(`umbel try: unknown flag: ${a}`);
    else positionals.push(a);
  }
  const [urlArg, extra] = positionals;
  if (urlArg === undefined) throw new UsageError("umbel try: a GitHub URL is required");
  if (extra !== undefined) throw new UsageError(`umbel try: unexpected argument: ${extra}`);

  const target = parseGithubTarget(urlArg);
  const provisional = parseCoordinate(`github:${target.org}/${target.repo}@HEAD`);
  const url = githubUrl(provisional, env);
  const branch = target.ref ?? resolveDefaultBranch(url);
  const coord = parseCoordinate(`github:${target.org}/${target.repo}@${branch}`);

  const checkout = ensureCheckout({ coord, url, storeRoot: storeRootDir(env) });
  const {
    dir: derivedDir,
    artifacts,
    warnings,
  } = ensureNormalized(checkout.dir, storeRootDir(env));
  if (artifacts.length === 0) throw new UsageError(`umbel try: no artifacts found in ${coord.raw}`);
  for (const w of warnings) process.stderr.write(`${w}\n`);

  await gateTrust({
    changes: planTrust(null, derivedDir),
    interactive: isInteractive(env),
    yes,
    confirm: confirmExecTrust,
    write: (s) => process.stderr.write(s),
    what: `repo '${target.org}/${target.repo}' (try)`,
  });

  const name = deriveAlias(coord);
  const lists: Record<ArtifactKind, string[]> = { skills: [], agents: [], hooks: [], mcps: [] };
  const sources: ResolvedSources = {
    skills: new Map(),
    agents: new Map(),
    hooks: new Map(),
    mcps: new Map(),
    warnings: [],
  };
  for (const a of artifacts) {
    const qref = `${name}/${a.leaf}`;
    lists[a.kind].push(qref);
    sources[a.kind].set(qref, a.dir);
  }
  const resolved: ResolvedBundle = { name, sourcePath: "", body: "" };
  for (const k of ARTIFACT_KINDS) if (lists[k].length > 0) resolved[k] = lists[k];

  const { cacheDir, version } = compile(resolved, sources, { cacheRoot: bundleCacheRoot(env) });

  const spawnEnv: NodeJS.ProcessEnv = {
    ...env,
    UMBEL_BUNDLE: name,
    UMBEL_RESOLVED: "1",
    UMBEL_RESOLVED_DIR: cacheDir,
    UMBEL_BUNDLE_VERSION: version,
  };
  const filteredPath = stripFromPath(env.PATH, shimDir(env));
  if (filteredPath !== undefined) spawnEnv.PATH = filteredPath;

  const result = spawnSync("claude", [...computeClaudeArgs(resolved, cacheDir), ...passthrough], {
    env: spawnEnv,
    stdio: "inherit",
  });
  if (result.error && (result.error as NodeJS.ErrnoException).code === "ENOENT") {
    process.stderr.write("umbel try: 'claude' not found on PATH\n");
    return 1;
  }
  return result.status ?? 1;
}
