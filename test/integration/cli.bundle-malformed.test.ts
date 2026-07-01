import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, makeTmpDir } from "../helpers/tmp.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = join(ROOT, "dist", "cli.js");

describe("cli bundle exit codes", () => {
  let root: string;
  let artifacts: string;
  let bundles: string;

  beforeEach(() => {
    if (!existsSync(CLI)) {
      throw new Error(`dist/cli.js not built — run \`npm run build\` first (looked at ${CLI})`);
    }
    root = makeTmpDir();
    artifacts = join(root, "artifacts");
    bundles = join(artifacts, "bundles");
    mkdirSync(bundles, { recursive: true });
  });
  afterEach(() => cleanup(root));

  function runCli(args: string[]): { status: number; stdout: string; stderr: string } {
    const r = spawnSync("node", [CLI, ...args], {
      encoding: "utf8",
      cwd: root,
      env: {
        ...process.env,
        HOME: root,
        UMBEL_ARTIFACTS_DIR: artifacts,
        UMBEL_CACHE_DIR: join(root, "cache"),
      },
    });
    return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
  }

  it("exit 2 with the real validation message on a malformed bundle", () => {
    writeFileSync(join(bundles, "bad.md"), "---\nname: bad\nsettings:\n  notAllowed: 1\n---\n");
    const r = runCli(["build", "bad"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/not in the whitelist/);
    expect(r.stderr).not.toMatch(/not found/);
  });

  it("exit 3 on a genuinely nonexistent bundle name", () => {
    const r = runCli(["build", "ghost"]);
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/not found/);
  });

  it("exit 0 with a stderr warning on an unknown frontmatter field", () => {
    writeFileSync(join(bundles, "typo.md"), "---\nname: typo\nbogusKey: 123\n---\nbody\n");
    const r = runCli(["build", "typo"]);
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/unknown field 'bogusKey'/);
  });

  it("exit 2 when a bundle extends a present-but-malformed parent, surfacing the parent's error", () => {
    writeFileSync(join(bundles, "base.md"), "---\nname: base\nsettings:\n  notAllowed: 1\n---\n");
    writeFileSync(join(bundles, "leaf.md"), "---\nname: leaf\nextends: [base]\n---\n");
    const r = runCli(["build", "leaf"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/not in the whitelist/);
    expect(r.stderr).toMatch(/base/);
    expect(r.stderr).not.toMatch(/missing parent/);
  });

  it("exit 3 when a bundle extends a truly-absent parent (regression)", () => {
    writeFileSync(join(bundles, "orphan.md"), "---\nname: orphan\nextends: [nope]\n---\n");
    const r = runCli(["build", "orphan"]);
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/missing parent/);
    expect(r.stderr).toMatch(/nope/);
  });
});
