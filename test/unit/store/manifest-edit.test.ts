import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";
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
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(out);
    expect(fm).not.toBeNull();
    const doc = parseDocument(fm?.[1] ?? "");
    expect(doc.errors).toHaveLength(0);
    const data = doc.toJS() as { deps: Record<string, string>; skills: string[] };
    expect(data.deps.tools).toBe("github:acme/tools@v1");
    expect(data.skills).toContain("local/tdd");
    expect(data.skills).toContain("tools/greet");
  });

  it("rejects a file without frontmatter", () => {
    expect(() => addDepEdit("no frontmatter", "a", "b", "a/c")).toThrowError(UsageError);
  });

  it("rejects invalid YAML frontmatter", () => {
    expect(() =>
      addDepEdit("---\nname: {broken\n---\n", "tools", "github:acme/tools@v1", "tools/greet"),
    ).toThrowError(UsageError);
  });

  it("rejects a non-list skills value", () => {
    expect(() =>
      addDepEdit("---\nskills: yes\n---\n", "tools", "github:acme/tools@v1", "tools/greet"),
    ).toThrowError(UsageError);
  });

  it("handles empty frontmatter", () => {
    const out = addDepEdit("---\n\n---\n", "tools", "github:acme/tools@v1", "tools/greet");
    expect(out).toMatch(/deps:\n\s+tools: github:acme\/tools@v1/);
    expect(out).toMatch(/skills:\n\s+- tools\/greet/);
  });
});
