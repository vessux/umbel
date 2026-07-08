import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseDocument } from "yaml";
import { loadManifest } from "../../../src/bundle/manifest.ts";
import { UsageError } from "../../../src/errors.ts";
import {
  addDepEdit,
  removeDepEdit,
  removeRefEdit,
  renameBundleEdit,
} from "../../../src/store/manifest-edit.ts";
import { cleanup, makeTmpDir } from "../../helpers/tmp.ts";

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

const SAMPLE = `---
name: web
# hand-written comment
deps:
  tdd: github:org/tdd@v1
  local: link:./x
skills:
  - tdd/writing   # inline note
  - local/mine
  - tdd/reviewing
agents:
  - tdd/planner
---

Body prose stays.
`;

describe("removeDepEdit", () => {
  it("drops the dep and all its refs, preserving comments and body", () => {
    const out = removeDepEdit(SAMPLE, "tdd");
    expect(out).toContain("# hand-written comment");
    expect(out).toContain("Body prose stays.");
    expect(out).not.toContain("tdd/writing");
    expect(out).not.toContain("tdd/reviewing");
    expect(out).not.toContain("tdd/planner");
    expect(out).toContain("local/mine");
    expect(out).toContain("local: link:./x");
  });

  it("deletes a list key that becomes empty and empties deps", () => {
    const out = removeDepEdit(SAMPLE, "tdd");
    expect(out).not.toMatch(/^agents:/m);
    expect(out).toContain("deps:");
    const onlyLocal = removeDepEdit(out, "local");
    expect(onlyLocal).not.toMatch(/^deps:/m);
    expect(onlyLocal).not.toMatch(/^skills:/m);
  });
});

describe("removeRefEdit", () => {
  it("removes one ref, leaves deps and sibling refs intact", () => {
    const out = removeRefEdit(SAMPLE, "tdd/writing");
    expect(out).not.toContain("tdd/writing");
    expect(out).toContain("tdd/reviewing");
    expect(out).toContain("tdd: github:org/tdd@v1");
  });
});

describe("renameBundleEdit", () => {
  it("rewrites the name field, preserving everything else", () => {
    const out = renameBundleEdit(SAMPLE, "web-fork");
    expect(out).toMatch(/^name: web-fork$/m);
    expect(out).toContain("# hand-written comment");
    expect(out).toContain("Body prose stays.");
  });
});

describe("edit round-trips re-parse", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) cleanup(d);
  });

  it("removeDepEdit output loads as a valid manifest", () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    const p = join(dir, "web.md");
    writeFileSync(p, removeDepEdit(SAMPLE, "tdd"));
    const { manifest } = loadManifest(p);
    expect(manifest.deps).toEqual({ local: "link:./x" });
    expect(manifest.skills).toEqual(["local/mine"]);
  });
});
