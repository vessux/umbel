import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeGitFixture } from "../helpers/git.ts";
import { cleanup, makeTmpDir, writeFile } from "../helpers/tmp.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = join(ROOT, "dist", "cli.js");

describe("umbel remove (integration)", () => {
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
    writeFile(bundleMd(), "---\nname: dev\n---\n");
    env = {
      UMBEL_GITHUB_BASE: `file://${join(root, "gh")}`,
      UMBEL_ARTIFACTS_DIR: join(root, "config"),
      UMBEL_DATA_DIR: join(root, "data"),
      UMBEL_CACHE_DIR: join(root, "cache"),
    };
  });
  afterEach(() => cleanup(root));

  it("drops a dependency, its refs, and its lock entry", () => {
    expect(umbel("add", "github:acme/tools@v1", "--bundle", "dev").status).toBe(0);
    expect(JSON.parse(readFileSync(lockPath(), "utf8")).deps.tools).toBeDefined();

    const r = umbel("remove", "tools", "--bundle", "dev");
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    const md = readFileSync(bundleMd(), "utf8");
    expect(md).not.toContain("tools/greet");
    expect(md).not.toContain("tools: github:acme/tools@v1");
    expect(JSON.parse(readFileSync(lockPath(), "utf8")).deps.tools).toBeUndefined();
  });

  it("drops a single artifact ref but keeps the dependency + lock", () => {
    expect(umbel("add", "github:acme/tools@v1", "--bundle", "dev").status).toBe(0);

    const r = umbel("remove", "tools/greet", "--bundle", "dev");
    expect(r.status).toBe(0);
    const md = readFileSync(bundleMd(), "utf8");
    expect(md).not.toContain("tools/greet");
    expect(md).toContain("tools: github:acme/tools@v1");
    expect(JSON.parse(readFileSync(lockPath(), "utf8")).deps.tools).toBeDefined();
    expect(r.stdout).toMatch(/now unused/); // last-leaf hint
  });

  it("exit 3 when the alias is not present", () => {
    const r = umbel("remove", "ghost", "--bundle", "dev");
    expect(r.status).toBe(3);
  });
});
