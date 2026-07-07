import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { CliError, NotFoundError } from "../errors.ts";
import { hashTree } from "./content-hash.ts";
import type { Coordinate } from "./coordinate.ts";

export interface Checkout {
  commit: string;
  contentHash: string;
  dir: string;
}

export interface EnsureOpts {
  coord: Coordinate;
  url: string;
  storeRoot: string;
  /** When set and the checkout exists, ensure is a pure local no-op (no network). */
  lockedCommit?: string;
}

export function checkoutPath(storeRoot: string, coord: Coordinate, commit: string): string {
  if (coord.transport !== "github") {
    throw new CliError(`checkoutPath: not a github coordinate (${coord.raw})`, 1);
  }
  return join(storeRoot, "github", coord.org, coord.repo, commit);
}

export function ensureCheckout(opts: EnsureOpts): Checkout {
  // link:/local deps are live (never fetched or staked); only github reaches here.
  const { coord } = opts;
  if (coord.transport !== "github") {
    throw new CliError(`ensureCheckout: not a github coordinate (${coord.raw})`, 1);
  }
  if (opts.lockedCommit) {
    const dir = checkoutPath(opts.storeRoot, coord, opts.lockedCommit);
    if (existsSync(dir)) {
      return { commit: opts.lockedCommit, contentHash: hashTree(dir), dir };
    }
  }

  mkdirSync(opts.storeRoot, { recursive: true });
  const staging = join(
    opts.storeRoot,
    `.staging-${process.pid}-${Math.random().toString(36).slice(2, 10)}`,
  );
  try {
    let commit: string;
    if (opts.lockedCommit) {
      // A ref-tip shallow clone can't reach a moved/older commit
      // ("fatal: reference is not a tree"), so fetch the pinned commit directly.
      fetchExactCommit(opts.url, opts.lockedCommit, staging, coord);
      commit = opts.lockedCommit;
    } else {
      git(
        [
          "clone",
          "--quiet",
          "--config",
          "core.autocrlf=false",
          "--depth",
          "1",
          "--branch",
          coord.ref,
          "--single-branch",
          opts.url,
          staging,
        ],
        coord,
      );
      commit = git(["-C", staging, "rev-parse", "HEAD"], coord).trim();
    }
    rmSync(join(staging, ".git"), { recursive: true, force: true });
    const dir = checkoutPath(opts.storeRoot, coord, commit);
    if (!existsSync(dir)) {
      // The rename is the atomicity stake: a concurrent winner makes existsSync(dir)
      // true first, so this run keeps the existing dir and discards its own staging below.
      // A winner staking between the check and the rename surfaces as ENOTEMPTY/EEXIST —
      // same outcome, the existing dir wins.
      mkdirSync(dirname(dir), { recursive: true });
      try {
        renameSync(staging, dir);
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code !== "ENOTEMPTY" && code !== "EEXIST") throw e;
      }
    }
    return { commit, contentHash: hashTree(dir), dir };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

function git(args: string[], coord: Coordinate): string {
  const r = spawnSync("git", args, {
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  if (r.error && (r.error as NodeJS.ErrnoException).code === "ENOENT") {
    throw new CliError("umbel: 'git' not found on PATH", 1);
  }
  if (r.status !== 0) {
    const detail = (r.stderr ?? "").trim().split("\n").slice(0, 3).join("\n");
    throw new NotFoundError(`failed to fetch ${coord.raw}:\n${detail}`);
  }
  return r.stdout;
}

/**
 * Fetch a single, exact commit into `staging` (already a nonexistent path).
 * Used to materialize a locked pin: unlike a ref-tip clone, this reaches a
 * commit that a moved branch/tag no longer points at (GitHub allows fetching
 * any reachable sha; local file transport allows it too).
 */
function fetchExactCommit(url: string, commit: string, staging: string, coord: Coordinate): void {
  git(["init", "--quiet", staging], coord);
  git(["-C", staging, "config", "core.autocrlf", "false"], coord);
  git(["-C", staging, "remote", "add", "origin", url], coord);
  git(["-C", staging, "fetch", "--quiet", "--depth", "1", "origin", commit], coord);
  git(
    [
      "-C",
      staging,
      "-c",
      "advice.detachedHead=false",
      "checkout",
      "--quiet",
      "--detach",
      "FETCH_HEAD",
    ],
    coord,
  );
}
