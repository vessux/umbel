import { mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../../src/run.ts";
import { cleanup, makeTmpDir } from "../helpers/tmp.ts";

describe("run() bundle gc", () => {
  let cacheDir: string;
  let stdout: string[];
  let stderr: string[];
  const realStdoutWrite = process.stdout.write.bind(process.stdout);
  const realStderrWrite = process.stderr.write.bind(process.stderr);

  beforeEach(() => {
    cacheDir = makeTmpDir("cache-");
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
    cleanup(cacheDir);
    vi.restoreAllMocks();
  });

  function envWith(): NodeJS.ProcessEnv {
    return { UMBEL_CACHE_DIR: cacheDir };
  }
  function mkHashDir(rel: string): void {
    mkdirSync(join(cacheDir, "bundles", rel), { recursive: true });
  }

  it("rejects extra positional args with exit 2", async () => {
    const code = await run(["gc", "demo"], envWith(), "/tmp");
    expect(code).toBe(2);
    expect(stderr.join("")).toMatch(/takes no arguments/i);
  });

  it("rejects extra flags with exit 2", async () => {
    const code = await run(["gc", "--keep", "5"], envWith(), "/tmp");
    expect(code).toBe(2);
    expect(stderr.join("")).toMatch(/takes no arguments/i);
  });

  it("prints 'nothing to gc' on empty cache and exits 0", async () => {
    const code = await run(["gc"], envWith(), "/tmp");
    expect(code).toBe(0);
    expect(stdout.join("")).toMatch(/nothing to gc/);
  });

  it("prunes to keep=3 per name across multiple bundles", async () => {
    for (let i = 0; i < 5; i++) {
      const hex = i.toString(16).padStart(12, "0");
      mkHashDir(`alpha-${hex}`);
    }
    for (let i = 0; i < 4; i++) {
      const hex = (i + 100).toString(16).padStart(12, "0");
      mkHashDir(`beta-${hex}`);
    }
    const code = await run(["gc"], envWith(), "/tmp");
    expect(code).toBe(0);
    expect(stdout.join("")).toMatch(/gc'd 2 bundles/);
    const remaining = readdirSync(join(cacheDir, "bundles"));
    const alpha = remaining.filter((e) => e.startsWith("alpha-"));
    const beta = remaining.filter((e) => e.startsWith("beta-"));
    expect(alpha).toHaveLength(3);
    expect(beta).toHaveLength(3);
  });

  it("counts one bundle for single-name cache", async () => {
    mkHashDir("solo-000000000001");
    const code = await run(["gc"], envWith(), "/tmp");
    expect(code).toBe(0);
    expect(stdout.join("")).toMatch(/gc'd 1 bundle\b/);
  });
});
