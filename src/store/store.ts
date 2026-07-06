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
  return join(storeRoot, "github", coord.org, coord.repo, commit);
}

export function ensureCheckout(opts: EnsureOpts): Checkout {
  if (opts.lockedCommit) {
    const dir = checkoutPath(opts.storeRoot, opts.coord, opts.lockedCommit);
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
    git(
      [
        "clone",
        "--quiet",
        "--config",
        "core.autocrlf=false",
        "--depth",
        "1",
        "--branch",
        opts.coord.ref,
        "--single-branch",
        opts.url,
        staging,
      ],
      opts.coord,
    );
    const commit = git(["-C", staging, "rev-parse", "HEAD"], opts.coord).trim();
    rmSync(join(staging, ".git"), { recursive: true, force: true });
    const dir = checkoutPath(opts.storeRoot, opts.coord, commit);
    if (!existsSync(dir)) {
      // The rename is the atomicity stake: a concurrent winner makes existsSync(dir)
      // true first, so this run keeps the existing dir and discards its own staging below.
      mkdirSync(dirname(dir), { recursive: true });
      renameSync(staging, dir);
    }
    return { commit, contentHash: hashTree(dir), dir };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

function git(args: string[], coord: Coordinate): string {
  const r = spawnSync("git", args, { encoding: "utf8" });
  if (r.error && (r.error as NodeJS.ErrnoException).code === "ENOENT") {
    throw new CliError("umbel: 'git' not found on PATH", 1);
  }
  if (r.status !== 0) {
    const detail = (r.stderr ?? "").trim().split("\n").slice(0, 3).join("\n");
    throw new NotFoundError(`failed to fetch ${coord.raw}:\n${detail}`);
  }
  return r.stdout;
}
