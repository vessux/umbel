import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildSourceTree, cleanup, makeTmpDir } from "../helpers/tmp.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = join(ROOT, "dist", "cli.js");

function runCli(
  args: string[],
  env: Record<string, string> = {},
): {
  status: number;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync("node", [CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

describe("cli exit codes", () => {
  let root: string;
  let source: string;
  let target: string;

  beforeEach(() => {
    if (!existsSync(CLI)) {
      throw new Error(`dist/cli.js not built — run \`npm run build\` first (looked at ${CLI})`);
    }
    root = makeTmpDir();
    source = join(root, "src");
    target = join(root, "tgt");
    mkdirSync(source, { recursive: true });
    buildSourceTree(source, [{ name: "tdd", source: "pocock", description: "t" }]);
  });
  afterEach(() => {
    cleanup(root);
  });

  it("exit 0 on dry-run success", () => {
    const r = runCli([
      "skills",
      "--source",
      source,
      "--target",
      target,
      "--skills",
      "pocock/tdd",
      "--dry-run",
    ]);
    expect(r.status).toBe(0);
  });

  it("exit 2 on unknown top-level command", () => {
    const r = runCli(["--nope"]);
    expect(r.status).toBe(2);
  });

  it("exit 2 on missing --target when piped", () => {
    const r = runCli(["skills", "--skills", "tdd"]);
    expect(r.status).toBe(2);
  });

  it("exit 3 on unknown skill name", () => {
    const r = runCli([
      "skills",
      "--source",
      source,
      "--target",
      target,
      "--skills",
      "ghost",
      "--dry-run",
    ]);
    expect(r.status).toBe(3);
  });

  it("exit 3 on missing source", () => {
    const r = runCli([
      "skills",
      "--source",
      join(root, "nope"),
      "--target",
      target,
      "--skills",
      "tdd",
      "--dry-run",
    ]);
    expect(r.status).toBe(3);
  });

  it("exit 4 on real dir without --force", () => {
    mkdirSync(target, { recursive: true });
    mkdirSync(join(target, "tdd"));
    writeFileSync(join(target, "tdd", "manual.txt"), "hi");
    const r = runCli([
      "skills",
      "--source",
      source,
      "--target",
      target,
      "--skills",
      "pocock/tdd",
      "--dry-run",
    ]);
    expect(r.status).toBe(4);
  });

  it("exit 0 on real dir with --force (dry-run doesn't touch fs)", () => {
    mkdirSync(target, { recursive: true });
    mkdirSync(join(target, "tdd"));
    const r = runCli([
      "skills",
      "--source",
      source,
      "--target",
      target,
      "--skills",
      "pocock/tdd",
      "--dry-run",
      "--force",
    ]);
    expect(r.status).toBe(0);
    // Dry-run must not create anything beyond what existed.
    // target/tdd still exists as a real dir (not replaced yet).
  });
});
