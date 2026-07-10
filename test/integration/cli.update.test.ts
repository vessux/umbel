import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addCommitTag, makeGitFixture } from "../helpers/git.ts";
import { cleanup, makeTmpDir, writeFile } from "../helpers/tmp.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = join(ROOT, "dist", "cli.js");

describe("umbel update (integration)", () => {
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
  const readLock = () => JSON.parse(readFileSync(lockPath(), "utf8"));

  beforeEach(() => {
    if (!existsSync(CLI))
      throw new Error(`dist/cli.js not built — run \`npm run build\` first (looked at ${CLI})`);
    root = makeTmpDir();
    repo = join(root, "gh/acme/tools");
    // A skill-only repo (no executable content → the trust gate stays quiet).
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

  it("advances a branch-tracked dep to the newest commit + content hash", () => {
    // A branch-tracked dep (@main), seeded into the lock.
    writeFile(
      bundleMd(),
      "---\nname: dev\ndeps:\n  tools: github:acme/tools@main\nskills:\n  - tools/greet\n---\n",
    );
    expect(umbel("install", "--bundle", "dev").status).toBe(0);
    const before = readLock().deps.tools;
    expect(before.commit).toMatch(/^[0-9a-f]{40}$/);

    // Upstream advances main.
    const v2 = addCommitTag(
      repo,
      { "skills/greet/SKILL.md": "---\nname: greet\ndescription: hi\n---\nhello v2\n" },
      "v2",
    );

    const r = umbel("update", "tools", "--bundle", "dev");
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    const after = readLock().deps.tools;
    expect(after.commit).toBe(v2);
    expect(after.commit).not.toBe(before.commit);
    expect(after.contentHash).not.toBe(before.contentHash);
    expect(after.coordinate).toBe("github:acme/tools@main");
  });

  it("leaves a tag-pinned dep untouched (no-op)", () => {
    writeFile(
      bundleMd(),
      "---\nname: dev\ndeps:\n  tools: github:acme/tools@v1\nskills:\n  - tools/greet\n---\n",
    );
    expect(umbel("install", "--bundle", "dev").status).toBe(0);
    const lockBefore = readFileSync(lockPath(), "utf8");

    // Upstream advances main and adds a v2 tag; the v1-pinned dep must not move.
    addCommitTag(
      repo,
      { "skills/greet/SKILL.md": "---\nname: greet\ndescription: hi\n---\nhello v2\n" },
      "v2",
    );

    const r = umbel("update", "tools", "--bundle", "dev");
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/pinned|nothing to update/i);
    expect(readFileSync(lockPath(), "utf8")).toBe(lockBefore); // byte-for-byte unchanged
  });

  it("with no alias advances every branch dep and leaves pins alone", () => {
    const lib = join(root, "gh/acme/lib");
    makeGitFixture(lib, {
      "skills/util/SKILL.md": "---\nname: util\ndescription: u\n---\nutil v1\n",
    });
    writeFile(
      bundleMd(),
      "---\nname: dev\ndeps:\n  tools: github:acme/tools@main\n  lib: github:acme/lib@v1\nskills:\n  - tools/greet\n  - lib/util\n---\n",
    );
    expect(umbel("install", "--bundle", "dev").status).toBe(0);
    const libBefore = readLock().deps.lib;
    const toolsBefore = readLock().deps.tools;

    // Only tools' branch advances; lib stays at its v1 tag.
    const toolsV2 = addCommitTag(
      repo,
      { "skills/greet/SKILL.md": "---\nname: greet\ndescription: hi\n---\nhello v2\n" },
      "v2",
    );
    addCommitTag(
      lib,
      { "skills/util/SKILL.md": "---\nname: util\ndescription: u\n---\nutil v2\n" },
      "v2",
    );

    const r = umbel("update", "--bundle", "dev");
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(readLock().deps.tools.commit).toBe(toolsV2);
    expect(readLock().deps.tools.commit).not.toBe(toolsBefore.commit);
    expect(readLock().deps.lib).toEqual(libBefore); // pinned dep untouched
  });

  it("exit 3 when the named alias is not a dependency", () => {
    writeFile(
      bundleMd(),
      "---\nname: dev\ndeps:\n  tools: github:acme/tools@main\nskills:\n  - tools/greet\n---\n",
    );
    expect(umbel("install", "--bundle", "dev").status).toBe(0);

    const r = umbel("update", "nope", "--bundle", "dev");
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/not a dependency/);
  });

  it("treats a link: dependency as a live no-op and never writes a lock", () => {
    const linkDir = join(root, "mylib");
    writeFile(
      join(linkDir, "skills/greet/SKILL.md"),
      "---\nname: greet\ndescription: hi\n---\nlocal\n",
    );
    writeFile(
      bundleMd(),
      `---\nname: dev\ndeps:\n  mine: link:${linkDir}\nskills:\n  - mine/greet\n---\n`,
    );

    const r = umbel("update", "mine", "--bundle", "dev");
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/link|live|nothing to update/i);
    expect(existsSync(lockPath())).toBe(false); // link: deps never enter the lock
  });
});

describe("umbel update trust gate on changed executable content", () => {
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

  const lockPath = () => join(root, "config/bundles/hookbundle.lock");

  beforeEach(() => {
    root = makeTmpDir();
    repo = join(root, "gh/acme/hookdep");
    // A branch-tracked dep shipping a hook (executable content) + a skill to compose.
    makeGitFixture(repo, {
      "hooks/fmt/HOOK.md": '---\nname: fmt\nevent: Stop\nmatcher: ""\ncommand: ./run.sh\n---\n',
      "hooks/fmt/run.sh": "#!/bin/sh\necho A\n",
      "skills/s/SKILL.md": "---\nname: s\ndescription: s\n---\ns\n",
    });
    writeFile(
      join(root, "config/bundles/hookbundle.md"),
      "---\nname: hookbundle\ndeps:\n  hookdep: github:acme/hookdep@main\nskills:\n  - hookdep/s\n---\n",
    );
    env = {
      UMBEL_GITHUB_BASE: `file://${join(root, "gh")}`,
      UMBEL_ARTIFACTS_DIR: join(root, "config"),
      UMBEL_DATA_DIR: join(root, "data"),
      UMBEL_CACHE_DIR: join(root, "cache"),
    };
  });
  afterEach(() => cleanup(root));

  it("fails closed (exit 5) on a changed hook body and writes nothing; --yes advances", () => {
    // Seed the lock at the current tip (hook trusted via --yes).
    expect(umbel("install", "--bundle", "hookbundle", "--yes").status).toBe(0);
    const v1Commit = JSON.parse(readFileSync(lockPath(), "utf8")).deps.hookdep.commit;

    // Upstream advances main with a changed hook body.
    addCommitTag(repo, { "hooks/fmt/run.sh": "#!/bin/sh\necho B\n" }, "v2");

    const refused = umbel("update", "hookdep", "--bundle", "hookbundle");
    expect(refused.status).toBe(5);
    expect(refused.stderr).toMatch(/executable content/);
    // Lock untouched: still pins the pre-update commit.
    expect(JSON.parse(readFileSync(lockPath(), "utf8")).deps.hookdep.commit).toBe(v1Commit);

    const allowed = umbel("update", "hookdep", "--bundle", "hookbundle", "--yes");
    expect(allowed.status).toBe(0);
    expect(JSON.parse(readFileSync(lockPath(), "utf8")).deps.hookdep.commit).not.toBe(v1Commit);
  });
});
