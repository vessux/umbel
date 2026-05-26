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

  it("adds --settings when bundle declares hooks (no explicit settings)", () => {
    const args = computeClaudeArgs(bundle({ hooks: ["base/preflight"] }), cache);
    expect(args).toContain("--settings");
    expect(args).toContain(`${cache}/settings.json`);
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
