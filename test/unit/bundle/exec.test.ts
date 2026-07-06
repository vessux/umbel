import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverBundles } from "../../../src/bundle/discover.ts";
import {
  prepareBundleInvocation,
  resolveBundle,
  resolveBundleName,
} from "../../../src/bundle/exec.ts";
import { writePin } from "../../../src/bundle/pin.ts";
import { NotFoundError, UsageError } from "../../../src/errors.ts";
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

  it("injects UMBEL_RESOLVED_DIR (the cache dir) and UMBEL_BUNDLE_VERSION (matching the compiled plugin.json version)", () => {
    bundleFile("demo", "---\nname: demo\n---\n");
    const inv = prepareBundleInvocation({
      name: "demo",
      claudeArgs: [],
      env: envWith(),
      cwd,
    });
    expect(inv.env.UMBEL_RESOLVED_DIR).toBe(inv.cacheDir);
    expect(inv.env.UMBEL_BUNDLE_VERSION).toMatch(/^0\.0\.0\+[0-9a-f]{12}$/);
    // Must equal the value the compiler wrote — sourced, never re-derived, so the two can't drift.
    const plugin = JSON.parse(
      readFileSync(join(inv.cacheDir, ".claude-plugin", "plugin.json"), "utf8"),
    ) as { version: string };
    expect(inv.env.UMBEL_BUNDLE_VERSION).toBe(plugin.version);
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

  it("carries the bundle's unknown-field warnings out on the invocation", () => {
    bundleFile("warny", "---\nname: warny\nbogusKey: 1\n---\n");
    const inv = prepareBundleInvocation({ name: "warny", claudeArgs: [], env: envWith(), cwd });
    expect(inv.warnings.some((w) => w.includes("bogusKey"))).toBe(true);
  });

  it("rejects deps: combined with extends (resolve-then-merge not shipped yet)", () => {
    bundleFile("parent", "---\nname: parent\n---\n");
    bundleFile(
      "child",
      "---\nname: child\nextends: [parent]\ndeps:\n  tools: github:acme/tools@v1\n---\n",
    );
    expect(() =>
      prepareBundleInvocation({ name: "child", claudeArgs: [], env: envWith(), cwd }),
    ).toThrow(/'deps:'.*'extends'.*not supported yet/);
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

describe("resolveBundle", () => {
  let root: string;
  let userDir: string;
  let projectDir: string;

  beforeEach(() => {
    root = makeTmpDir("rb-");
    userDir = join(root, "user");
    projectDir = join(root, "project");
    mkdirSync(userDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
  });
  afterEach(() => cleanup(root));

  function indexOf() {
    return { userDir, projectDir, entries: discoverBundles({ userDir, projectDir }) };
  }

  it("surfaces a malformed bundle's error as UsageError (exit-2), not NotFoundError", () => {
    writeFileSync(join(userDir, "bad.md"), "---\nname: bad\nsettings:\n  notAllowed: 1\n---\n");
    let caught: unknown;
    try {
      resolveBundle("bad", indexOf(), { UMBEL_ARTIFACTS_DIR: root });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(UsageError);
    expect((caught as Error).message).toMatch(/not in the whitelist/);
  });

  it("reports a genuinely missing bundle as NotFoundError (exit-3)", () => {
    expect(() => resolveBundle("ghost", indexOf(), { UMBEL_ARTIFACTS_DIR: root })).toThrow(
      NotFoundError,
    );
  });

  it("a healthy bundle shadowing a malformed same-named one resolves normally", () => {
    writeFileSync(join(projectDir, "dup.md"), "---\nname: dup\n---\nbody\n");
    writeFileSync(join(userDir, "dup.md"), "---\nname: dup\nsettings:\n  notAllowed: 1\n---\n");
    expect(() => resolveBundle("dup", indexOf(), { UMBEL_ARTIFACTS_DIR: root })).not.toThrow();
  });

  it("aggregates unknown-field warnings across the extends chain", () => {
    writeFileSync(join(userDir, "base.md"), "---\nname: base\nbogusBase: 1\n---\n");
    writeFileSync(
      join(userDir, "child.md"),
      "---\nname: child\nextends: [base]\nbogusChild: 2\n---\n",
    );
    const { warnings } = resolveBundle("child", indexOf(), { UMBEL_ARTIFACTS_DIR: root });
    expect(warnings.some((w) => w.includes("bogusBase"))).toBe(true);
    expect(warnings.some((w) => w.includes("bogusChild"))).toBe(true);
  });
});
