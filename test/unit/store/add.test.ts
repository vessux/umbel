import { closeSync, fstatSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runAdd } from "../../../src/store/add.ts";
import { readLock } from "../../../src/store/lock.ts";
import { makeGitFixture } from "../../helpers/git.ts";
import { cleanup, makeTmpDir, writeFile } from "../../helpers/tmp.ts";

function snapshotFile(path: string): { content: string; mtimeMs: number } {
  const fd = openSync(path, "r");
  try {
    return { content: readFileSync(fd, "utf8"), mtimeMs: fstatSync(fd).mtimeMs };
  } finally {
    closeSync(fd);
  }
}

describe("runAdd", () => {
  let root: string;
  let env: NodeJS.ProcessEnv;
  let bundlePath: string;
  let commit: string;

  beforeEach(() => {
    root = makeTmpDir();
    commit = makeGitFixture(join(root, "gh/acme/tools"), {
      "skills/greet/SKILL.md": "---\nname: greet\n---\nhi\n",
      "skills/farewell/SKILL.md": "---\nname: farewell\n---\nbye\n",
    });
    bundlePath = join(root, "config/bundles/dev.md");
    writeFile(bundlePath, "---\n# hand comment\nname: dev\n---\n");
    env = {
      UMBEL_GITHUB_BASE: `file://${join(root, "gh")}`,
      UMBEL_ARTIFACTS_DIR: join(root, "config"),
      UMBEL_DATA_DIR: join(root, "data"),
      UMBEL_CACHE_DIR: join(root, "cache"),
    };
  });
  afterEach(() => cleanup(root));

  it("fetches, locks, and composes the named leaf", async () => {
    const code = await runAdd(
      ["github:acme/tools@v1", "greet", "--bundle", "dev"],
      env,
      join(root, "project"),
    );
    expect(code).toBe(0);
    const lock = readLock(join(root, "config/bundles/dev.lock"));
    expect(lock?.deps.tools).toMatchObject({ coordinate: "github:acme/tools@v1", commit });
    const manifest = readFileSync(bundlePath, "utf8");
    expect(manifest).toContain("# hand comment");
    expect(manifest).toMatch(/tools: github:acme\/tools@v1/);
    expect(manifest).toMatch(/- tools\/greet/);
  });

  it("errors with the sorted candidate list when several skills and no leaf given", async () => {
    await expect(runAdd(["github:acme/tools@v1", "--bundle", "dev"], env, root)).rejects.toThrow(
      /pick one.*--bundle dev.*farewell, greet/s,
    );
  });

  it("is idempotent: second run rewrites nothing and touches no network", async () => {
    await runAdd(["github:acme/tools@v1", "greet", "--bundle", "dev"], env, root);
    const lockPath = join(root, "config/bundles/dev.lock");
    const lockBefore = snapshotFile(lockPath);
    const manifestBefore = snapshotFile(bundlePath);
    // Poison the upstream URL: an idempotent re-add must not touch the network.
    const code = await runAdd(
      ["github:acme/tools@v1", "greet", "--bundle", "dev"],
      { ...env, UMBEL_GITHUB_BASE: `file://${join(root, "nowhere")}` },
      root,
    );
    expect(code).toBe(0);
    const lockAfter = snapshotFile(lockPath);
    const manifestAfter = snapshotFile(bundlePath);
    expect(lockAfter.content).toBe(lockBefore.content);
    expect(manifestAfter.content).toBe(manifestBefore.content);
    expect(lockAfter.mtimeMs).toBe(lockBefore.mtimeMs);
    expect(manifestAfter.mtimeMs).toBe(manifestBefore.mtimeMs);
  });

  it("rejects an alias rebind to a different coordinate", async () => {
    await runAdd(["github:acme/tools@v1", "greet", "--bundle", "dev"], env, root);
    makeGitFixture(
      join(root, "gh/other/tools"),
      { "skills/x/SKILL.md": "---\nname: x\n---\n" },
      "v9",
    );
    await expect(
      runAdd(["github:other/tools@v9", "x", "--bundle", "dev"], env, root),
    ).rejects.toThrow(/alias 'tools' is already bound/);
  });

  it("errors when no --bundle and no single-bundle pin", async () => {
    await expect(
      runAdd(["github:acme/tools@v1", "greet"], env, join(root, "project")),
    ).rejects.toThrow(/no target bundle/);
  });

  it("resolves the target bundle from a single-candidate pin", async () => {
    const project = join(root, "project");
    writeFile(join(project, ".claude", "bundles", ".keep"), "");
    writeFileSync(join(project, ".umbel-bundle"), "dev\n");
    const code = await runAdd(["github:acme/tools@v1", "greet"], env, project);
    expect(code).toBe(0);
  });

  it("accepts the --bundle=<name> form", async () => {
    const code = await runAdd(["github:acme/tools@v1", "greet", "--bundle=dev"], env, root);
    expect(code).toBe(0);
    expect(readLock(join(root, "config/bundles/dev.lock"))?.deps.tools).toBeDefined();
  });

  it("errors when the --bundle name is not found", async () => {
    await expect(
      runAdd(["github:acme/tools@v1", "greet", "--bundle", "ghost"], env, root),
    ).rejects.toThrow(/not found/);
  });

  it("rejects --bundle= with an empty value", async () => {
    await expect(runAdd(["github:acme/tools@v1", "greet", "--bundle="], env, root)).rejects.toThrow(
      /--bundle requires a value/,
    );
  });
});
