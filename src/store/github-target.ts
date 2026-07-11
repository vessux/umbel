import { UsageError } from "../errors.ts";

export interface GithubTarget {
  org: string;
  repo: string;
  ref?: string;
}

const NAME_PART = /^[A-Za-z0-9._-]+$/;

function clean(part: string): string {
  return part.replace(/\.git$/, "");
}

function validate(org: string, repo: string, raw: string): void {
  if (!NAME_PART.test(org) || !NAME_PART.test(repo)) {
    throw new UsageError(`'${raw}': invalid org/repo (allowed: letters, digits, . _ -)`);
  }
  if ([org, repo].some((p) => p === "." || p === "..")) {
    throw new UsageError(`'${raw}': org/repo must not be '.' or '..'`);
  }
}

/**
 * Parse a `try`/`adopt` target into `{org, repo, ref?}`. Accepts a bare GitHub
 * URL (`https://github.com/org/repo[.git][/tree/<ref>]`) or a `github:org/repo[@ref]`
 * coordinate. The ref is optional here (unlike parseCoordinate) — callers resolve
 * the default branch when it is absent.
 */
export function parseGithubTarget(arg: string): GithubTarget {
  if (arg.startsWith("http://") || arg.startsWith("https://")) {
    let url: URL;
    try {
      url = new URL(arg);
    } catch {
      throw new UsageError(`'${arg}': not a valid URL`);
    }
    if (url.hostname !== "github.com" && url.hostname !== "www.github.com") {
      throw new UsageError(`'${arg}': only github.com URLs are supported`);
    }
    const segs = url.pathname.split("/").filter((s) => s.length > 0);
    if (segs.length < 2) throw new UsageError(`'${arg}': expected github.com/<org>/<repo>`);
    const org = segs[0]!;
    const repo = clean(segs[1]!);
    validate(org, repo, arg);
    const ref = segs[2] === "tree" && segs[3] !== undefined ? segs[3] : undefined;
    return ref !== undefined ? { org, repo, ref } : { org, repo };
  }
  if (arg.startsWith("github:")) {
    const rest = arg.slice("github:".length);
    const at = rest.indexOf("@");
    const body = at === -1 ? rest : rest.slice(0, at);
    const ref = at === -1 ? undefined : rest.slice(at + 1);
    const slash = body.indexOf("/");
    if (slash <= 0) throw new UsageError(`'${arg}': expected github:<org>/<repo>[@<ref>]`);
    const org = body.slice(0, slash);
    const repo = clean(body.slice(slash + 1));
    validate(org, repo, arg);
    if (ref !== undefined && (ref.length === 0 || /\s/.test(ref))) {
      throw new UsageError(`'${arg}': invalid ref`);
    }
    return ref !== undefined ? { org, repo, ref } : { org, repo };
  }
  throw new UsageError(
    `'${arg}': expected a GitHub URL (https://github.com/<org>/<repo>) or github:<org>/<repo>[@<ref>]`,
  );
}
