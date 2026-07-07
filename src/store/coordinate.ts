import { CliError, UsageError } from "../errors.ts";

export interface GithubCoordinate {
  transport: "github";
  org: string;
  repo: string;
  ref: string;
  raw: string;
}

/** A local directory dependency — unlocked, live. `path` is stored unexpanded. */
export interface LinkCoordinate {
  transport: "link";
  path: string;
  raw: string;
}

export type Coordinate = GithubCoordinate | LinkCoordinate;

/** The built-in `local` dependency (ADR-0013): hand-authored artifacts in config. */
const LOCAL_PATH = "${UMBEL_HOME}/local";

const SUPPORTED_HINT = "this slice supports github:<org>/<repo>@<tag>, link:<path>, and local";
const NAME_PART_RE = /^[A-Za-z0-9._-]+$/;
const VAR_RE = /\$\{([^}]*)\}/g;
const VAR_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function parseCoordinate(raw: string): Coordinate {
  if (raw === "local") {
    return { transport: "link", path: LOCAL_PATH, raw };
  }
  if (raw.startsWith("link:")) {
    const path = raw.slice("link:".length);
    if (path.length === 0) {
      throw new UsageError(`coordinate '${raw}': link: requires a path (e.g. link:\${HOME}/dir)`);
    }
    return { transport: "link", path, raw };
  }
  if (raw.startsWith("git:")) {
    throw new UsageError(`coordinate '${raw}': 'git:' is not supported yet (${SUPPORTED_HINT})`);
  }
  if (!raw.startsWith("github:")) {
    throw new UsageError(`coordinate '${raw}': unrecognized shape (${SUPPORTED_HINT})`);
  }
  if (raw.includes("${")) {
    throw new UsageError(
      `coordinate '${raw}': variable expansion (\${…}) is only allowed in link: paths`,
    );
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
  if (org === "." || org === ".." || repo === "." || repo === "..") {
    throw new UsageError(`coordinate '${raw}': org/repo must not be '.' or '..'`);
  }
  if (ref.length === 0 || /\s/.test(ref)) {
    throw new UsageError(`coordinate '${raw}': invalid ref`);
  }
  return { transport: "github", org, repo, ref, raw };
}

/**
 * Expand `${VAR}` references in a link path via `lookup`. An undefined or
 * empty variable is a hard error; a malformed reference (bad name / unclosed
 * `${`) is rejected rather than left to fail obscurely as a filesystem path.
 */
export function expandPath(input: string, lookup: (name: string) => string | undefined): string {
  // Detect an unclosed `${` on the INPUT (strip valid refs, check the leftover)
  // — scanning the substituted output would false-positive on a resolved value
  // that itself contains `${`.
  if (input.replace(VAR_RE, "").includes("${")) {
    throw new UsageError(`link path '${input}': malformed variable reference`);
  }
  return input.replace(VAR_RE, (_m, name: string) => {
    if (!VAR_NAME_RE.test(name)) {
      throw new UsageError(`link path '${input}': invalid variable name '\${${name}}'`);
    }
    const value = lookup(name);
    if (value === undefined || value === "") {
      throw new UsageError(`link path '${input}': undefined variable '\${${name}}'`);
    }
    return value;
  });
}

export function githubUrl(coord: Coordinate, env: NodeJS.ProcessEnv): string {
  if (coord.transport !== "github") {
    throw new CliError(`githubUrl: not a github coordinate (${coord.raw})`, 1);
  }
  const base = (env.UMBEL_GITHUB_BASE ?? "https://github.com").replace(/\/+$/, "");
  return `${base}/${coord.org}/${coord.repo}`;
}

export const ALIAS_RE = /^[a-z][a-z0-9-]{0,40}$/;

export function deriveAlias(coord: Coordinate): string {
  if (coord.transport !== "github") {
    throw new UsageError(
      `cannot derive an alias from a '${coord.transport}:' coordinate; declare it in deps: by hand`,
    );
  }
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
