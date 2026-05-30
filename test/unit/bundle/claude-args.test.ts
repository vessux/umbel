import { describe, expect, it } from "vitest";
import { computeClaudeArgs, formatClaudeInvocation } from "../../../src/bundle/claude-args.ts";
import type { ResolvedBundle } from "../../../src/bundle/compose.ts";

function bundle(partial: Partial<ResolvedBundle>): ResolvedBundle {
  return { name: "demo", sourcePath: "/x", body: "", ...partial };
}

describe("computeClaudeArgs", () => {
  const cache = "/abs/cache";

  it("plugin-dir only when bundle has no settings/hooks/mcp", () => {
    expect(computeClaudeArgs(bundle({}), cache)).toEqual(["--plugin-dir", cache]);
  });

  it("adds --settings when bundle declares settings", () => {
    const args = computeClaudeArgs(bundle({ settings: { model: "claude-opus-4-7" } }), cache);
    expect(args).toEqual(["--plugin-dir", cache, "--settings", `${cache}/settings.json`]);
  });

  it("does not add --settings for a hooks-only bundle (hooks load via the plugin dir)", () => {
    const args = computeClaudeArgs(bundle({ hooks: ["base/preflight"] }), cache);
    expect(args).toEqual(["--plugin-dir", cache]);
  });

  it("adds --mcp-config + --strict-mcp-config when bundle has mcps (default mergeMcp)", () => {
    const args = computeClaudeArgs(bundle({ mcps: ["local/duckdb"] }), cache);
    expect(args).toEqual([
      "--plugin-dir",
      cache,
      "--mcp-config",
      `${cache}/.mcp.json`,
      "--strict-mcp-config",
    ]);
  });

  it("omits --strict-mcp-config when mergeMcp is true", () => {
    const args = computeClaudeArgs(bundle({ mcps: ["local/duckdb"], mergeMcp: true }), cache);
    expect(args).not.toContain("--strict-mcp-config");
    expect(args).toContain("--mcp-config");
  });

  it("treats empty settings/hooks/mcps as absent", () => {
    const args = computeClaudeArgs(bundle({ settings: {}, hooks: [], mcps: [] }), cache);
    expect(args).toEqual(["--plugin-dir", cache]);
  });
});

// Opt-in isolation (`isolate: true`).
//
// `umbel run <bundle>` launches `claude --plugin-dir <cache>`. In Claude Code
// 2.1.x `--plugin-dir` ADDS the bundle plugin on top of normal discovery — it
// does NOT suppress the user's globally-enabled plugins (`enabledPlugins` in
// ~/.claude/settings.json) nor ~/.claude/skills. So those skills leak into a
// bundle session. `isolate: true` opts a bundle into `--bare`, the documented
// lever that loads ONLY the --plugin-dir plugin (and its own skills/agents).
// Isolation is opt-in to preserve today's additive default behaviour.
describe("computeClaudeArgs — opt-in isolation (isolate: true)", () => {
  const cache = "/abs/cache";

  const isolatesUserPlugins = (args: string[]): boolean => {
    if (args.includes("--bare")) return true;
    const i = args.indexOf("--setting-sources");
    if (i === -1) return false;
    const sources = (args[i + 1] ?? "").split(",").map((s) => s.trim());
    return sources.length > 0 && !sources.includes("user");
  };

  it("does NOT isolate by default — additive behaviour preserved", () => {
    const args = computeClaudeArgs(bundle({ skills: ["superpowers/brainstorming"] }), cache);
    expect(isolatesUserPlugins(args)).toBe(false);
    expect(args).toEqual(["--plugin-dir", cache]);
  });

  it("isolate: true drops the user's globally-enabled plugins", () => {
    const args = computeClaudeArgs(
      bundle({ skills: ["superpowers/brainstorming"], isolate: true }),
      cache,
    );
    expect(isolatesUserPlugins(args)).toBe(true);
    expect(args).toContain("--plugin-dir");
    expect(args).toContain(cache);
  });

  it("isolate keeps the bundle's own settings flowing (still passes --settings)", () => {
    const args = computeClaudeArgs(
      bundle({ skills: ["local/tdd"], isolate: true, settings: { model: "claude-opus-4-7" } }),
      cache,
    );
    expect(isolatesUserPlugins(args)).toBe(true);
    expect(args).toContain("--settings");
    expect(args).toContain(`${cache}/settings.json`);
  });

  it("isolate: false behaves like the default (no isolation)", () => {
    const args = computeClaudeArgs(bundle({ skills: ["local/tdd"], isolate: false }), cache);
    expect(isolatesUserPlugins(args)).toBe(false);
  });
});

describe("formatClaudeInvocation", () => {
  it("renders a flag-only argv as backslash-continued bash", () => {
    const out = formatClaudeInvocation(["--plugin-dir", "/abs"]);
    expect(out).toBe("claude \\\n  --plugin-dir /abs");
  });

  it("keeps flag+value pairs on one line, no trailing slash on last line", () => {
    const out = formatClaudeInvocation([
      "--plugin-dir",
      "/abs",
      "--settings",
      "/abs/settings.json",
      "--strict-mcp-config",
    ]);
    expect(out).toBe(
      [
        "claude \\",
        "  --plugin-dir /abs \\",
        "  --settings /abs/settings.json \\",
        "  --strict-mcp-config",
      ].join("\n"),
    );
  });

  it("handles a lone valueless flag at the end", () => {
    const out = formatClaudeInvocation([
      "--plugin-dir",
      "/abs",
      "--mcp-config",
      "/abs/.mcp.json",
      "--strict-mcp-config",
    ]);
    expect(out.endsWith("--strict-mcp-config")).toBe(true);
    expect(out.split("\n").pop()).toBe("  --strict-mcp-config");
  });
});
