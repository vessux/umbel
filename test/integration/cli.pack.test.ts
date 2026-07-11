import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeGitFixture } from "../helpers/git.ts";
import { cleanup, makeTmpDir, writeFile } from "../helpers/tmp.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = join(ROOT, "dist", "cli.js");

describe("umbel pack (integration)", () => {
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
    if (!existsSync(CLI)) throw new Error("dist/cli.js not built — run `npm run build`");
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

  it("packs a github-dep bundle into a self-contained plugin dir", () => {
    expect(umbel("add", "github:acme/tools@v1", "--bundle", "dev").status).toBe(0);
    const out = join(root, "packed");
    const r = umbel("pack", "dev", "--out", out);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(readFileSync(join(out, "skills/greet/SKILL.md"), "utf8")).toContain("hello");
    expect(existsSync(join(out, ".umbel/bundle.md"))).toBe(true);
    expect(existsSync(join(out, ".umbel/dev.lock"))).toBe(true);
    expect(JSON.parse(readFileSync(join(out, ".claude-plugin/plugin.json"), "utf8")).name).toBe(
      "dev",
    );
  });

  it("the packed dir launches under plain `claude --plugin-dir` (guarded smoke)", () => {
    const which = spawnSync("claude", ["--version"], { encoding: "utf8" });
    if (which.error) return; // claude not on PATH — skip, like the existing smoke test
    const out = join(root, "packed");
    const r = spawnSync("claude", ["--plugin-dir", out, "--help"], { encoding: "utf8" });
    expect(r.status).toBe(0);
  });
});
