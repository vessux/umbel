import { NAME_RE } from "../bundle/manifest.ts";
import { UsageError } from "../errors.ts";
import { fetchAndNormalize } from "./acquire.ts";
import { deriveAlias } from "./coordinate.ts";
import { importNormalizedDir } from "./import.ts";
import { resolveGithubCoordinate } from "./store.ts";

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

  const coord = resolveGithubCoordinate(urlArg, env);
  const name = nameArg ?? deriveAlias(coord);
  if (!NAME_RE.test(name)) {
    throw new UsageError(
      `umbel adopt: invalid bundle name '${name}' (must match ${NAME_RE.source})`,
    );
  }

  const { checkout, derivedDir } = fetchAndNormalize(coord, env, "adopt");
  const commit = checkout.commit.slice(0, 12);
  await importNormalizedDir({
    dir: derivedDir,
    name,
    env,
    yes,
    headerComment: `adopted-from: ${coord.raw} (${commit})`,
    what: `repo '${coord.org}/${coord.repo}' (adopt)`,
    verb: "adopt",
  });

  process.stdout.write(`adopted '${name}' from ${coord.raw} (${commit})\n`);
  process.stdout.write(`run: umbel apply ${name} && umbel run\n`);
  return 0;
}
