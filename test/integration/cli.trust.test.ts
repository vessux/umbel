import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeGitFixture } from "../helpers/git.ts";
import { cleanup, makeTmpDir, writeFile } from "../helpers/tmp.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = join(ROOT, "dist", "cli.js");

describe("umbel add trust gate (integration)", () => {
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
    // A repo shipping BOTH a skill (so `add` can pick one) and a hook (executable content).
    makeGitFixture(join(root, "gh/acme/tools"), {
      "skills/greet/SKILL.md": "---\nname: greet\ndescription: hi\n---\nhello\n",
      "hooks/fmt/HOOK.md": '---\nname: fmt\nevent: Stop\nmatcher: ""\ncommand: ./run.sh\n---\n',
      "hooks/fmt/run.sh": "#!/bin/sh\necho A\n",
    });
    // A skill-only repo (must stay prompt-free).
    makeGitFixture(join(root, "gh/acme/pure"), {
      "skills/hi/SKILL.md": "---\nname: hi\ndescription: hi\n---\nhi\n",
    });
    writeFile(join(root, "config/bundles/dev.md"), "---\nname: dev\n---\n");
    writeFile(join(root, "config/bundles/pure.md"), "---\nname: pure\n---\n");
    env = {
      UMBEL_GITHUB_BASE: `file://${join(root, "gh")}`,
      UMBEL_ARTIFACTS_DIR: join(root, "config"),
      UMBEL_DATA_DIR: join(root, "data"),
      UMBEL_CACHE_DIR: join(root, "cache"),
    };
  });
  afterAll(() => cleanup(root));

  it("add of a skill-only repo needs no confirmation (skills are outside the gate)", () => {
    const r = umbel("add", "github:acme/pure@v1", "--bundle", "pure");
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(existsSync(join(root, "config/bundles/pure.lock"))).toBe(true);
  });

  it("add of a hook-carrying repo fails closed on non-TTY and writes no lock", () => {
    const r = umbel("add", "github:acme/tools@v1", "greet", "--bundle", "dev");
    expect(r.status).toBe(5);
    expect(r.stderr).toMatch(/executable content/);
    expect(existsSync(join(root, "config/bundles/dev.lock"))).toBe(false);
    // manifest untouched (no composed skill line)
    expect(readFileSync(join(root, "config/bundles/dev.md"), "utf8")).not.toMatch(/greet/);
  });

  it("--yes overrides the gate and completes the add", () => {
    const r = umbel("add", "github:acme/tools@v1", "greet", "--bundle", "dev", "--yes");
    expect(r.status).toBe(0);
    expect(existsSync(join(root, "config/bundles/dev.lock"))).toBe(true);
    expect(readFileSync(join(root, "config/bundles/dev.md"), "utf8")).toMatch(/- tools\/greet/);
  });

  it("re-adding already-trusted content materializes silently (no gate)", () => {
    const r = umbel("add", "github:acme/tools@v1", "greet", "--bundle", "dev");
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/up to date/);
  });
});
