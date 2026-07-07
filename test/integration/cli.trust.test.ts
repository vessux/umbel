import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addCommitTag, makeGitFixture } from "../helpers/git.ts";
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

describe("umbel install trust gate on changed executable content", () => {
  let root: string;
  let env: NodeJS.ProcessEnv;
  let repo: string;
  let bundlePath: string;

  function umbel(...args: string[]) {
    return spawnSync(process.execPath, [CLI, ...args], {
      encoding: "utf8",
      env: { ...process.env, ...env, NO_TTY: "1" },
      cwd: root,
    });
  }

  beforeAll(() => {
    root = makeTmpDir();
    repo = join(root, "gh/acme/hookdep");
    // v1: hook body "echo A" (command string ./run.sh) + a skill to compose.
    makeGitFixture(repo, {
      "hooks/fmt/HOOK.md": '---\nname: fmt\nevent: Stop\nmatcher: ""\ncommand: ./run.sh\n---\n',
      "hooks/fmt/run.sh": "#!/bin/sh\necho A\n",
      "skills/s/SKILL.md": "---\nname: s\ndescription: s\n---\ns\n",
    });
    bundlePath = join(root, "config/bundles/hookbundle.md");
    writeFile(
      bundlePath,
      "---\nname: hookbundle\ndeps:\n  hookdep: github:acme/hookdep@v1\nskills:\n  - hookdep/s\n---\n",
    );
    env = {
      UMBEL_GITHUB_BASE: `file://${join(root, "gh")}`,
      UMBEL_ARTIFACTS_DIR: join(root, "config"),
      UMBEL_DATA_DIR: join(root, "data"),
      UMBEL_CACHE_DIR: join(root, "cache"),
    };
  });
  afterAll(() => cleanup(root));

  it("seeds the lock at v1 with --yes, then a v2 body change (same command) re-gates and writes nothing", () => {
    // 1) Seed the lock at v1 (executable content trusted via --yes).
    const r1 = umbel("install", "--bundle", "hookbundle", "--yes");
    expect(r1.status).toBe(0);
    const lockPath = join(root, "config/bundles/hookbundle.lock");
    expect(existsSync(lockPath)).toBe(true);
    const v1Commit = JSON.parse(readFileSync(lockPath, "utf8")).deps.hookdep.commit;

    // 2) Upstream ships v2: SAME command (./run.sh), changed body only.
    addCommitTag(repo, { "hooks/fmt/run.sh": "#!/bin/sh\necho B\n" }, "v2");
    // 3) Point the manifest at v2.
    writeFileSync(bundlePath, readFileSync(bundlePath, "utf8").replace("@v1", "@v2"));

    // 4) Reconcile: the changed executable content re-gates → fail closed (non-TTY).
    const r2 = umbel("install", "--bundle", "hookbundle");
    expect(r2.status).toBe(5);
    expect(r2.stderr).toMatch(/executable content/);
    // Lock untouched: still pins v1 (nothing written on refusal).
    expect(JSON.parse(readFileSync(lockPath, "utf8")).deps.hookdep.commit).toBe(v1Commit);
    expect(JSON.parse(readFileSync(lockPath, "utf8")).deps.hookdep.coordinate).toBe(
      "github:acme/hookdep@v1",
    );
  });

  it("--yes lets the v2 change through and advances the lock", () => {
    const lockPath = join(root, "config/bundles/hookbundle.lock");
    const r = umbel("install", "--bundle", "hookbundle", "--yes");
    expect(r.status).toBe(0);
    expect(JSON.parse(readFileSync(lockPath, "utf8")).deps.hookdep.coordinate).toBe(
      "github:acme/hookdep@v2",
    );
  });
});
