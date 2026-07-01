import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gateWarnings, run } from "../../src/run.ts";
import { cleanup, makeTmpDir } from "../helpers/tmp.ts";

const haveClaude = spawnSync("which", ["claude"]).status === 0;
const itIfClaude = haveClaude ? it : it.skip;

describe("run() bundle run", () => {
  let agentsDir: string;
  let cacheDir: string;
  let cwd: string;
  let stdout: string[];
  let stderr: string[];
  const realStdoutWrite = process.stdout.write.bind(process.stdout);
  const realStderrWrite = process.stderr.write.bind(process.stderr);

  beforeEach(() => {
    agentsDir = makeTmpDir("agents-");
    cacheDir = makeTmpDir("cache-");
    cwd = makeTmpDir("cwd-");
    mkdirSync(join(agentsDir, "bundles"), { recursive: true });
    stdout = [];
    stderr = [];
    vi.spyOn(process.stdout, "write").mockImplementation(((c: string | Uint8Array) => {
      stdout.push(typeof c === "string" ? c : Buffer.from(c).toString());
      return true;
    }) as typeof realStdoutWrite);
    vi.spyOn(process.stderr, "write").mockImplementation(((c: string | Uint8Array) => {
      stderr.push(typeof c === "string" ? c : Buffer.from(c).toString());
      return true;
    }) as typeof realStderrWrite);
  });
  afterEach(() => {
    cleanup(agentsDir);
    cleanup(cacheDir);
    cleanup(cwd);
    vi.restoreAllMocks();
  });

  function envWith(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    return {
      UMBEL_ARTIFACTS_DIR: agentsDir,
      UMBEL_CACHE_DIR: cacheDir,
      ...extra,
    };
  }

  function bundleFile(name: string): void {
    writeFileSync(join(agentsDir, "bundles", `${name}.md`), `---\nname: ${name}\n---\n`);
  }

  it("non-TTY + no name resolvable → silent vanilla (no hint, exec claude)", async () => {
    const code = await run(["run"], envWith({ NO_TTY: "1", PATH: "/" }), cwd);
    expect(code).toBe(1);
    expect(stderr.join("")).toMatch(/'claude' not found on PATH/);
    expect(stderr.join("")).not.toMatch(/name required|non-TTY/);
  });

  it("vanilla pin → execs claude with no flags", async () => {
    mkdirSync(join(cwd, ".claude"), { recursive: true });
    writeFileSync(join(cwd, ".umbel-bundle"), "__vanilla__\n");
    const code = await run(["run"], envWith({ NO_TTY: "1", PATH: "/" }), cwd);
    expect(code).toBe(1);
    expect(stderr.join("")).toMatch(/'claude' not found on PATH/);
  });

  it("UMBEL_BUNDLE=__vanilla__ → execs claude with no flags", async () => {
    const code = await run(
      ["run"],
      envWith({ NO_TTY: "1", PATH: "/", UMBEL_BUNDLE: "__vanilla__" }),
      cwd,
    );
    expect(code).toBe(1);
    expect(stderr.join("")).toMatch(/'claude' not found on PATH/);
  });

  it("UMBEL_RESOLVED=1 + no name → exec vanilla immediately", async () => {
    const code = await run(["run"], envWith({ NO_TTY: "1", PATH: "/", UMBEL_RESOLVED: "1" }), cwd);
    expect(code).toBe(1);
    expect(stderr.join("")).toMatch(/'claude' not found on PATH/);
  });

  it("exits 3 when bundle name not found", async () => {
    const code = await run(["run", "ghost"], envWith(), cwd);
    expect(code).toBe(3);
    expect(stderr.join("")).toMatch(/ghost.*not found/);
  });

  it("exits 1 when 'claude' is not on PATH", async () => {
    bundleFile("demo");
    // Override PATH to a guaranteed-empty dir so 'claude' resolution fails.
    const code = await run(["run", "demo"], envWith({ PATH: "/" }), cwd);
    expect(code).toBe(1);
    expect(stderr.join("")).toMatch(/not found on PATH/);
  });

  it("prints a 'building bundle' notice to stderr on a cache miss", async () => {
    bundleFile("demo");
    await run(["run", "demo"], envWith({ PATH: "/" }), cwd);
    expect(stderr.join("")).toMatch(/building bundle 'demo'…/);
  });

  it("does not re-print the build notice on a cache hit (second run)", async () => {
    bundleFile("demo");
    await run(["run", "demo"], envWith({ PATH: "/" }), cwd);
    stderr.length = 0;
    await run(["run", "demo"], envWith({ PATH: "/" }), cwd);
    expect(stderr.join("")).not.toMatch(/building bundle/);
  });

  itIfClaude("smoke: spawning claude --help via wrapper exits 0 with bundle flags", async () => {
    bundleFile("demo");
    const code = await run(
      ["run", "demo", "--", "--help"],
      envWith({ PATH: process.env.PATH ?? "" }),
      cwd,
    );
    expect(code).toBe(0);
  });

  it("multi-candidate pin (non-TTY) resolves to the first/default candidate and builds it", async () => {
    mkdirSync(join(cwd, ".claude"), { recursive: true });
    bundleFile("alpha");
    bundleFile("beta");
    writeFileSync(join(cwd, ".umbel-bundle"), "alpha\nbeta\n");
    const code = await run(["run"], envWith({ NO_TTY: "1", PATH: "/" }), cwd);
    expect(code).toBe(1); // claude not on PATH=/
    expect(stderr.join("")).toMatch(/building bundle 'alpha'…/);
    expect(stderr.join("")).not.toMatch(/building bundle 'beta'/);
  });

  it("candidate order is semantic — reordering changes the non-TTY default", async () => {
    mkdirSync(join(cwd, ".claude"), { recursive: true });
    bundleFile("alpha");
    bundleFile("beta");
    writeFileSync(join(cwd, ".umbel-bundle"), "beta\nalpha\n");
    await run(["run"], envWith({ NO_TTY: "1", PATH: "/" }), cwd);
    expect(stderr.join("")).toMatch(/building bundle 'beta'…/);
  });

  it("multi-candidate pin (non-TTY) whose default is an unknown bundle exits 3", async () => {
    mkdirSync(join(cwd, ".claude"), { recursive: true });
    bundleFile("alpha");
    writeFileSync(join(cwd, ".umbel-bundle"), "ghost\nalpha\n");
    const code = await run(["run"], envWith({ NO_TTY: "1", PATH: "/" }), cwd);
    expect(code).toBe(3);
    expect(stderr.join("")).toMatch(/ghost.*not found/);
  });

  it("multi-candidate pin whose default is __vanilla__ (non-TTY) execs vanilla", async () => {
    mkdirSync(join(cwd, ".claude"), { recursive: true });
    bundleFile("alpha");
    writeFileSync(join(cwd, ".umbel-bundle"), "__vanilla__\nalpha\n");
    const code = await run(["run"], envWith({ NO_TTY: "1", PATH: "/" }), cwd);
    expect(code).toBe(1);
    expect(stderr.join("")).toMatch(/'claude' not found on PATH/);
    expect(stderr.join("")).not.toMatch(/building bundle/);
  });

  it("non-TTY run of a bundle with a genuine-unknown field prints the warning and proceeds", async () => {
    writeFileSync(
      join(agentsDir, "bundles", "warny.md"),
      "---\nname: warny\nnotarealfield: true\n---\n",
    );
    const code = await run(["run", "warny"], envWith({ NO_TTY: "1", PATH: "/" }), cwd);
    expect(code).toBe(1); // proceeds to spawn; claude not on PATH=/
    expect(stderr.join("")).toMatch(/unknown field 'notarealfield'/);
  });

  describe("gateWarnings", () => {
    it("does nothing (no emit, no prompt) when there are no warnings", async () => {
      const prompt = vi.fn(async () => {});
      await gateWarnings([], true, prompt);
      expect(prompt).not.toHaveBeenCalled();
      expect(stderr.join("")).toBe("");
    });

    it("non-interactive: emits warnings to stderr but does NOT block on a prompt", async () => {
      const prompt = vi.fn(async () => {});
      await gateWarnings(["bundle x: unknown field 'foo' (ignored)"], false, prompt);
      expect(prompt).not.toHaveBeenCalled();
      expect(stderr.join("")).toMatch(/unknown field 'foo'/);
    });

    it("interactive (TTY): emits warnings AND awaits the acknowledgment prompt", async () => {
      const prompt = vi.fn(async () => {});
      await gateWarnings(["bundle x: unknown field 'foo' (ignored)"], true, prompt);
      expect(prompt).toHaveBeenCalledTimes(1);
      expect(stderr.join("")).toMatch(/unknown field 'foo'/);
    });
  });
});
