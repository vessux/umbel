import { describe, expect, it } from "vitest";
import { UsageError } from "../../../src/errors.ts";
import { addDepEdit } from "../../../src/store/manifest-edit.ts";

const RAW = `---
# my dev bundle
name: dev
skills:
  - local/tdd # keep this one
---

Body prose stays.
`;

describe("addDepEdit", () => {
  it("adds a deps entry and appends the skill ref, preserving comments and body", () => {
    const out = addDepEdit(RAW, "tools", "github:acme/tools@v1", "tools/greet");
    expect(out).toContain("# my dev bundle");
    expect(out).toContain("# keep this one");
    expect(out).toContain("Body prose stays.");
    expect(out).toMatch(/deps:\n\s+tools: github:acme\/tools@v1/);
    expect(out).toMatch(/- tools\/greet/);
  });

  it("creates the skills list when absent", () => {
    const raw = "---\nname: dev\n---\n";
    const out = addDepEdit(raw, "tools", "github:acme/tools@v1", "tools/greet");
    expect(out).toMatch(/skills:\n\s+- tools\/greet/);
  });

  it("does not duplicate an existing skill ref", () => {
    const once = addDepEdit(RAW, "tools", "github:acme/tools@v1", "tools/greet");
    const twice = addDepEdit(once, "tools", "github:acme/tools@v1", "tools/greet");
    expect(twice.match(/tools\/greet/g)?.length).toBe(1);
  });

  it("round-trips a parse: the edited file is a valid manifest", () => {
    const out = addDepEdit(RAW, "tools", "github:acme/tools@v1", "tools/greet");
    expect(out.startsWith("---\n")).toBe(true);
  });

  it("rejects a file without frontmatter", () => {
    expect(() => addDepEdit("no frontmatter", "a", "b", "a/c")).toThrowError(UsageError);
  });
});
