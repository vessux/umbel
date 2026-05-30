import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../../src/run.ts";
import { installShim, shimScript, uninstallShim } from "../../src/shim/install.ts";
import { cleanup, makeTmpDir } from "../helpers/tmp.ts";

describe("shim install/uninstall (module)", () => {
  let root: string;

  beforeEach(() => {
    root = makeTmpDir("shim-root-");
  });
  afterEach(() => {
    cleanup(root);
  });

  it("installs to a fresh path with mode 0755", () => {
    const path = join(root, "nested", "claude");
    const result = installShim(path);
    expect(result.created).toBe(true);
    expect(result.overwritten).toBe(false);
    expect(existsSync(path)).toBe(true);
    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o755);
    expect(readFileSync(path, "utf8")).toBe(shimScript());
  });

  it("refuses to overwrite without --force", () => {
    const path = join(root, "claude");
    writeFileSync(path, "existing");
    expect(() => installShim(path)).toThrow(/already exists/);
  });

  it("overwrites with --force", () => {
    const path = join(root, "claude");
    writeFileSync(path, "existing");
    const result = installShim(path, { force: true });
    expect(result.overwritten).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(shimScript());
  });

  it("uninstall removes the file when present", () => {
    const path = join(root, "claude");
    installShim(path);
    const result = uninstallShim(path);
    expect(result.removed).toBe(true);
    expect(existsSync(path)).toBe(false);
  });

  it("uninstall returns removed=false when nothing to remove", () => {
    const result = uninstallShim(join(root, "absent"));
    expect(result.removed).toBe(false);
  });

  it("shim script body short-circuits when UMBEL_RESOLVED is set", () => {
    const body = shimScript();
    expect(body).toMatch(/UMBEL_RESOLVED/);
    expect(body).toMatch(/exec umbel run --/);
    expect(body).toMatch(/#!\/usr\/bin\/env bash/);
  });
});

describe("run() shim verb", () => {
  let artifacts: string;
  let stdout: string[];
  let stderr: string[];
  const realStdoutWrite = process.stdout.write.bind(process.stdout);
  const realStderrWrite = process.stderr.write.bind(process.stderr);

  beforeEach(() => {
    artifacts = makeTmpDir("artifacts-");
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
    cleanup(artifacts);
    vi.restoreAllMocks();
  });

  function env(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    // Shim lives under the data root (UMBEL_DATA_DIR), not the config/artifacts
    // root — point it at the temp dir so tests never touch ~/.local/share.
    return { UMBEL_DATA_DIR: artifacts, ...extra };
  }

  it("shim install creates the file and prints PATH= hint", async () => {
    const code = await run(["shim", "install"], env(), "/tmp");
    expect(code).toBe(0);
    expect(existsSync(join(artifacts, "bin", "claude"))).toBe(true);
    expect(stdout.join("")).toMatch(/installed /);
    expect(stdout.join("")).toMatch(/export PATH=/);
    expect(stdout.join("")).toContain(join(artifacts, "bin"));
  });

  it("shim install twice without --force exits 4", async () => {
    await run(["shim", "install"], env(), "/tmp");
    stdout.length = 0;
    stderr.length = 0;
    const code = await run(["shim", "install"], env(), "/tmp");
    expect(code).toBe(4);
    expect(stderr.join("")).toMatch(/already exists/);
  });

  it("shim install --force overwrites", async () => {
    await run(["shim", "install"], env(), "/tmp");
    const code = await run(["shim", "install", "--force"], env(), "/tmp");
    expect(code).toBe(0);
    expect(stdout.join("")).toMatch(/overwrote /);
  });

  it("shim uninstall removes the file", async () => {
    await run(["shim", "install"], env(), "/tmp");
    stdout.length = 0;
    const code = await run(["shim", "uninstall"], env(), "/tmp");
    expect(code).toBe(0);
    expect(existsSync(join(artifacts, "bin", "claude"))).toBe(false);
    expect(stdout.join("")).toMatch(/removed /);
  });

  it("shim path prints the absolute shim path", async () => {
    const code = await run(["shim", "path"], env(), "/tmp");
    expect(code).toBe(0);
    expect(stdout.join("").trim()).toBe(join(artifacts, "bin", "claude"));
  });

  it("shim with no/unknown subcommand exits 2", async () => {
    const code = await run(["shim", "ohno"], env(), "/tmp");
    expect(code).toBe(2);
    expect(stderr.join("")).toMatch(/expected 'install'/);
  });
});
