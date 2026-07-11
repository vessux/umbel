import { storeRootDir } from "../bundle/env.ts";
import { NAME_RE } from "../bundle/manifest.ts";
import { UsageError } from "../errors.ts";
import { deriveAlias, githubUrl, parseCoordinate } from "./coordinate.ts";
import { parseGithubTarget } from "./github-target.ts";
import { importNormalizedDir } from "./import.ts";
import { ensureNormalized } from "./normalize.ts";
import { ensureCheckout, resolveDefaultBranch } from "./store.ts";

export async function runAdopt(
  rest: string[],
  env: NodeJS.ProcessEnv,
  _cwd: string,
): Promise<number> {
  let yes = false;
  const positionals: string[] = [];
  for (const a of rest) {
    if (a === "--yes") yes = true;
    else if (a.startsWith("-")) throw new UsageError(`umbel adopt: unknown flag: ${a}`);
    else positionals.push(a);
  }
  const [urlArg, nameArg, extra] = positionals;
  if (urlArg === undefined) throw new UsageError("umbel adopt: a GitHub URL is required");
  if (extra !== undefined) throw new UsageError(`umbel adopt: unexpected argument: ${extra}`);

  const target = parseGithubTarget(urlArg);
  const provisional = parseCoordinate(`github:${target.org}/${target.repo}@HEAD`);
  const url = githubUrl(provisional, env);
  const branch = target.ref ?? resolveDefaultBranch(url);
  const coord = parseCoordinate(`github:${target.org}/${target.repo}@${branch}`);

  const name = nameArg ?? deriveAlias(coord);
  if (!NAME_RE.test(name)) {
    throw new UsageError(
      `umbel adopt: invalid bundle name '${name}' (must match ${NAME_RE.source})`,
    );
  }

  const checkout = ensureCheckout({ coord, url, storeRoot: storeRootDir(env) });
  const {
    dir: derivedDir,
    artifacts,
    warnings,
  } = ensureNormalized(checkout.dir, storeRootDir(env));
  if (artifacts.length === 0)
    throw new UsageError(`umbel adopt: no artifacts found in ${coord.raw}`);
  for (const w of warnings) process.stderr.write(`${w}\n`);

  const commit = checkout.commit.slice(0, 12);
  await importNormalizedDir({
    dir: derivedDir,
    name,
    env,
    yes,
    headerComment: `adopted-from: ${coord.raw} (${commit})`,
    what: `repo '${target.org}/${target.repo}' (adopt)`,
    verb: "adopt",
  });

  process.stdout.write(`adopted '${name}' from ${coord.raw} (${commit})\n`);
  process.stdout.write(`run: umbel apply ${name} && umbel run\n`);
  return 0;
}
