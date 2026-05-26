import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../../src/run.ts";
import { cleanup, makeTmpDir } from "../helpers/tmp.ts";

describe("run() bundle build", () => {
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
    mkdirSync(join(agentsDir, "skills"), { recursive: true });
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

  function writeBundle(name: string, body: string): void {
    writeFileSync(join(agentsDir, "bundles", `${name}.md`), body);
  }
  function mkSkill(name: string): void {
    const dir = join(agentsDir, "skills", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\n---\nbody\n`);
  }

  function envWith(): NodeJS.ProcessEnv {
    return {
      UMBEL_ARTIFACTS_DIR: agentsDir,
      UMBEL_CACHE_DIR: cacheDir,
    };
  }

  it("exits 0 and prints cache path on successful build", async () => {
    writeBundle("demo", "---\nname: demo\nskills: [tdd]\n---\n");
    mkSkill("tdd");
    const code = await run(["build", "demo"], envWith(), cwd);
    expect(code).toBe(0);
    const printed = stdout.join("").trim();
    expect(printed).toMatch(/[/]demo-[0-9a-f]{12}$/);
    expect(existsSync(printed)).toBe(true);
  });

  it("exits 3 when bundle name not found", async () => {
    const code = await run(["build", "ghost"], envWith(), cwd);
    expect(code).toBe(3);
    expect(stderr.join("")).toMatch(/ghost.*not found/);
  });

  it("exits 2 when no name supplied", async () => {
    const code = await run(["build"], envWith(), cwd);
    expect(code).toBe(2);
    expect(stderr.join("")).toMatch(/name required/i);
  });

  it("rebuilds when --no-cache passed", async () => {
    writeBundle("demo", "---\nname: demo\n---\n");
    const code1 = await run(["build", "demo"], envWith(), cwd);
    const path1 = stdout.join("").trim();
    stdout.length = 0;
    const code2 = await run(["build", "demo", "--no-cache"], envWith(), cwd);
    const path2 = stdout.join("").trim();
    expect(code1).toBe(0);
    expect(code2).toBe(0);
    expect(path1).toBe(path2);
  });
});
