import { spawnSync } from "node:child_process";
import { chmodSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeGitFixture } from "../helpers/git.ts";
import { cleanup, makeTmpDir, writeFile } from "../helpers/tmp.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = join(ROOT, "dist", "cli.js");

describe("umbel try (integration)", () => {
  let root: string;
  let env: NodeJS.ProcessEnv;
  let bin: string;

  function umbel(...args: string[]) {
    return spawnSync(process.execPath, [CLI, ...args], {
      encoding: "utf8",
      env: { ...process.env, ...env, NO_TTY: "1", PATH: `${bin}:${process.env.PATH}` },
      cwd: root,
    });
  }

  beforeAll(() => {
    if (!existsSync(CLI)) throw new Error("dist/cli.js not built — run `npm run build`");
    root = makeTmpDir();
    bin = join(root, "bin");
    writeFile(join(bin, "claude"), "#!/bin/sh\nexit 0\n");
    chmodSync(join(bin, "claude"), 0o755);
    makeGitFixture(join(root, "gh/acme/pure"), {
      "skills/hi/SKILL.md": "---\nname: hi\ndescription: hi\n---\nhi\n",
    });
    makeGitFixture(join(root, "gh/acme/tools"), {
      "skills/greet/SKILL.md": "---\nname: greet\ndescription: hi\n---\nhello\n",
      "hooks/fmt/HOOK.md": '---\nname: fmt\nevent: Stop\nmatcher: ""\ncommand: ./run.sh\n---\n',
      "hooks/fmt/run.sh": "#!/bin/sh\necho A\n",
    });
    env = {
      UMBEL_GITHUB_BASE: `file://${join(root, "gh")}`,
      UMBEL_ARTIFACTS_DIR: join(root, "config"),
      UMBEL_DATA_DIR: join(root, "data"),
      UMBEL_CACHE_DIR: join(root, "cache"),
    };
  });
  afterAll(() => cleanup(root));

  it("skill-only repo via a bare https URL launches prompt-free, writing no pin/manifest/lock", () => {
    const r = umbel("try", "https://github.com/acme/pure");
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    const byName = join(root, "cache/bundles/by-name/pure");
    expect(existsSync(byName)).toBe(true);
    expect(existsSync(join(byName, "skills/hi/SKILL.md"))).toBe(true);
    expect(existsSync(join(root, "config/bundles/pure.md"))).toBe(false);
    expect(existsSync(join(root, "config/bundles/pure.lock"))).toBe(false);
    expect(existsSync(join(root, ".umbel-bundle"))).toBe(false);
  });

  it("a hooks-carrying repo fails closed on non-TTY (exit 5) and launches nothing", () => {
    const r = umbel("try", "github:acme/tools");
    expect(r.status).toBe(5);
    expect(r.stderr).toMatch(/executable content/);
  });

  it("--yes lets the hooks repo through and launches", () => {
    const r = umbel("try", "github:acme/tools", "--yes");
    expect(r.status).toBe(0);
    const byName = join(root, "cache/bundles/by-name/tools");
    expect(existsSync(join(byName, "skills/greet/SKILL.md"))).toBe(true);
    expect(existsSync(join(byName, "hooks/hooks.json"))).toBe(true);
  });
});
