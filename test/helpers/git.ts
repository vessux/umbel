import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { writeFile } from "./tmp.ts";

function git(cwd: string, ...args: string[]): void {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  }
}

/**
 * Create a real git repo at `dir` with `files`, one commit, tagged `tag`.
 * Returns the commit sha. Clone it via `file://${dir}`.
 */
export function makeGitFixture(dir: string, files: Record<string, string>, tag = "v1"): string {
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "test@test");
  git(dir, "config", "user.name", "test");
  git(dir, "config", "commit.gpgsign", "false");
  git(dir, "config", "tag.gpgsign", "false");
  for (const [rel, content] of Object.entries(files)) {
    writeFile(join(dir, rel), content);
  }
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "fixture");
  git(dir, "tag", tag);
  const r = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" });
  return r.stdout.trim();
}
