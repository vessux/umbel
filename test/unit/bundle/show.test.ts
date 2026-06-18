import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ResolvedBundle } from "../../../src/bundle/compose.ts";
import type { ResolvedSources } from "../../../src/bundle/resolve.ts";
import { renderShow } from "../../../src/bundle/show.ts";
import { cleanup, makeTmpDir } from "../../helpers/tmp.ts";

function bundle(partial: Partial<ResolvedBundle>): ResolvedBundle {
  return {
    name: "test",
    sourcePath: "/x",
    body: "",
    ...partial,
  };
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

function mkMcpArtifact(root: string, source: string, leaf: string, frontmatter: string): string {
  const dir = join(root, "mcps", source, leaf);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "MCP.md"), `---\n${frontmatter}---\n`);
  return dir;
}

describe("renderShow", () => {
  let root: string;

  beforeEach(() => {
    root = makeTmpDir();
  });
  afterEach(() => {
    cleanup(root);
  });

  it("includes a 'manifest' section with canonical YAML of the resolved bundle", () => {
    const out = renderShow(bundle({ name: "x", description: "hi" }), emptySources(), {});
    expect(out).toMatch(/manifest/i);
    expect(out).toContain("name: x");
    expect(out).toContain("description: hi");
  });

  it("'sources' section lists each artifact name → absolute path", () => {
    const sources: ResolvedSources = {
      ...emptySources(),
      skills: new Map([
        ["tdd", "/abs/skills/tdd"],
        ["review", "/abs/skills/review"],
      ]),
      agents: new Map([["scout", "/abs/agents/scout"]]),
    };
    const out = renderShow(bundle({ skills: ["tdd", "review"], agents: ["scout"] }), sources, {});
    expect(out).toContain("- tdd: /abs/skills/tdd");
    expect(out).toContain("- review: /abs/skills/review");
    expect(out).toContain("- scout: /abs/agents/scout");
  });

  it("flags missing source paths with '(missing)'", () => {
    const sources: ResolvedSources = {
      ...emptySources(),
      skills: new Map([["tdd", "/abs/skills/tdd"]]),
    };
    const out = renderShow(bundle({ skills: ["tdd", "ghost"] }), sources, {});
    expect(out).toContain("- ghost: (missing)");
  });

  it("MCP diff: project-only / bundle-only / shared lists computed correctly", () => {
    const projectMcpPath = join(root, ".mcp.json");
    writeFileSync(
      projectMcpPath,
      JSON.stringify({
        mcpServers: {
          shared: { command: "x" },
          projonly: { command: "y" },
        },
      }),
    );
    const sharedDir = mkMcpArtifact(root, "local", "shared", "name: shared\ncommand: z\n");
    const bundleOnlyDir = mkMcpArtifact(
      root,
      "local",
      "bundleonly",
      "name: bundleonly\ncommand: q\n",
    );
    const out = renderShow(
      bundle({ mcps: ["local/shared", "local/bundleonly"] }),
      {
        ...emptySources(),
        mcps: new Map([
          ["local/shared", sharedDir],
          ["local/bundleonly", bundleOnlyDir],
        ]),
      },
      { projectMcpPath },
    );
    expect(out).toContain("project-only (will be hidden): projonly");
    expect(out).toContain("bundle-only (added): bundleonly");
    expect(out).toContain("shared (bundle wins): shared");
  });

  it("'mergeMcp: true' suppresses the diff and prints a merge note", () => {
    const out = renderShow(bundle({ mergeMcp: true, mcps: ["local/foo"] }), emptySources(), {});
    expect(out).toMatch(/merge mode/i);
    expect(out).not.toMatch(/project-only/);
    expect(out).not.toMatch(/strict mode/);
  });

  it("missing project .mcp.json shows '(none)'", () => {
    const fooDir = mkMcpArtifact(root, "local", "foo", "name: foo\ncommand: x\n");
    const out = renderShow(
      bundle({ mcps: ["local/foo"] }),
      {
        ...emptySources(),
        mcps: new Map([["local/foo", fooDir]]),
      },
      { projectMcpPath: join(root, "absent.json") },
    );
    expect(out).toContain("project: (none)");
  });

  it("surfaces resolution warnings as a 'warnings' section", () => {
    const sources: ResolvedSources = {
      ...emptySources(),
      warnings: ["bundle 'x': skill 'tdd' is also defined in project ..."],
    };
    const out = renderShow(bundle({ skills: ["tdd"] }), sources, {});
    expect(out).toMatch(/warnings/i);
    expect(out).toContain("- bundle 'x'");
  });

  it("includes manifest-level warnings in the ## warnings section", () => {
    const out = renderShow(bundle({ name: "demo" }), emptySources(), {
      warnings: ["bundle /x/demo.md: unknown field 'bogusKey' (ignored)"],
    });
    expect(out).toContain("## warnings");
    expect(out).toContain("unknown field 'bogusKey'");
  });

  it("de-duplicates warnings shared between sources and manifest", () => {
    const sources = emptySources();
    sources.warnings = ["dup warning"];
    const out = renderShow(bundle({ name: "demo" }), sources, { warnings: ["dup warning"] });
    expect(out.match(/dup warning/g)?.length).toBe(1);
  });
});
