import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prepareBundleInvocation, resolveBundleName } from "../../../src/bundle/exec.ts";
import { writePin } from "../../../src/bundle/pin.ts";
import { cleanup, makeTmpDir } from "../../helpers/tmp.ts";

describe("prepareBundleInvocation", () => {
  let agentsDir: string;
  let cacheDir: string;
  let cwd: string;

  beforeEach(() => {
    agentsDir = makeTmpDir("agents-");
    cacheDir = makeTmpDir("cache-");
    cwd = makeTmpDir("cwd-");
    mkdirSync(join(agentsDir, "bundles"), { recursive: true });
    mkdirSync(join(agentsDir, "skills"), { recursive: true });
    // Pre-stake a duckdb mcp artifact reused by tests below.
    const mcpDir = join(agentsDir, "mcps", "local", "duckdb");
    mkdirSync(mcpDir, { recursive: true });
    writeFileSync(join(mcpDir, "MCP.md"), "---\nname: duckdb\ncommand: duckdb-mcp\n---\n");
  });
  afterEach(() => {
    cleanup(agentsDir);
    cleanup(cacheDir);
    cleanup(cwd);
  });

  function bundleFile(name: string, body: string): void {
    writeFileSync(join(agentsDir, "bundles", `${name}.md`), body);
  }
  function envWith(): NodeJS.ProcessEnv {
    return {
      UMBEL_ARTIFACTS_DIR: agentsDir,
      UMBEL_CACHE_DIR: cacheDir,
    };
  }

  it("returns command='claude' with --plugin-dir / --settings / --mcp-config / --strict-mcp-config", () => {
    bundleFile("demo", "---\nname: demo\nmcps: [local/duckdb]\nsettings:\n  model: m\n---\n");
    const inv = prepareBundleInvocation({
      name: "demo",
      claudeArgs: [],
      env: envWith(),
      cwd,
    });
    expect(inv.command).toBe("claude");
    expect(inv.args).toContain("--plugin-dir");
    expect(inv.args).toContain("--settings");
    expect(inv.args).toContain("--mcp-config");
    expect(inv.args).toContain("--strict-mcp-config");
    const pluginIdx = inv.args.indexOf("--plugin-dir");
    expect(inv.args[pluginIdx + 1]).toMatch(/[/]demo-[0-9a-f]{12}$/);
    expect(existsSync(inv.args[pluginIdx + 1]!)).toBe(true);
  });

  it("injects UMBEL_BUNDLE env var with the bundle name", () => {
    bundleFile("demo", "---\nname: demo\n---\n");
    const inv = prepareBundleInvocation({
      name: "demo",
      claudeArgs: [],
      env: envWith(),
      cwd,
    });
    expect(inv.env.UMBEL_BUNDLE).toBe("demo");
  });

  it("forwards trailing claudeArgs verbatim after the bundle flags", () => {
    bundleFile("demo", "---\nname: demo\n---\n");
    const inv = prepareBundleInvocation({
      name: "demo",
      claudeArgs: ["--version", "--debug"],
      env: envWith(),
      cwd,
    });
    expect(inv.args.slice(-2)).toEqual(["--version", "--debug"]);
  });

  it("omits --mcp-config / --strict-mcp-config when bundle declares no MCPs", () => {
    bundleFile("demo", "---\nname: demo\n---\n");
    const inv = prepareBundleInvocation({
      name: "demo",
      claudeArgs: [],
      env: envWith(),
      cwd,
    });
    expect(inv.args).not.toContain("--mcp-config");
    expect(inv.args).not.toContain("--strict-mcp-config");
  });

  it("omits --strict-mcp-config when mergeMcp: true", () => {
    bundleFile("demo", "---\nname: demo\nmergeMcp: true\nmcps: [local/duckdb]\n---\n");
    const inv = prepareBundleInvocation({
      name: "demo",
      claudeArgs: [],
      env: envWith(),
      cwd,
    });
    expect(inv.args).toContain("--mcp-config");
    expect(inv.args).not.toContain("--strict-mcp-config");
  });

  it("omits --settings when bundle declares no settings/hooks", () => {
    bundleFile("demo", "---\nname: demo\n---\n");
    const inv = prepareBundleInvocation({
      name: "demo",
      claudeArgs: [],
      env: envWith(),
      cwd,
    });
    expect(inv.args).not.toContain("--settings");
  });
});

describe("resolveBundleName", () => {
  let cwd: string;
  let home: string;

  beforeEach(() => {
    cwd = makeTmpDir("cwd-");
    home = makeTmpDir("home-");
    mkdirSync(join(cwd, ".claude"), { recursive: true });
  });
  afterEach(() => {
    cleanup(cwd);
    cleanup(home);
  });

  it("explicit arg wins over env and pin", () => {
    writePin(cwd, home, "fromPin");
    expect(resolveBundleName(["wanted"], { UMBEL_BUNDLE: "fromEnv" }, cwd, home)).toEqual({
      kind: "named",
      name: "wanted",
      via: "arg",
    });
  });

  it("env beats pin when no arg", () => {
    writePin(cwd, home, "fromPin");
    expect(resolveBundleName([], { UMBEL_BUNDLE: "fromEnv" }, cwd, home)).toEqual({
      kind: "named",
      name: "fromEnv",
      via: "env",
    });
  });

  it("pin used when no arg or env", () => {
    writePin(cwd, home, "fromPin");
    expect(resolveBundleName([], {}, cwd, home)).toEqual({
      kind: "named",
      name: "fromPin",
      via: "pin",
    });
  });

  it("returns unresolved when none present", () => {
    expect(resolveBundleName([], {}, cwd, home)).toMatchObject({
      kind: "unresolved",
      message: expect.stringMatching(/no bundle/i),
    });
  });

  it("ignores empty UMBEL_BUNDLE", () => {
    writePin(cwd, home, "fromPin");
    const r = resolveBundleName([], { UMBEL_BUNDLE: "" }, cwd, home);
    expect(r.kind === "named" ? r.name : null).toBe("fromPin");
  });

  it("UMBEL_BUNDLE=__vanilla__ resolves vanilla via env", () => {
    expect(resolveBundleName([], { UMBEL_BUNDLE: "__vanilla__" }, cwd, home)).toEqual({
      kind: "vanilla",
      via: "env",
    });
  });

  it("vanilla pin resolves to vanilla via pin", () => {
    writeFileSync(join(cwd, ".umbel-bundle"), "__vanilla__\n");
    expect(resolveBundleName([], {}, cwd, home)).toEqual({
      kind: "vanilla",
      via: "pin",
    });
  });

  it("multi-candidate pin resolves to multiple via pin, in order", () => {
    writeFileSync(join(cwd, ".umbel-bundle"), "discovery\ndelivery\n");
    expect(resolveBundleName([], {}, cwd, home)).toEqual({
      kind: "multiple",
      via: "pin",
      candidates: [
        { kind: "bundle", name: "discovery" },
        { kind: "bundle", name: "delivery" },
      ],
    });
  });

  it("arg still overrides a multi-candidate pin (bypasses the picker)", () => {
    writeFileSync(join(cwd, ".umbel-bundle"), "discovery\ndelivery\n");
    expect(resolveBundleName(["wanted"], {}, cwd, home)).toEqual({
      kind: "named",
      name: "wanted",
      via: "arg",
    });
  });

  it("UMBEL_BUNDLE still overrides a multi-candidate pin", () => {
    writeFileSync(join(cwd, ".umbel-bundle"), "discovery\ndelivery\n");
    expect(resolveBundleName([], { UMBEL_BUNDLE: "fromEnv" }, cwd, home)).toEqual({
      kind: "named",
      name: "fromEnv",
      via: "env",
    });
  });
});
