import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeGitFixture } from "../helpers/git.ts";
import { cleanup, makeTmpDir, writeFile } from "../helpers/tmp.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = join(ROOT, "dist", "cli.js");

describe("umbel install (integration)", () => {
  let root: string;
  let env: NodeJS.ProcessEnv;

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
    makeGitFixture(join(root, "gh/acme/tools"), {
      "skills/greet/SKILL.md": "---\nname: greet\ndescription: hi\n---\nhello\n",
    });
    makeGitFixture(join(root, "gh/acme/lib"), {
      "skills/util/SKILL.md": "---\nname: util\ndescription: u\n---\nutil\n",
    });
    writeFile(bundleMd(), "---\nname: dev\n---\n");
    env = {
      UMBEL_GITHUB_BASE: `file://${join(root, "gh")}`,
      UMBEL_ARTIFACTS_DIR: join(root, "config"),
      UMBEL_DATA_DIR: join(root, "data"),
      UMBEL_CACHE_DIR: join(root, "cache"),
    };
  });
  afterEach(() => cleanup(root));

  it("reconciles a hand-added dep into the lock without touching existing pins", () => {
    expect(umbel("add", "github:acme/tools@v1", "--bundle", "dev").status).toBe(0);
    const toolsEntry = JSON.parse(readFileSync(lockPath(), "utf8")).deps.tools;

    // hand-author the manifest: add a second dep
    writeFileSync(
      bundleMd(),
      "---\nname: dev\ndeps:\n  tools: github:acme/tools@v1\n  lib: github:acme/lib@v1\nskills:\n  - tools/greet\n  - lib/util\n---\n",
    );

    const r = umbel("install", "--bundle", "dev");
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    const lock = JSON.parse(readFileSync(lockPath(), "utf8"));
    expect(lock.deps.tools).toEqual(toolsEntry); // untouched
    expect(lock.deps.lib.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(existsSync(join(root, "data/store/github/acme/lib", lock.deps.lib.commit))).toBe(true);
  });

  it("--frozen reproduces a shared bundle.md + lock on a fresh store", () => {
    expect(umbel("add", "github:acme/tools@v1", "--bundle", "dev").status).toBe(0);
    const lockBefore = readFileSync(lockPath(), "utf8");
    const commit = JSON.parse(lockBefore).deps.tools.commit;

    rmSync(join(root, "data/store"), { recursive: true, force: true });
    const r = umbel("install", "--frozen", "--bundle", "dev");
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(readFileSync(lockPath(), "utf8")).toBe(lockBefore); // wrote nothing
    expect(
      existsSync(join(root, "data/store/github/acme/tools", commit, "skills/greet/SKILL.md")),
    ).toBe(true);
  });

  it("--frozen errors on manifest/lock drift and writes no lock", () => {
    expect(umbel("add", "github:acme/tools@v1", "--bundle", "dev").status).toBe(0);
    const lockBefore = readFileSync(lockPath(), "utf8");

    // hand-add a dep with no lock entry → drift
    writeFileSync(
      bundleMd(),
      "---\nname: dev\ndeps:\n  tools: github:acme/tools@v1\n  lib: github:acme/lib@v1\nskills:\n  - tools/greet\n---\n",
    );

    const r = umbel("install", "--frozen", "--bundle", "dev");
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/drift|frozen/i);
    expect(readFileSync(lockPath(), "utf8")).toBe(lockBefore); // unchanged
  });

  it("build auto-materializes a missing store checkout before compiling", () => {
    expect(umbel("add", "github:acme/tools@v1", "--bundle", "dev").status).toBe(0);
    const commit = JSON.parse(readFileSync(lockPath(), "utf8")).deps.tools.commit;

    // simulate a purged store (or a recipient who only has bundle.md + lock)
    rmSync(join(root, "data/store"), { recursive: true, force: true });
    expect(existsSync(join(root, "data/store/github/acme/tools", commit))).toBe(false);

    const r = umbel("build", "dev");
    expect(r.status).toBe(0);
    const cacheDir = r.stdout.trim().split("\n").pop()!;
    expect(readFileSync(join(cacheDir, "skills/greet/SKILL.md"), "utf8")).toContain("hello");
    // the store was re-materialized from the lock:
    expect(
      existsSync(join(root, "data/store/github/acme/tools", commit, "skills/greet/SKILL.md")),
    ).toBe(true);
  });

  it("auto-materialize consumes the lock without rewriting it (run/build stay pure)", () => {
    expect(umbel("add", "github:acme/tools@v1", "--bundle", "dev").status).toBe(0);
    const lockBefore = readFileSync(lockPath(), "utf8");

    rmSync(join(root, "data/store"), { recursive: true, force: true });
    expect(umbel("build", "dev").status).toBe(0);

    expect(readFileSync(lockPath(), "utf8")).toBe(lockBefore); // no churn
  });
});
