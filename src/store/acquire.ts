import { storeRootDir } from "../bundle/env.ts";
import { UsageError } from "../errors.ts";
import { type GithubCoordinate, githubUrl } from "./coordinate.ts";
import { type IndexedArtifact, ensureNormalized } from "./normalize.ts";
import { type Checkout, ensureCheckout } from "./store.ts";

export interface Acquisition {
  checkout: Checkout;
  derivedDir: string;
  artifacts: IndexedArtifact[];
}

/**
 * The shared `try`/`adopt` step after a coordinate is resolved: check the repo
 * out and normalize it into a derived umbel dir. Warnings go to stderr and an
 * empty result throws `umbel <verb>: no artifacts` (before warnings are
 * flushed), matching both call sites — `verb` only shapes that message.
 *
 * Callers resolve the coordinate first (via `resolveGithubCoordinate`) so they
 * can act on it — derive/validate a name, message the user — before the fetch.
 */
export function fetchAndNormalize(
  coord: GithubCoordinate,
  env: NodeJS.ProcessEnv,
  verb: "try" | "adopt",
): Acquisition {
  const checkout = ensureCheckout({
    coord,
    url: githubUrl(coord, env),
    storeRoot: storeRootDir(env),
  });
  const {
    dir: derivedDir,
    artifacts,
    warnings,
  } = ensureNormalized(checkout.dir, storeRootDir(env));
  if (artifacts.length === 0)
    throw new UsageError(`umbel ${verb}: no artifacts found in ${coord.raw}`);
  for (const w of warnings) process.stderr.write(`${w}\n`);

  return { checkout, derivedDir, artifacts };
}
