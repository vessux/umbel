import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeGitFixture } from "../helpers/git.ts";
import { cleanup, makeTmpDir, writeFile } from "../helpers/tmp.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = join(ROOT, "dist", "cli.js");

describe("umbel import (integration)", () => {
  let root: string;
  let env: NodeJS.ProcessEnv;

  function umbel(cwd: string, extraEnv: NodeJS.ProcessEnv, ...args: string[]) {
    return spawnSync(process.execPath, [CLI, ...args], {
      encoding: "utf8",
      env: { ...process.env, ...extraEnv, NO_TTY: "1" },
      cwd,
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

  it("round-trips: pack then import into a fresh config yields a usable bundle", () => {
    expect(umbel(root, env, "add", "github:acme/tools@v1", "--bundle", "dev").status).toBe(0);
    const out = join(root, "packed");
    expect(umbel(root, env, "pack", "dev", "--out", out).status).toBe(0);

    const envB = {
      UMBEL_ARTIFACTS_DIR: join(root, "config-b"),
      UMBEL_DATA_DIR: join(root, "data-b"),
      UMBEL_CACHE_DIR: join(root, "cache-b"),
    };
    const r = umbel(root, envB, "import", out, "dev");
    expect(r.status).toBe(0);
    expect(existsSync(join(root, "config-b/bundles/dev.md"))).toBe(true);
    expect(readFileSync(join(root, "config-b/skills/dev/greet/SKILL.md"), "utf8")).toContain(
      "hello",
    );
    const b = umbel(root, envB, "build", "dev");
    expect(b.status).toBe(0);
    const cacheDir = b.stdout.trim().split("\n").pop()!;
    expect(readFileSync(join(cacheDir, "skills/greet/SKILL.md"), "utf8")).toContain("hello");
  });
});
