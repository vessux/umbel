import { mkdirSync, readFileSync, readlinkSync, statSync, writeFileSync } from "node:fs";
import { join, basename as pathBasename } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gcBundles } from "../../../src/bundle/cache.ts";
import { compile } from "../../../src/bundle/compile.ts";
import type { ResolvedBundle } from "../../../src/bundle/compose.ts";
import type { ResolvedSources } from "../../../src/bundle/resolve.ts";
import { UsageError } from "../../../src/errors.ts";
import { cleanup, makeTmpDir } from "../../helpers/tmp.ts";

function bundle(partial: Partial<ResolvedBundle>): ResolvedBundle {
  return { name: "demo", sourcePath: "/x", body: "", ...partial };
}

function emptySources(): ResolvedSources {
  return {
    skills: new Map(),
    agents: new Map(),
    hooks: new Map(),
    mcps: new Map(),
    warnings: [],
  };
}

describe("compile", () => {
  let cacheRoot: string;
  let srcRoot: string;

  beforeEach(() => {
    cacheRoot = makeTmpDir("umbel-cache-");
    srcRoot = makeTmpDir("umbel-src-");
  });
  afterEach(() => {
    cleanup(cacheRoot);
    cleanup(srcRoot);
  });

  function mkArtifact(kind: "skills" | "agents", name: string): string {
    const p = join(srcRoot, kind, name);
    mkdirSync(p, { recursive: true });
    const mdFile = kind === "skills" ? "SKILL.md" : "AGENT.md";
    writeFileSync(join(p, mdFile), `---\nname: ${name}\n---\nbody\n`);
    return p;
  }

  it("creates a cache dir with .claude-plugin/plugin.json", () => {
    const dir = compile(bundle({ name: "demo" }), emptySources(), { cacheRoot });
    expect(dir).toMatch(/[/]demo-[0-9a-f]{12}$/);
    expect(statSync(dir).isDirectory()).toBe(true);
    const plugin = JSON.parse(readFileSync(join(dir, ".claude-plugin", "plugin.json"), "utf8"));
    expect(plugin.name).toBe("demo");
    expect(plugin.version).toMatch(/^0\.0\.0\+[0-9a-f]{12}$/);
  });

  it("creates symlinks for every artifact pointing at source paths", () => {
    const tdd = mkArtifact("skills", "tdd");
    const scout = mkArtifact("agents", "scout");
    const sources: ResolvedSources = {
      ...emptySources(),
      skills: new Map([["tdd", tdd]]),
      agents: new Map([["scout", scout]]),
    };
    const dir = compile(bundle({ skills: ["tdd"], agents: ["scout"] }), sources, {
      cacheRoot,
    });
    expect(readlinkSync(join(dir, "skills", "tdd"))).toBe(tdd);
    expect(readlinkSync(join(dir, "agents", "scout"))).toBe(scout);
  });

  it("uses frontmatter `name:` (canonical) as cache dir, not the qualified-ref leaf", () => {
    // Source leaf differs from frontmatter — emulates plannotator pattern
    // (source dir `plannotator/annotate`, frontmatter `name: plannotator-annotate`).
    const dir1 = join(srcRoot, "skills", "plannotator", "annotate");
    mkdirSync(dir1, { recursive: true });
    writeFileSync(
      join(dir1, "SKILL.md"),
      "---\nname: plannotator-annotate\ndescription: x\n---\nbody\n",
    );
    const sources: ResolvedSources = {
      ...emptySources(),
      skills: new Map([["plannotator/annotate", dir1]]),
    };
    const dir = compile(bundle({ skills: ["plannotator/annotate"] }), sources, { cacheRoot });
    // Cache dir = frontmatter `name:` so CC identifies the skill correctly.
    expect(readlinkSync(join(dir, "skills", "plannotator-annotate"))).toBe(dir1);
    // The source-side leaf does NOT appear in the cache.
    expect(existsSync(join(dir, "skills", "annotate"))).toBe(false);
  });

  it("rejects unquoted YAML flow-mapping in frontmatter with actionable UsageError", () => {
    // Regression: invoi skills had descriptions like
    //   description: Use when editing code that has both `icon: 'lucide:X'` and `to: { name: 'Y' }`...
    // The `{ name: 'Y' }` is a YAML flow-mapping opener inside a plain scalar,
    // which is invalid per YAML 1.2. We want a clear error pointing at the
    // artifact and suggesting `description: >-`, not a raw parser exception.
    const dir = join(srcRoot, "skills", "invoi", "icons");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "SKILL.md"),
      "---\nname: icons\ndescription: Use when editing code that has both `icon: 'lucide:X'` and `to: { name: 'Y' }` in the same object — that combination is a whitelist surface.\n---\nbody\n",
    );
    const sources: ResolvedSources = {
      ...emptySources(),
      skills: new Map([["invoi/icons", dir]]),
    };
    let caught: unknown;
    try {
      compile(bundle({ skills: ["invoi/icons"] }), sources, { cacheRoot });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(UsageError);
    const msg = (caught as Error).message;
    expect(msg).toMatch(/skill/);
    expect(msg).toMatch(/SKILL\.md/);
    expect(msg).toMatch(/invoi\/icons|icons/);
    expect(msg).toMatch(/description: >-|block scalar/);
  });

  it("prefix-on-collision: same canonical name from two sources → both prefixed and copied", () => {
    // Two sources, both shipping a skill whose frontmatter name is `tdd`.
    const aPath = join(srcRoot, "skills", "pocock", "tdd");
    mkdirSync(aPath, { recursive: true });
    writeFileSync(join(aPath, "SKILL.md"), "---\nname: tdd\ndescription: pocock\n---\nbody-a\n");
    const bPath = join(srcRoot, "skills", "superpowers", "tdd");
    mkdirSync(bPath, { recursive: true });
    writeFileSync(
      join(bPath, "SKILL.md"),
      "---\nname: tdd\ndescription: superpowers\n---\nbody-b\n",
    );
    const sources: ResolvedSources = {
      ...emptySources(),
      skills: new Map([
        ["pocock/tdd", aPath],
        ["superpowers/tdd", bPath],
      ]),
    };
    const dir = compile(bundle({ skills: ["pocock/tdd", "superpowers/tdd"] }), sources, {
      cacheRoot,
    });
    // No bare `tdd/` — both colliding entries get source-prefixed.
    expect(existsSync(join(dir, "skills", "tdd"))).toBe(false);
    // Each colliding entry exists under its prefixed name.
    const pocockDir = join(dir, "skills", "pocock-tdd");
    const spDir = join(dir, "skills", "superpowers-tdd");
    expect(existsSync(pocockDir)).toBe(true);
    expect(existsSync(spDir)).toBe(true);
    // Collision entries are COPIES (not symlinks), because frontmatter needs rewrite.
    expect(statSync(pocockDir).isSymbolicLink?.()).toBeFalsy();
    expect(statSync(pocockDir).isDirectory()).toBe(true);
    // Rewritten frontmatter matches the prefixed dir name.
    const pocockMd = readFileSync(join(pocockDir, "SKILL.md"), "utf8");
    expect(pocockMd).toMatch(/name:\s*pocock-tdd/);
    const spMd = readFileSync(join(spDir, "SKILL.md"), "utf8");
    expect(spMd).toMatch(/name:\s*superpowers-tdd/);
    // Bodies preserved from the right source.
    expect(pocockMd).toMatch(/body-a/);
    expect(spMd).toMatch(/body-b/);
  });

  it("no collision when canonical names differ: both stay symlinked under their canonical", () => {
    const a = join(srcRoot, "skills", "pocock", "tdd");
    mkdirSync(a, { recursive: true });
    writeFileSync(join(a, "SKILL.md"), "---\nname: tdd\n---\nbody\n");
    const b = join(srcRoot, "skills", "pocock", "caveman");
    mkdirSync(b, { recursive: true });
    writeFileSync(join(b, "SKILL.md"), "---\nname: caveman\n---\nbody\n");
    const sources: ResolvedSources = {
      ...emptySources(),
      skills: new Map([
        ["pocock/tdd", a],
        ["pocock/caveman", b],
      ]),
    };
    const dir = compile(bundle({ skills: ["pocock/tdd", "pocock/caveman"] }), sources, {
      cacheRoot,
    });
    // Bare canonical names — both symlinks (no prefix, no copy).
    expect(readlinkSync(join(dir, "skills", "tdd"))).toBe(a);
    expect(readlinkSync(join(dir, "skills", "caveman"))).toBe(b);
  });

  it("writes .mcp.json + copies sidecars from named mcp artifacts", () => {
    const mcpDir = join(srcRoot, "mcps", "local", "duckdb");
    mkdirSync(mcpDir, { recursive: true });
    writeFileSync(
      join(mcpDir, "MCP.md"),
      "---\nname: duckdb\ncommand: ./run.sh\nargs: [--db, x]\nenv:\n  DUCKDB_PATH: /tmp/x\n---\nbody\n",
    );
    writeFileSync(join(mcpDir, "run.sh"), "#!/bin/sh\necho hi\n");
    const sources: ResolvedSources = {
      ...emptySources(),
      mcps: new Map([["local/duckdb", mcpDir]]),
    };
    const dir = compile(bundle({ mcps: ["local/duckdb"] }), sources, { cacheRoot });
    const mcp = JSON.parse(readFileSync(join(dir, ".mcp.json"), "utf8"));
    // Absolute cache path, NOT ${CLAUDE_PLUGIN_ROOT}: .mcp.json loads via
    // --mcp-config, where CC does not substitute the plugin-root variable.
    expect(mcp.mcpServers.duckdb.command).toBe(join(dir, "mcps", "duckdb", "run.sh"));
    expect(mcp.mcpServers.duckdb.args).toEqual(["--db", "x"]);
    expect(mcp.mcpServers.duckdb.env).toEqual({ DUCKDB_PATH: "/tmp/x" });
    expect(existsSync(join(dir, "mcps", "duckdb", "run.sh"))).toBe(true);
  });

  it("mcp canonical name = MCP.md frontmatter `name:` (defaults to leaf when absent)", () => {
    const mcpDir = join(srcRoot, "mcps", "vendor", "plain");
    mkdirSync(mcpDir, { recursive: true });
    writeFileSync(join(mcpDir, "MCP.md"), "---\ncommand: some-bin\n---\n");
    const sources: ResolvedSources = {
      ...emptySources(),
      mcps: new Map([["vendor/plain", mcpDir]]),
    };
    const dir = compile(bundle({ mcps: ["vendor/plain"] }), sources, { cacheRoot });
    const mcp = JSON.parse(readFileSync(join(dir, ".mcp.json"), "utf8"));
    // No frontmatter `name:` — leaf used as canonical.
    expect(mcp.mcpServers.plain.command).toBe("some-bin");
  });

  it("prefix-on-collision: same canonical name from two sources → both prefixed under mcps/", () => {
    const a = join(srcRoot, "mcps", "local", "pg");
    mkdirSync(a, { recursive: true });
    writeFileSync(join(a, "MCP.md"), "---\nname: pg\ncommand: pg-a\n---\n");
    const b = join(srcRoot, "mcps", "anthropic", "pg");
    mkdirSync(b, { recursive: true });
    writeFileSync(join(b, "MCP.md"), "---\nname: pg\ncommand: pg-b\n---\n");
    const sources: ResolvedSources = {
      ...emptySources(),
      mcps: new Map([
        ["local/pg", a],
        ["anthropic/pg", b],
      ]),
    };
    const dir = compile(bundle({ mcps: ["local/pg", "anthropic/pg"] }), sources, { cacheRoot });
    const mcp = JSON.parse(readFileSync(join(dir, ".mcp.json"), "utf8"));
    expect(Object.keys(mcp.mcpServers).sort()).toEqual(["anthropic-pg", "local-pg"]);
    expect(existsSync(join(dir, "mcps", "local-pg", "MCP.md"))).toBe(true);
    expect(existsSync(join(dir, "mcps", "anthropic-pg", "MCP.md"))).toBe(true);
    // No bare canonical dir.
    expect(existsSync(join(dir, "mcps", "pg"))).toBe(false);
  });

  it("rejects mcp artifact whose MCP.md lacks 'command'", () => {
    const mcpDir = join(srcRoot, "mcps", "local", "broken");
    mkdirSync(mcpDir, { recursive: true });
    writeFileSync(join(mcpDir, "MCP.md"), "---\nname: broken\n---\n");
    const sources: ResolvedSources = {
      ...emptySources(),
      mcps: new Map([["local/broken", mcpDir]]),
    };
    expect(() => compile(bundle({ mcps: ["local/broken"] }), sources, { cacheRoot })).toThrow(
      /mcp.*broken.*command/i,
    );
  });

  it("does not emit .mcp.json when no mcps declared", () => {
    const dir = compile(bundle({}), emptySources(), { cacheRoot });
    expect(existsSync(join(dir, ".mcp.json"))).toBe(false);
  });

  it("writes settings.json for settings: and hooks/hooks.json for named hooks", () => {
    // Create a hook artifact and resolve it into sources for the compile.
    const hookDir = join(srcRoot, "hooks", "base", "preflight");
    mkdirSync(hookDir, { recursive: true });
    writeFileSync(
      join(hookDir, "HOOK.md"),
      "---\nname: preflight\nevent: PreToolUse\nmatcher: Bash\ncommand: ./x.sh\n---\nbody\n",
    );
    writeFileSync(join(hookDir, "x.sh"), "#!/bin/sh\necho hi\n");
    const sources: ResolvedSources = {
      ...emptySources(),
      hooks: new Map([["base/preflight", hookDir]]),
    };
    const dir = compile(
      bundle({
        settings: { model: "claude-opus-4-7", env: { FOO: "bar" } },
        hooks: ["base/preflight"],
      }),
      sources,
      { cacheRoot },
    );
    const s = JSON.parse(readFileSync(join(dir, "settings.json"), "utf8"));
    expect(s.model).toBe("claude-opus-4-7");
    expect(s.env).toEqual({ FOO: "bar" });
    // Hooks do NOT live in settings.json — CC won't resolve ${CLAUDE_PLUGIN_ROOT}
    // there. They land in the plugin's hooks/hooks.json (top-level `hooks` key).
    expect(s.hooks).toBeUndefined();
    const h = JSON.parse(readFileSync(join(dir, "hooks", "hooks.json"), "utf8"));
    expect(h.hooks.PreToolUse).toHaveLength(1);
    expect(h.hooks.PreToolUse[0].matcher).toBe("Bash");
    // Relative command rewritten to ${CLAUDE_PLUGIN_ROOT}-anchored path.
    expect(h.hooks.PreToolUse[0].hooks[0].command).toBe(
      "${CLAUDE_PLUGIN_ROOT}/hooks/preflight/x.sh",
    );
    // Sidecar script copied into cache.
    expect(existsSync(join(dir, "hooks", "preflight", "x.sh"))).toBe(true);
  });

  it("emits hooks/hooks.json but no settings.json for a hooks-only bundle", () => {
    const hookDir = join(srcRoot, "hooks", "base", "only");
    mkdirSync(hookDir, { recursive: true });
    writeFileSync(
      join(hookDir, "HOOK.md"),
      "---\nname: only\nevent: SessionStart\nmatcher: startup\ncommand: ./s.sh\n---\n",
    );
    writeFileSync(join(hookDir, "s.sh"), "#!/bin/sh\n");
    const sources: ResolvedSources = {
      ...emptySources(),
      hooks: new Map([["base/only", hookDir]]),
    };
    const dir = compile(bundle({ hooks: ["base/only"] }), sources, { cacheRoot });
    expect(() => readFileSync(join(dir, "settings.json"))).toThrow();
    const h = JSON.parse(readFileSync(join(dir, "hooks", "hooks.json"), "utf8"));
    expect(h.hooks.SessionStart[0].hooks[0].command).toBe("${CLAUDE_PLUGIN_ROOT}/hooks/only/s.sh");
  });

  it("does not write settings.json when no settings/hooks", () => {
    const dir = compile(bundle({}), emptySources(), { cacheRoot });
    expect(() => readFileSync(join(dir, "settings.json"))).toThrow();
  });

  it("idempotent: second compile of same input reuses dir", () => {
    const a = compile(bundle({ name: "x" }), emptySources(), { cacheRoot });
    const aMtime = statSync(a).mtimeMs;
    const b = compile(bundle({ name: "x" }), emptySources(), { cacheRoot });
    expect(b).toBe(a);
    expect(statSync(b).mtimeMs).toBe(aMtime);
  });

  it("onBuild fires on a cache miss but not on a subsequent cache hit", () => {
    let calls = 0;
    const onBuild = () => {
      calls++;
    };
    compile(bundle({ name: "notify" }), emptySources(), { cacheRoot, onBuild });
    expect(calls).toBe(1);
    // Second compile of identical input is a cache hit — no rebuild, no notice.
    compile(bundle({ name: "notify" }), emptySources(), { cacheRoot, onBuild });
    expect(calls).toBe(1);
    // forceRebuild counts as a build → fires again.
    compile(bundle({ name: "notify" }), emptySources(), {
      cacheRoot,
      forceRebuild: true,
      onBuild,
    });
    expect(calls).toBe(2);
  });

  it("forceRebuild: replaces existing cache dir", () => {
    const a = compile(bundle({ name: "x" }), emptySources(), { cacheRoot });
    // Mark with custom file to detect replacement
    writeFileSync(join(a, "marker"), "old");
    const b = compile(bundle({ name: "x" }), emptySources(), { cacheRoot, forceRebuild: true });
    expect(b).toBe(a);
    expect(() => readFileSync(join(b, "marker"))).toThrow();
  });

  it("clears stale .partial dir on retry", () => {
    const hash = "x";
    // Simulate previous failed build
    const finalDir = join(cacheRoot, "bundles", `demo-${hash}`);
    mkdirSync(`${finalDir}.partial`, { recursive: true });
    writeFileSync(join(`${finalDir}.partial`, "junk"), "x");
    const dir = compile(bundle({ name: "demo" }), emptySources(), { cacheRoot });
    // Compile produced the real hash dir; the .partial sibling should be gone.
    expect(existsSync(`${dir}.partial`)).toBe(false);
  });

  it("parallel compile of same hash: both return same path", async () => {
    const tdd = mkArtifact("skills", "tdd");
    const sources: ResolvedSources = {
      ...emptySources(),
      skills: new Map([["tdd", tdd]]),
    };
    const work = () => compile(bundle({ skills: ["tdd"] }), sources, { cacheRoot });
    const [a, b] = await Promise.all([Promise.resolve(work()), Promise.resolve(work())]);
    expect(a).toBe(b);
    expect(statSync(a).isDirectory()).toBe(true);
  });

  it("GC keeps only the newest 3 cache dirs per name (default)", () => {
    // Compile 5 distinct variants; expect only 3 to remain.
    const variants = [1, 2, 3, 4, 5].map((i) =>
      compile(bundle({ name: "gc-test", description: `v${i}` }), emptySources(), {
        cacheRoot,
      }),
    );
    const remaining = variants.filter((p) => existsSync(p));
    expect(remaining.length).toBe(3);
  });

  describe("bundle.md", () => {
    it("writes a self-describing bundle.md with frontmatter + invocation", () => {
      const dir = compile(bundle({ name: "doc-demo", description: "tester" }), emptySources(), {
        cacheRoot,
      });
      const md = readFileSync(join(dir, "bundle.md"), "utf8");
      expect(md).toMatch(/^---\n/);
      expect(md).toMatch(/\nname: doc-demo\n/);
      expect(md).toMatch(/\nhash: [0-9a-f]{12}\n/);
      expect(md).toMatch(/\ndescription: tester\n/);
      expect(md).toMatch(/\n## Invocation\n\n```bash\n/);
      expect(md).toMatch(/--plugin-dir [^\n]+doc-demo-[0-9a-f]{12}/);
    });

    it("invocation block omits --settings for a hooks-only bundle (hooks load via the plugin dir)", () => {
      const hookDir = join(srcRoot, "hooks", "base", "h");
      mkdirSync(hookDir, { recursive: true });
      writeFileSync(
        join(hookDir, "HOOK.md"),
        "---\nname: h\nevent: PreToolUse\nmatcher: Bash\ncommand: ./x.sh\n---\n",
      );
      const sources: ResolvedSources = {
        ...emptySources(),
        hooks: new Map([["base/h", hookDir]]),
      };
      const dir = compile(bundle({ hooks: ["base/h"] }), sources, { cacheRoot });
      const md = readFileSync(join(dir, "bundle.md"), "utf8");
      expect(md).not.toContain("--settings");
      // Hook is compiled into the plugin's hooks/hooks.json instead.
      expect(existsSync(join(dir, "hooks", "hooks.json"))).toBe(true);
    });

    it("invocation block includes --mcp-config + --strict-mcp-config (default mergeMcp)", () => {
      const mcpDir = join(srcRoot, "mcps", "local", "x");
      mkdirSync(mcpDir, { recursive: true });
      writeFileSync(join(mcpDir, "MCP.md"), "---\nname: x\ncommand: x-bin\n---\n");
      const sources: ResolvedSources = {
        ...emptySources(),
        mcps: new Map([["local/x", mcpDir]]),
      };
      const dir = compile(bundle({ mcps: ["local/x"] }), sources, { cacheRoot });
      const md = readFileSync(join(dir, "bundle.md"), "utf8");
      expect(md).toContain("--mcp-config");
      expect(md).toContain("--strict-mcp-config");
    });

    it("invocation block omits --strict-mcp-config when mergeMcp is true", () => {
      const mcpDir = join(srcRoot, "mcps", "local", "y");
      mkdirSync(mcpDir, { recursive: true });
      writeFileSync(join(mcpDir, "MCP.md"), "---\nname: y\ncommand: y-bin\n---\n");
      const sources: ResolvedSources = {
        ...emptySources(),
        mcps: new Map([["local/y", mcpDir]]),
      };
      const dir = compile(bundle({ mcps: ["local/y"], mergeMcp: true }), sources, { cacheRoot });
      const md = readFileSync(join(dir, "bundle.md"), "utf8");
      expect(md).toContain("--mcp-config");
      expect(md).not.toContain("--strict-mcp-config");
    });

    it("includes verbatim body from the source bundle.md", () => {
      const dir = compile(
        bundle({ body: "# Heading\n\nSome notes about the bundle." }),
        emptySources(),
        { cacheRoot },
      );
      const md = readFileSync(join(dir, "bundle.md"), "utf8");
      expect(md).toContain("# Heading");
      expect(md).toContain("Some notes about the bundle.");
    });

    it("frontmatter omits the `extends:` field (already resolved)", () => {
      // ResolvedBundle type drops extends already; this is a contract reminder.
      const dir = compile(bundle({ name: "no-extends" }), emptySources(), { cacheRoot });
      const md = readFileSync(join(dir, "bundle.md"), "utf8");
      expect(md).not.toMatch(/\nextends:/);
    });

    it("Invocation block embeds the final path, not the `.partial` staging name", () => {
      // Regression: bk-2026-05-19T08:55:00Z. writeBundleMd used to render
      // the partial dir path which then survived the atomic rename.
      const dir = compile(bundle({ name: "partial-check" }), emptySources(), { cacheRoot });
      const md = readFileSync(join(dir, "bundle.md"), "utf8");
      expect(md).not.toMatch(/\.partial/);
      expect(md).toMatch(new RegExp(`--plugin-dir ${dir.replace(/\//g, "\\/")}`));
    });
  });

  describe("by-name symlink", () => {
    it("creates bundles/by-name/<name> pointing at the new hash dir", () => {
      const dir = compile(bundle({ name: "ln-demo" }), emptySources(), { cacheRoot });
      const link = join(cacheRoot, "bundles", "by-name", "ln-demo");
      expect(lstatSync(link).isSymbolicLink()).toBe(true);
      // relative target = "../<hashdir-basename>"
      const rel = readlinkSync(link);
      expect(rel).toBe(`../${pathBasename(dir)}`);
    });

    it("re-points the symlink atomically on subsequent build of a different variant", () => {
      const a = compile(bundle({ name: "ln-bump", description: "v1" }), emptySources(), {
        cacheRoot,
      });
      const b = compile(bundle({ name: "ln-bump", description: "v2" }), emptySources(), {
        cacheRoot,
      });
      expect(a).not.toBe(b);
      const link = join(cacheRoot, "bundles", "by-name", "ln-bump");
      expect(readlinkSync(link)).toBe(`../${pathBasename(b)}`);
    });

    it("refreshes the symlink on cache hit too (so apply tracks intent)", () => {
      const a = compile(bundle({ name: "ln-hit", description: "v1" }), emptySources(), {
        cacheRoot,
      });
      const b = compile(bundle({ name: "ln-hit", description: "v2" }), emptySources(), {
        cacheRoot,
      });
      // Re-compile v1 — same hash as a, cache hit. Symlink must move back to a.
      compile(bundle({ name: "ln-hit", description: "v1" }), emptySources(), {
        cacheRoot,
      });
      const link = join(cacheRoot, "bundles", "by-name", "ln-hit");
      expect(readlinkSync(link)).toBe(`../${pathBasename(a)}`);
      // sanity: b still exists, just not the symlink target
      expect(statSync(b).isDirectory()).toBe(true);
    });
  });

  describe("GC preserves by-name target", () => {
    it("keeps the hash dir pointed-to by by-name even when ranked below keep=N", () => {
      // Build 3 distinct variants with keep=3 so all survive.
      const v1 = compile(bundle({ name: "keepy", description: "v1" }), emptySources(), {
        cacheRoot,
        keepCache: 3,
      });
      compile(bundle({ name: "keepy", description: "v2" }), emptySources(), {
        cacheRoot,
        keepCache: 3,
      });
      const v3 = compile(bundle({ name: "keepy", description: "v3" }), emptySources(), {
        cacheRoot,
        keepCache: 3,
      });
      // Re-point symlink at v1 (the oldest by mtime).
      const link = join(cacheRoot, "bundles", "by-name", "keepy");
      unlinkSync(link);
      symlinkSync(`../${pathBasename(v1)}`, link);
      // Run GC directly with keep=1. Newest by mtime is v3, would normally be the
      // only survivor. v1 must survive because the symlink protects it.
      gcBundles(cacheRoot, "keepy", 1);
      expect(existsSync(v1)).toBe(true);
      expect(existsSync(v3)).toBe(true); // newest by mtime, also kept
    });

    it("does nothing special when the symlink is absent", () => {
      const v1 = compile(bundle({ name: "noln", description: "v1" }), emptySources(), {
        cacheRoot,
        keepCache: 3,
      });
      const v2 = compile(bundle({ name: "noln", description: "v2" }), emptySources(), {
        cacheRoot,
        keepCache: 3,
      });
      // Delete the symlink, then GC with keep=1 — v1 should be dropped (no protection).
      unlinkSync(join(cacheRoot, "bundles", "by-name", "noln"));
      gcBundles(cacheRoot, "noln", 1);
      expect(existsSync(v1)).toBe(false);
      expect(existsSync(v2)).toBe(true);
    });
  });
});

import { existsSync, lstatSync, symlinkSync, unlinkSync } from "node:fs";
