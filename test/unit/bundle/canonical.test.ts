import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { canonicalize } from "../../../src/bundle/canonical.ts";

describe("canonicalize", () => {
  it("produces identical output for two maps with different insertion order", () => {
    const a = canonicalize({ b: 1, a: 2 });
    const b = canonicalize({ a: 2, b: 1 });
    expect(a).toBe(b);
  });

  it("preserves list insertion order", () => {
    const out = canonicalize({ items: ["c", "a", "b"] });
    expect(out).toContain("- c");
    expect(out.indexOf("- c")).toBeLessThan(out.indexOf("- a"));
    expect(out.indexOf("- a")).toBeLessThan(out.indexOf("- b"));
  });

  it("sorts nested map keys recursively", () => {
    const a = canonicalize({ outer: { z: 1, a: 2 } });
    const b = canonicalize({ outer: { a: 2, z: 1 } });
    expect(a).toBe(b);
    expect(a.indexOf("a:")).toBeLessThan(a.indexOf("z:"));
  });

  it("round-trips: parse(canonicalize(x)) deep-equals x", () => {
    const input = {
      name: "data-science",
      skills: ["pandas", "plotnine"],
      hooks: { PreToolUse: [{ matcher: "Bash" }] },
      settings: { model: "claude-opus-4-7", env: { FOO: "bar" } },
    };
    const round = parse(canonicalize(input));
    expect(round).toEqual(input);
  });

  it("two equivalent manifests differing only in key order serialize byte-identical", () => {
    const a = canonicalize({
      name: "x",
      settings: { env: { B: "2", A: "1" }, model: "m" },
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "c" }] }] },
    });
    const b = canonicalize({
      hooks: { PreToolUse: [{ hooks: [{ command: "c", type: "command" }], matcher: "Bash" }] },
      settings: { model: "m", env: { A: "1", B: "2" } },
      name: "x",
    });
    expect(a).toBe(b);
  });
});
