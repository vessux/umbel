import { UsageError } from "../errors.ts";

export interface Coordinate {
  transport: "github";
  org: string;
  repo: string;
  ref: string;
  raw: string;
}

const SUPPORTED_HINT = "this slice supports github:<org>/<repo>@<tag>";
const NAME_PART_RE = /^[A-Za-z0-9._-]+$/;

export function parseCoordinate(raw: string): Coordinate {
  for (const t of ["git:", "link:"]) {
    if (raw.startsWith(t)) {
      throw new UsageError(`coordinate '${raw}': '${t}' is not supported yet (${SUPPORTED_HINT})`);
    }
  }
  if (raw === "local") {
    throw new UsageError(`coordinate 'local' is not supported yet (${SUPPORTED_HINT})`);
  }
  if (!raw.startsWith("github:")) {
    throw new UsageError(`coordinate '${raw}': unrecognized shape (${SUPPORTED_HINT})`);
  }
  if (raw.includes("#")) {
    throw new UsageError(`coordinate '${raw}': #subpath is not supported yet (${SUPPORTED_HINT})`);
  }
  const rest = raw.slice("github:".length);
  const slash = rest.indexOf("/");
  if (slash <= 0) {
    throw new UsageError(`coordinate '${raw}': expected github:<org>/<repo>@<tag>`);
  }
  const org = rest.slice(0, slash);
  const at = rest.indexOf("@", slash + 1);
  if (at === -1) {
    throw new UsageError(
      `coordinate '${raw}': a pinned ref is required — append @<tag> (e.g. github:${rest}@v1.0.0)`,
    );
  }
  const repo = rest.slice(slash + 1, at);
  const ref = rest.slice(at + 1);
  if (!NAME_PART_RE.test(org) || !NAME_PART_RE.test(repo)) {
    throw new UsageError(`coordinate '${raw}': invalid org/repo (allowed: letters, digits, . _ -)`);
  }
  if (ref.length === 0 || /\s/.test(ref)) {
    throw new UsageError(`coordinate '${raw}': invalid ref`);
  }
  return { transport: "github", org, repo, ref, raw };
}

export function githubUrl(coord: Coordinate, env: NodeJS.ProcessEnv): string {
  const base = (env.UMBEL_GITHUB_BASE ?? "https://github.com").replace(/\/+$/, "");
  return `${base}/${coord.org}/${coord.repo}`;
}

export const ALIAS_RE = /^[a-z][a-z0-9-]{0,40}$/;

export function deriveAlias(coord: Coordinate): string {
  const alias = coord.repo
    .toLowerCase()
    .replace(/\.git$/, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!ALIAS_RE.test(alias)) {
    throw new UsageError(
      `cannot derive a valid alias from repo '${coord.repo}' (alias must match ${ALIAS_RE.source})`,
    );
  }
  return alias;
}
