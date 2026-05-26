import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../../src/run.ts";
import { cleanup, makeTmpDir } from "../helpers/tmp.ts";

describe("run() — 'umbel skills' picker (v0)", () => {
  let root: string;
  let source: string;
  let target: string;
  let stderr: string[];
  let stdout: string[];
  const realStdoutWrite = process.stdout.write.bind(process.stdout);
  const realStderrWrite = process.stderr.write.bind(process.stderr);

  beforeEach(() => {
    root = makeTmpDir();
    source = join(root, "src");
    target = join(root, "tgt");
    mkdirSync(source, { recursive: true });
    mkdirSync(join(source, "pocock", "tdd"), { recursive: true });
    writeFileSync(
      join(source, "pocock", "tdd", "SKILL.md"),
      "---\nname: tdd\ndescription: t\n---\nbody\n",
    );
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
    cleanup(root);
    vi.restoreAllMocks();
  });

  it("'umbel skills --target X --skills Y --dry-run' runs cleanly", async () => {
    const code = await run(
      ["skills", "--source", source, "--target", target, "--skills", "pocock/tdd", "--dry-run"],
      {},
      root,
    );
    expect(code).toBe(0);
  });

  it("'umbel --help' prints help and exits 0", async () => {
    const code = await run(["--help"], {}, root);
    expect(code).toBe(0);
    expect(stdout.join("")).toMatch(/Usage:/);
  });

  it("'umbel' with no args prints help and exits 0", async () => {
    const code = await run([], {}, root);
    expect(code).toBe(0);
    expect(stdout.join("")).toMatch(/Usage:/);
  });

  it("'umbel <bogus>' returns exit code 2", async () => {
    const code = await run(["bogus"], {}, root);
    expect(code).toBe(2);
    expect(stderr.join("")).toMatch(/unknown command/i);
  });
});
