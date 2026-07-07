import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeGitFixture } from "../helpers/git.ts";
import { cleanup, makeTmpDir, writeFile } from "../helpers/tmp.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = join(ROOT, "dist", "cli.js");

describe("umbel fork (integration)", () => {
  let root: string;
  let env: NodeJS.ProcessEnv;

  function umbel(...args: string[]) {
    return spawnSync(process.execPath, [CLI, ...args], {
      encoding: "utf8",
      env: { ...process.env, ...env, NO_TTY: "1" },
      cwd: root,
    });
  }

  // No .claude ancestor at root, so project scope falls back to <root>/.claude/bundles.
  const projBundles = () => join(root, ".claude/bundles");

  beforeEach(() => {
    if (!existsSync(CLI))
      throw new Error(`dist/cli.js not built — run \`npm run build\` first (looked at ${CLI})`);
    root = makeTmpDir();
    makeGitFixture(join(root, "gh/acme/tools"), {
      "skills/greet/SKILL.md": "---\nname: greet\ndescription: hi\n---\nhello\n",
    });
    writeFile(join(root, "config/bundles/web.md"), "---\n# hand comment\nname: web\n---\n");
    env = {
      UMBEL_GITHUB_BASE: `file://${join(root, "gh")}`,
      UMBEL_ARTIFACTS_DIR: join(root, "config"),
      UMBEL_DATA_DIR: join(root, "data"),
      UMBEL_CACHE_DIR: join(root, "cache"),
    };
  });
  afterEach(() => cleanup(root));

  it("copies a user bundle into project scope under a new name, with its lock", () => {
    // give the source a dep so a lock exists to copy
    expect(umbel("add", "github:acme/tools@v1", "--bundle", "web").status).toBe(0);

    const r = umbel("fork", "web-fork", "--bundle", "web");
    expect(r.status).toBe(0);
    const md = readFileSync(join(projBundles(), "web-fork.md"), "utf8");
    expect(md).toMatch(/^name: web-fork$/m);
    expect(md).toContain("# hand comment");
    expect(existsSync(join(projBundles(), "web-fork.lock"))).toBe(true);
  });

  it("exit 4 when the dest already exists", () => {
    expect(umbel("fork", "web-fork", "--bundle", "web").status).toBe(0);
    const again = umbel("fork", "web-fork", "--bundle", "web");
    expect(again.status).toBe(4);
  });

  it("exit 2 on an invalid new name", () => {
    const r = umbel("fork", "Bad Name", "--bundle", "web");
    expect(r.status).toBe(2);
  });
});
