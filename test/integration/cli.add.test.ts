import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, readdirSync, utimesSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeGitFixture } from "../helpers/git.ts";
import { cleanup, makeTmpDir, writeFile } from "../helpers/tmp.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = join(ROOT, "dist", "cli.js");

describe("umbel add (integration)", () => {
  let root: string;
  let env: NodeJS.ProcessEnv;

  function umbel(...args: string[]) {
    return spawnSync(process.execPath, [CLI, ...args], {
      encoding: "utf8",
      env: { ...process.env, ...env, NO_TTY: "1" },
      cwd: root,
    });
  }

  beforeAll(() => {
    if (!existsSync(CLI)) {
      throw new Error(`dist/cli.js not built — run \`npm run build\` first (looked at ${CLI})`);
    }
    root = makeTmpDir();
    makeGitFixture(join(root, "gh/acme/tools"), {
      "skills/greet/SKILL.md": "---\nname: greet\ndescription: hi\n---\nhello\n",
    });
    writeFile(join(root, "config/bundles/dev.md"), "---\nname: dev\n---\n");
    env = {
      UMBEL_GITHUB_BASE: `file://${join(root, "gh")}`,
      UMBEL_ARTIFACTS_DIR: join(root, "config"),
      UMBEL_DATA_DIR: join(root, "data"),
      UMBEL_CACHE_DIR: join(root, "cache"),
    };
  });
  afterAll(() => cleanup(root));

  it("add fetches into the store, writes deps + lock, composes the skill", () => {
    const r = umbel("add", "github:acme/tools@v1", "--bundle", "dev");
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(readFileSync(join(root, "config/bundles/dev.md"), "utf8")).toMatch(/- tools\/greet/);
    const lock = JSON.parse(readFileSync(join(root, "config/bundles/dev.lock"), "utf8"));
    expect(lock.deps.tools.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(lock.deps.tools.contentHash).toMatch(/^[0-9a-f]{64}$/);
    const checkout = join(root, "data/store/github/acme/tools", lock.deps.tools.commit);
    expect(existsSync(join(checkout, "skills/greet/SKILL.md"))).toBe(true);
  });

  it("re-running add is idempotent (no lock churn)", () => {
    const lockPath = join(root, "config/bundles/dev.lock");
    const before = readFileSync(lockPath, "utf8");
    const r = umbel("add", "github:acme/tools@v1", "--bundle", "dev");
    expect(r.status).toBe(0);
    expect(readFileSync(lockPath, "utf8")).toBe(before);
    expect(r.stdout).toMatch(/up to date/);
  });

  it("build compiles the store-backed skill into the plugin cache", () => {
    const r = umbel("build", "dev");
    expect(r.status).toBe(0);
    const cacheDir = r.stdout.trim().split("\n").pop()!;
    expect(readFileSync(join(cacheDir, "skills/greet/SKILL.md"), "utf8")).toContain("hello");
  });

  it("same lock → same compiled hash: mtime churn and store relocation don't matter", () => {
    const build = () => {
      const r = umbel("build", "dev", "--no-cache");
      expect(r.status).toBe(0);
      return r.stdout.trim().split("\n").pop()!;
    };
    const first = build();

    // 1) mtime churn in the store must not change the hash
    const lock = JSON.parse(readFileSync(join(root, "config/bundles/dev.lock"), "utf8"));
    const skillMd = join(
      root,
      "data/store/github/acme/tools",
      lock.deps.tools.commit,
      "skills/greet/SKILL.md",
    );
    utimesSync(skillMd, new Date(2001, 1, 1), new Date(2001, 1, 1));
    expect(build()).toBe(first);

    // 2) relocating the store (a "different machine") must not change the hash
    cpSync(join(root, "data"), join(root, "data-elsewhere"), { recursive: true });
    // Footgun: this permanently repoints later umbel() calls in this file at the
    // relocated store — any test added after this one inherits UMBEL_DATA_DIR=data-elsewhere.
    env = { ...env, UMBEL_DATA_DIR: join(root, "data-elsewhere") };
    expect(build()).toBe(first);
  });

  it("non-mutation: nothing outside config/data/cache was written", () => {
    expect(readdirSync(root).sort()).toEqual(
      ["cache", "config", "data", "data-elsewhere", "gh"].sort(),
    );
  });
});
