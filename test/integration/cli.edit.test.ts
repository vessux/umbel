import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, makeTmpDir, writeFile } from "../helpers/tmp.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = join(ROOT, "dist", "cli.js");

describe("umbel edit (integration)", () => {
  let root: string;
  let env: NodeJS.ProcessEnv;

  function umbel(...args: string[]) {
    return spawnSync(process.execPath, [CLI, ...args], {
      encoding: "utf8",
      env: { ...process.env, ...env, NO_TTY: "1" },
      cwd: root,
    });
  }

  beforeEach(() => {
    if (!existsSync(CLI))
      throw new Error(`dist/cli.js not built — run \`npm run build\` first (looked at ${CLI})`);
    root = makeTmpDir();
    writeFile(join(root, "config/bundles/dev.md"), "---\nname: dev\n---\n");
    env = {
      UMBEL_ARTIFACTS_DIR: join(root, "config"),
      UMBEL_DATA_DIR: join(root, "data"),
      UMBEL_CACHE_DIR: join(root, "cache"),
    };
  });
  afterEach(() => cleanup(root));

  it("is recognized as a verb and requires a TTY (exit 2)", () => {
    const r = umbel("edit", "dev");
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/TTY/);
  });
});
