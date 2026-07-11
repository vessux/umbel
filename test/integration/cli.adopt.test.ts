import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeGitFixture } from "../helpers/git.ts";
import { cleanup, makeTmpDir } from "../helpers/tmp.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = join(ROOT, "dist", "cli.js");

describe("umbel adopt (integration)", () => {
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
    if (!existsSync(CLI)) throw new Error("dist/cli.js not built — run `npm run build`");
    root = makeTmpDir();
    makeGitFixture(join(root, "gh/acme/tools"), {
      "skills/greet/SKILL.md": "---\nname: greet\ndescription: hi\n---\nhello\n",
      "agents/rev/AGENT.md": "---\nname: rev\ndescription: r\n---\nreview\n",
    });
    env = {
      UMBEL_GITHUB_BASE: `file://${join(root, "gh")}`,
      UMBEL_ARTIFACTS_DIR: join(root, "config"),
      UMBEL_DATA_DIR: join(root, "data"),
      UMBEL_CACHE_DIR: join(root, "cache"),
    };
  });
  afterAll(() => cleanup(root));

  it("mirrors a source into a new user bundle; build compiles it", () => {
    const r = umbel("adopt", "https://github.com/acme/tools", "toolkit");
    expect(r.status).toBe(0);
    const md = readFileSync(join(root, "config/bundles/toolkit.md"), "utf8");
    expect(md).toMatch(/adopted-from: github:acme\/tools/);
    expect(md).toMatch(/- toolkit\/greet/);
    expect(md).toMatch(/- toolkit\/rev/);
    expect(readFileSync(join(root, "config/skills/toolkit/greet/SKILL.md"), "utf8")).toContain(
      "hello",
    );
    expect(readFileSync(join(root, "config/agents/toolkit/rev/AGENT.md"), "utf8")).toContain(
      "review",
    );

    const b = umbel("build", "toolkit");
    expect(b.status).toBe(0);
    const cacheDir = b.stdout.trim().split("\n").pop()!;
    expect(readFileSync(join(cacheDir, "skills/greet/SKILL.md"), "utf8")).toContain("hello");
  });

  it("a taken name is a conflict (exit 4), attributed to adopt not import", () => {
    const r = umbel("adopt", "https://github.com/acme/tools", "toolkit");
    expect(r.status).toBe(4);
    expect(r.stderr).toMatch(/umbel adopt:/);
    expect(r.stderr).not.toMatch(/import/);
  });

  it("derives the bundle name from the repo when none is given", () => {
    const r = umbel("adopt", "github:acme/tools");
    expect(r.status).toBe(0);
    expect(existsSync(join(root, "config/bundles/tools.md"))).toBe(true);
  });
});

describe("umbel adopt — .claude-plugin conversion", () => {
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
    root = makeTmpDir();
    makeGitFixture(join(root, "gh/acme/plug"), {
      ".claude-plugin/plugin.json": JSON.stringify({
        name: "plug",
        mcpServers: { db: { command: "npx", args: ["duckdb-mcp"] } },
      }),
      "skills/s/SKILL.md": "---\nname: s\ndescription: s\n---\ns\n",
      "hooks/hooks.json": JSON.stringify({
        hooks: {
          Stop: [
            {
              matcher: "",
              hooks: [{ type: "command", command: "${CLAUDE_PLUGIN_ROOT}/scripts/x.sh" }],
            },
          ],
        },
      }),
      "scripts/x.sh": "#!/bin/sh\necho x\n",
    });
    env = {
      UMBEL_GITHUB_BASE: `file://${join(root, "gh")}`,
      UMBEL_ARTIFACTS_DIR: join(root, "config"),
      UMBEL_DATA_DIR: join(root, "data"),
      UMBEL_CACHE_DIR: join(root, "cache"),
    };
  });
  afterAll(() => cleanup(root));

  it("converts hooks.json + mcpServers, then compiles them into the plugin cache", () => {
    const r = umbel("adopt", "github:acme/plug", "plug", "--yes");
    expect(r.status).toBe(0);
    expect(existsSync(join(root, "config/mcps/plug/db/MCP.md"))).toBe(true);
    const hookLeaf = readdirSync(join(root, "config/hooks/plug"))[0];
    expect(hookLeaf).toBeDefined();
    expect(existsSync(join(root, "config/hooks/plug", hookLeaf!, "scripts/x.sh"))).toBe(true);
    const b = umbel("build", "plug");
    expect(b.status).toBe(0);
    const cacheDir = b.stdout.trim().split("\n").pop()!;
    expect(existsSync(join(cacheDir, "hooks/hooks.json"))).toBe(true);
    expect(existsSync(join(cacheDir, ".mcp.json"))).toBe(true);
  });
});
