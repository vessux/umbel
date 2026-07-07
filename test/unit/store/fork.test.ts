import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConflictError, UsageError } from "../../../src/errors.ts";
import { runFork } from "../../../src/store/fork.ts";
import { cleanup, makeTmpDir, writeFile } from "../../helpers/tmp.ts";

const MD = `---
name: web
# my comment
deps:
  tdd: github:org/tdd@v1
skills:
  - tdd/writing
---
body
`;

describe("runFork", () => {
  let root: string;
  let env: NodeJS.ProcessEnv;
  let cwd: string;
  let destDir: string;

  beforeEach(() => {
    root = makeTmpDir();
    writeFile(join(root, "config/bundles/web.md"), MD);
    writeFile(join(root, "config/bundles/web.lock"), '{"version":1,"deps":{}}\n');
    cwd = join(root, "proj");
    destDir = join(cwd, ".claude/bundles");
    env = { NO_TTY: "1", UMBEL_ARTIFACTS_DIR: join(root, "config") };
  });
  afterEach(() => cleanup(root));

  it("copies the source into project scope under a new name (comments + lock)", async () => {
    const code = await runFork(["web-fork", "--bundle", "web"], env, cwd);
    expect(code).toBe(0);
    const out = readFileSync(join(destDir, "web-fork.md"), "utf8");
    expect(out).toMatch(/^name: web-fork$/m);
    expect(out).toContain("# my comment");
    expect(out).toContain("body");
    expect(existsSync(join(destDir, "web-fork.lock"))).toBe(true);
  });

  it("defaults to same-name project shadow when no newname (non-TTY)", async () => {
    await runFork(["--bundle", "web"], env, cwd);
    expect(existsSync(join(destDir, "web.md"))).toBe(true);
    expect(readFileSync(join(destDir, "web.md"), "utf8")).toMatch(/^name: web$/m);
  });

  it("errors when the dest already exists", async () => {
    writeFile(join(destDir, "web-fork.md"), "x");
    await expect(runFork(["web-fork", "--bundle", "web"], env, cwd)).rejects.toThrow(ConflictError);
  });

  it("rejects an invalid new name", async () => {
    await expect(runFork(["Bad Name", "--bundle", "web"], env, cwd)).rejects.toThrow(UsageError);
  });

  it("errors without a source in non-interactive mode when no pin/flag", async () => {
    await expect(runFork(["web-fork"], env, cwd)).rejects.toThrow(UsageError);
  });
});
