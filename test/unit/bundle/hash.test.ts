import { mkdirSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ResolvedBundle } from "../../../src/bundle/compose.ts";
import { hashBundle } from "../../../src/bundle/hash.ts";
import type { ResolvedSources } from "../../../src/bundle/resolve.ts";
import { cleanup, makeTmpDir } from "../../helpers/tmp.ts";

function bundle(partial: Partial<ResolvedBundle>): ResolvedBundle {
  return { name: "x", sourcePath: "/x", body: "", ...partial };
}

function srcs(skills: Record<string, string> = {}): ResolvedSources {
  return {
    skills: new Map(Object.entries(skills)),
    agents: new Map(),
    hooks: new Map(),
    mcps: new Map(),
    warnings: [],
  };
}

describe("hashBundle", () => {
  let root: string;
  beforeEach(() => {
    root = makeTmpDir();
  });
  afterEach(() => {
    cleanup(root);
  });

  function mkdir(name: string): string {
    const p = join(root, name);
    mkdirSync(p, { recursive: true });
    return p;
  }

  it("returns a 12-character hex string", () => {
    const h = hashBundle(bundle({ name: "x" }), srcs());
    expect(h).toMatch(/^[0-9a-f]{12}$/);
  });

  it("is stable across calls with identical inputs", () => {
    const path = mkdir("tdd");
    const a = hashBundle(bundle({ skills: ["tdd"] }), srcs({ tdd: path }));
    const b = hashBundle(bundle({ skills: ["tdd"] }), srcs({ tdd: path }));
    expect(a).toBe(b);
  });

  it("changes when the resolved manifest changes", () => {
    const a = hashBundle(bundle({ description: "old" }), srcs());
    const b = hashBundle(bundle({ description: "new" }), srcs());
    expect(a).not.toBe(b);
  });

  it("changes when adding a skill (resolved manifest broadens)", () => {
    const path = mkdir("tdd");
    const a = hashBundle(bundle({ skills: ["tdd"] }), srcs({ tdd: path }));
    const b = hashBundle(bundle({ skills: ["tdd", "review"] }), srcs({ tdd: path }));
    expect(a).not.toBe(b);
  });

  it("changes when source dir mtime advances", () => {
    const path = mkdir("tdd");
    const a = hashBundle(bundle({ skills: ["tdd"] }), srcs({ tdd: path }));
    // bump mtime forward by 5s
    const future = Date.now() / 1000 + 5;
    utimesSync(path, future, future);
    const b = hashBundle(bundle({ skills: ["tdd"] }), srcs({ tdd: path }));
    expect(a).not.toBe(b);
  });

  it("changes when a hook source dir mtime advances", () => {
    const hookDir = mkdir("hook");
    const sources: ResolvedSources = {
      skills: new Map(),
      agents: new Map(),
      hooks: new Map([["base/hook", hookDir]]),
      mcps: new Map(),
      warnings: [],
    };
    const a = hashBundle(bundle({ hooks: ["base/hook"] }), sources);
    const future = Date.now() / 1000 + 5;
    utimesSync(hookDir, future, future);
    const b = hashBundle(bundle({ hooks: ["base/hook"] }), sources);
    expect(a).not.toBe(b);
  });

  it("changes when an mcp source dir mtime advances", () => {
    const mcpDir = mkdir("mcp");
    const sources: ResolvedSources = {
      skills: new Map(),
      agents: new Map(),
      hooks: new Map(),
      mcps: new Map([["local/duckdb", mcpDir]]),
      warnings: [],
    };
    const a = hashBundle(bundle({ mcps: ["local/duckdb"] }), sources);
    const future = Date.now() / 1000 + 5;
    utimesSync(mcpDir, future, future);
    const b = hashBundle(bundle({ mcps: ["local/duckdb"] }), sources);
    expect(a).not.toBe(b);
  });

  it("ignores sourcePath/body — they are non-semantic for runtime", () => {
    const a = hashBundle(bundle({ name: "x", sourcePath: "/a", body: "hi" }), srcs());
    const b = hashBundle(bundle({ name: "x", sourcePath: "/b", body: "bye" }), srcs());
    expect(a).toBe(b);
  });

  it("store-pinned artifacts hash on commit+contentHash, not path or mtime", () => {
    // Two ResolvedSources pointing at DIFFERENT absolute paths but the SAME pin
    // must produce the same bundle hash (same lock → same bundle, any machine).
    const mk = (dir: string): ResolvedSources => {
      mkdirSync(dir, { recursive: true });
      const s: ResolvedSources = {
        skills: new Map([["tools/greet", dir]]),
        agents: new Map(),
        hooks: new Map(),
        mcps: new Map(),
        warnings: [],
        storePins: new Map([
          ["skills/tools/greet", { commit: "c".repeat(40), contentHash: "d".repeat(64) }],
        ]),
      };
      return s;
    };
    const b = bundle({ skills: ["tools/greet"] });
    expect(hashBundle(b, mk(join(root, "machine-a/store/x")))).toBe(
      hashBundle(b, mk(join(root, "machine-b/store/y"))),
    );
  });

  it("store pin change changes the hash", () => {
    const mk = (hash: string): ResolvedSources => ({
      skills: new Map([["tools/greet", join(root, "same")]]),
      agents: new Map(),
      hooks: new Map(),
      mcps: new Map(),
      warnings: [],
      storePins: new Map([["skills/tools/greet", { commit: "c".repeat(40), contentHash: hash }]]),
    });
    const b = bundle({ skills: ["tools/greet"] });
    expect(hashBundle(b, mk("1".repeat(64)))).not.toBe(hashBundle(b, mk("2".repeat(64))));
  });
});
