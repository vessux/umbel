import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../../src/run.ts";
import { cleanup, makeTmpDir } from "../helpers/tmp.ts";

describe("run() bundle apply", () => {
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
    mkdirSync(join(cwd, ".claude"), { recursive: true });
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

  it("--vanilla writes the sentinel pin", async () => {
    const code = await run(["apply", "--vanilla"], envWith({ NO_TTY: "1" }), cwd);
    expect(code).toBe(0);
    const pin = join(cwd, ".umbel-bundle");
    expect(existsSync(pin)).toBe(true);
    expect(readFileSync(pin, "utf8")).toBe("__vanilla__\n");
    expect(stdout.join("")).toMatch(/pinned vanilla/);
  });

  it("--vanilla rejected when combined with a name", async () => {
    bundleFile("demo");
    const code = await run(["apply", "demo", "--vanilla"], envWith({ NO_TTY: "1" }), cwd);
    expect(code).toBe(2);
    expect(stderr.join("")).toMatch(/cannot be combined/);
  });

  it("named arg writes a bundle pin", async () => {
    bundleFile("demo");
    const code = await run(["apply", "demo"], envWith({ NO_TTY: "1" }), cwd);
    expect(code).toBe(0);
    expect(readFileSync(join(cwd, ".umbel-bundle"), "utf8")).toBe("demo\n");
  });

  it("non-TTY without name returns 2", async () => {
    bundleFile("demo");
    const code = await run(["apply"], envWith({ NO_TTY: "1" }), cwd);
    expect(code).toBe(2);
    expect(stderr.join("")).toMatch(/name required/);
  });

  function multiPin(): void {
    writeFileSync(join(cwd, ".umbel-bundle"), "discovery\ndelivery\n");
  }

  it("apply <name> refuses to overwrite a multi-candidate pin (exit 2, hints unpin)", async () => {
    bundleFile("demo");
    multiPin();
    const code = await run(["apply", "demo"], envWith({ NO_TTY: "1" }), cwd);
    expect(code).toBe(2);
    expect(stderr.join("")).toMatch(/unpin/);
    expect(readFileSync(join(cwd, ".umbel-bundle"), "utf8")).toBe("discovery\ndelivery\n");
  });

  it("apply --vanilla refuses to overwrite a multi-candidate pin (exit 2)", async () => {
    multiPin();
    const code = await run(["apply", "--vanilla"], envWith({ NO_TTY: "1" }), cwd);
    expect(code).toBe(2);
    expect(stderr.join("")).toMatch(/unpin/);
    expect(readFileSync(join(cwd, ".umbel-bundle"), "utf8")).toBe("discovery\ndelivery\n");
  });

  it("apply (no name, non-TTY) over a multi-candidate pin refuses with the guard, not the name-required error", async () => {
    multiPin();
    const code = await run(["apply"], envWith({ NO_TTY: "1" }), cwd);
    expect(code).toBe(2);
    expect(stderr.join("")).toMatch(/unpin/);
  });

  it("apply still overwrites a single-candidate pin", async () => {
    bundleFile("demo");
    writeFileSync(join(cwd, ".umbel-bundle"), "old\n");
    const code = await run(["apply", "demo"], envWith({ NO_TTY: "1" }), cwd);
    expect(code).toBe(0);
    expect(readFileSync(join(cwd, ".umbel-bundle"), "utf8")).toBe("demo\n");
  });
});
