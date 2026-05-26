import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../../src/run.ts";
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

  it("exits 2 with hint when no name resolvable in non-TTY mode", async () => {
    const code = await run(["run"], envWith({ NO_TTY: "1" }), cwd);
    expect(code).toBe(2);
    expect(stderr.join("")).toMatch(/non-TTY|name required/);
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

  itIfClaude("smoke: spawning claude --help via wrapper exits 0 with bundle flags", async () => {
    bundleFile("demo");
    const code = await run(
      ["run", "demo", "--", "--help"],
      envWith({ PATH: process.env.PATH ?? "" }),
      cwd,
    );
    expect(code).toBe(0);
  });
});
