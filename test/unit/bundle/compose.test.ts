import { describe, expect, it } from "vitest";
import { compose } from "../../../src/bundle/compose.ts";
import type { BundleManifest } from "../../../src/bundle/manifest.ts";

function m(name: string, partial: Partial<BundleManifest> = {}): BundleManifest {
  return { name, sourcePath: `/x/${name}.md`, body: "", ...partial };
}

function index(...mans: BundleManifest[]): Map<string, BundleManifest> {
  return new Map(mans.map((x) => [x.name, x]));
}

describe("compose", () => {
  it("returns the bundle as-is when extends is absent", () => {
    const ix = index(m("base", { skills: ["a", "b"] }));
    const r = compose("base", ix) as ResolvedBundle & { extends?: unknown };
    expect(r.name).toBe("base");
    expect(r.skills).toEqual(["a", "b"]);
    expect(r.extends).toBeUndefined();
  });

  it("concats skill list from parent then child", () => {
    const ix = index(
      m("base", { skills: ["a", "b"] }),
      m("child", { extends: ["base"], skills: ["c"] }),
    );
    const r = compose("child", ix);
    expect(r.skills).toEqual(["a", "b", "c"]);
  });

  it("dedupes list entries with child winning", () => {
    const ix = index(
      m("base", { skills: ["a", "b"] }),
      m("child", { extends: ["base"], skills: ["b", "c"] }),
    );
    const r = compose("child", ix);
    expect(r.skills).toEqual(["a", "b", "c"]);
  });

  it("scalars from child overwrite parent", () => {
    const ix = index(
      m("base", { description: "parent desc", mergeMcp: true }),
      m("child", { extends: ["base"], description: "child desc" }),
    );
    const r = compose("child", ix);
    expect(r.description).toBe("child desc");
    expect(r.mergeMcp).toBe(true);
  });

  it("deep-merges settings env across parent + child", () => {
    const ix = index(
      m("base", { settings: { model: "old", env: { A: "1" } } }),
      m("child", { extends: ["base"], settings: { model: "new", env: { B: "2" } } }),
    );
    const r = compose("child", ix);
    expect(r.settings).toEqual({
      model: "new",
      env: { A: "1", B: "2" },
    });
  });

  it("hooks list concat + dedupe by qualified ref", () => {
    const ix = index(
      m("base", { hooks: ["base/preflight", "base/log-bash"] }),
      m("child", {
        extends: ["base"],
        hooks: ["base/log-bash", "ci/checkpoint"],
      }),
    );
    const r = compose("child", ix);
    // base contributes [preflight, log-bash]; child adds [log-bash (dedupe), checkpoint].
    expect(r.hooks).toEqual(["base/preflight", "base/log-bash", "ci/checkpoint"]);
  });

  it("mcps list concat + dedupe by qualified ref", () => {
    const ix = index(
      m("base", { mcps: ["local/duckdb", "anthropic/playwright"] }),
      m("child", {
        extends: ["base"],
        mcps: ["anthropic/playwright", "local/redis"],
      }),
    );
    const r = compose("child", ix);
    expect(r.mcps).toEqual(["local/duckdb", "anthropic/playwright", "local/redis"]);
  });

  it("does not propagate 'extends' itself to the resolved bundle", () => {
    const ix = index(m("base"), m("child", { extends: ["base"] }));
    const r = compose("child", ix) as ResolvedBundle & { extends?: unknown };
    expect(r.extends).toBeUndefined();
  });

  it("merges multi-parent mixin in left-to-right order (rightmost wins)", () => {
    const ix = index(
      m("a", { skills: ["a1"], description: "A" }),
      m("b", { skills: ["b1"], description: "B" }),
      m("c", { skills: ["c1"], description: "C" }),
      m("child", { extends: ["a", "b", "c"] }),
    );
    const r = compose("child", ix);
    expect(r.skills).toEqual(["a1", "b1", "c1"]);
    expect(r.description).toBe("C");
  });

  it("diamond: shared grandparent appears once", () => {
    const ix = index(
      m("g", { skills: ["g1"] }),
      m("p1", { extends: ["g"], skills: ["p11"] }),
      m("p2", { extends: ["g"], skills: ["p21"] }),
      m("child", { extends: ["p1", "p2"] }),
    );
    const r = compose("child", ix);
    expect(r.skills).toEqual(["g1", "p11", "p21"]);
  });

  it("missing parent → error names the missing bundle and chain", () => {
    const ix = index(m("child", { extends: ["ghost"] }));
    expect(() => compose("child", ix)).toThrow(/ghost/);
  });

  it("cycle in extends → error", () => {
    const ix = index(m("a", { extends: ["b"] }), m("b", { extends: ["a"] }));
    expect(() => compose("a", ix)).toThrow(/cycle/i);
  });
});

import type { ResolvedBundle } from "../../../src/bundle/compose.ts";
