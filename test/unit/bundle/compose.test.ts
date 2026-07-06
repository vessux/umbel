import { describe, expect, it } from "vitest";
import { compose } from "../../../src/bundle/compose.ts";
import type { BundleManifest } from "../../../src/bundle/manifest.ts";
import { CliError } from "../../../src/errors.ts";

function m(name: string, partial: Partial<BundleManifest> = {}): BundleManifest {
  return { name, sourcePath: `/x/${name}.md`, body: "", ...partial };
}

function index(...mans: BundleManifest[]): Map<string, BundleManifest> {
  return new Map(mans.map((x) => [x.name, x]));
}

function thrown(fn: () => unknown): CliError {
  try {
    fn();
  } catch (e) {
    if (e instanceof CliError) return e;
    throw e;
  }
  throw new Error("expected function to throw");
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

  it("unknown bundle name → not found (exit 3)", () => {
    const err = thrown(() => compose("ghost", index(m("base"))));
    expect(err.name).toBe("NotFoundError");
    expect(err.exitCode).toBe(3);
    expect(err.message).toMatch(/ghost.*not found/);
  });

  it("missing parent → not found (exit 3), names the missing bundle and chain", () => {
    const err = thrown(() => compose("child", index(m("child", { extends: ["ghost"] }))));
    expect(err.name).toBe("NotFoundError");
    expect(err.exitCode).toBe(3);
    expect(err.message).toMatch(/ghost/);
  });

  it("cycle in extends → usage error (exit 2), not not-found", () => {
    const err = thrown(() =>
      compose("a", index(m("a", { extends: ["b"] }), m("b", { extends: ["a"] }))),
    );
    expect(err.name).toBe("UsageError");
    expect(err.exitCode).toBe(2);
    expect(err.message).toMatch(/cycle/i);
  });

  it("malformed parent (in the malformed map) → usage error (exit 2), names parent + error + chain", () => {
    const ix = index(m("leaf", { extends: ["base"] }));
    const malformed = new Map([["base", "settings.notAllowed is not in the whitelist"]]);
    const err = thrown(() => compose("leaf", ix, malformed));
    expect(err.name).toBe("UsageError");
    expect(err.exitCode).toBe(2);
    expect(err.message).toMatch(/'base'/);
    expect(err.message).toMatch(/not in the whitelist/);
    expect(err.message).toMatch(/leaf → base/);
  });

  it("malformed grandparent (transitive, depth ≥ 2) → usage error (exit 2) with chain trace", () => {
    const ix = index(m("leaf", { extends: ["mid"] }), m("mid", { extends: ["gp"] }));
    const malformed = new Map([["gp", "invalid YAML in frontmatter"]]);
    const err = thrown(() => compose("leaf", ix, malformed));
    expect(err.name).toBe("UsageError");
    expect(err.exitCode).toBe(2);
    expect(err.message).toMatch(/'gp'/);
    expect(err.message).toMatch(/leaf → mid → gp/);
  });

  it("missing parent NOT in the malformed map → still not found (exit 3)", () => {
    const ix = index(m("child", { extends: ["ghost"] }));
    const err = thrown(() => compose("child", ix, new Map<string, string>()));
    expect(err.name).toBe("NotFoundError");
    expect(err.exitCode).toBe(3);
    expect(err.message).toMatch(/missing parent 'ghost'/);
  });

  it("deps: child map replaces parent wholesale (aliases are bundle-private)", () => {
    const ix = index(
      m("base", { deps: { a: "github:x/a@v1" } }),
      m("child", { extends: ["base"], deps: { b: "github:x/b@v1" } }),
    );
    expect(compose("child", ix).deps).toEqual({ b: "github:x/b@v1" });
  });

  it("deps: parent map survives when child declares none", () => {
    const ix = index(
      m("base", { deps: { a: "github:x/a@v1" } }),
      m("child", { extends: ["base"] }),
    );
    expect(compose("child", ix).deps).toEqual({ a: "github:x/a@v1" });
  });
});

import type { ResolvedBundle } from "../../../src/bundle/compose.ts";
import { composeChain } from "../../../src/bundle/compose.ts";

describe("composeChain", () => {
  it("composeChain returns the linearized extends chain, ancestors first", () => {
    const ix = new Map<string, BundleManifest>([
      ["base", { name: "base", body: "", sourcePath: "base.md" }],
      ["mid", { name: "mid", extends: ["base"], body: "", sourcePath: "mid.md" }],
      ["leaf", { name: "leaf", extends: ["mid"], body: "", sourcePath: "leaf.md" }],
    ]);
    expect(composeChain("leaf", ix)).toEqual(["base", "mid", "leaf"]);
  });
});
