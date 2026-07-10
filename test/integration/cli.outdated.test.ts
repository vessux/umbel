import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addCommitTag, makeGitFixture } from "../helpers/git.ts";
import { cleanup, makeTmpDir, writeFile } from "../helpers/tmp.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = join(ROOT, "dist", "cli.js");

describe("umbel outdated (integration)", () => {
  let root: string;
  let env: NodeJS.ProcessEnv;
  let repo: string;

  function umbel(...args: string[]) {
    return spawnSync(process.execPath, [CLI, ...args], {
      encoding: "utf8",
      env: { ...process.env, ...env, NO_TTY: "1" },
      cwd: root,
    });
  }

  const bundleMd = () => join(root, "config/bundles/dev.md");
  const lockPath = () => join(root, "config/bundles/dev.lock");

  beforeEach(() => {
    if (!existsSync(CLI))
      throw new Error(`dist/cli.js not built — run \`npm run build\` first (looked at ${CLI})`);
    root = makeTmpDir();
    repo = join(root, "gh/acme/tools");
    makeGitFixture(repo, {
      "skills/greet/SKILL.md": "---\nname: greet\ndescription: hi\n---\nhello v1\n",
    });
    env = {
      UMBEL_GITHUB_BASE: `file://${join(root, "gh")}`,
      UMBEL_ARTIFACTS_DIR: join(root, "config"),
      UMBEL_DATA_DIR: join(root, "data"),
      UMBEL_CACHE_DIR: join(root, "cache"),
    };
  });
  afterEach(() => cleanup(root));

  it("reports a branch dep with a newer commit and writes nothing", () => {
    writeFile(
      bundleMd(),
      "---\nname: dev\ndeps:\n  tools: github:acme/tools@main\nskills:\n  - tools/greet\n---\n",
    );
    expect(umbel("install", "--bundle", "dev").status).toBe(0);
    const lockBefore = readFileSync(lockPath(), "utf8");
    const locked = JSON.parse(lockBefore).deps.tools.commit;

    const v2 = addCommitTag(
      repo,
      { "skills/greet/SKILL.md": "---\nname: greet\ndescription: hi\n---\nhello v2\n" },
      "v2",
    );

    const r = umbel("outdated", "--bundle", "dev");
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/tools/);
    expect(r.stdout).toContain(locked.slice(0, 12));
    expect(r.stdout).toContain(v2.slice(0, 12));
    // read-only: the lock is byte-for-byte unchanged.
    expect(readFileSync(lockPath(), "utf8")).toBe(lockBefore);
  });

  it("reports nothing when a branch dep is up to date and a tag dep is pinned", () => {
    const lib = join(root, "gh/acme/lib");
    makeGitFixture(lib, { "skills/util/SKILL.md": "---\nname: util\ndescription: u\n---\nutil\n" });
    writeFile(
      bundleMd(),
      "---\nname: dev\ndeps:\n  tools: github:acme/tools@main\n  lib: github:acme/lib@v1\nskills:\n  - tools/greet\n  - lib/util\n---\n",
    );
    expect(umbel("install", "--bundle", "dev").status).toBe(0);

    // Advance lib's main, but lib tracks the v1 tag → not outdated.
    addCommitTag(
      lib,
      { "skills/util/SKILL.md": "---\nname: util\ndescription: u\n---\nutil v2\n" },
      "v2",
    );

    const r = umbel("outdated", "--bundle", "dev");
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/up to date/i);
    expect(r.stdout).not.toMatch(/tools|lib/);
  });
});
