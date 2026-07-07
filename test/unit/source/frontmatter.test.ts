import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFrontmatter } from "../../../src/source/frontmatter.ts";
import { cleanup, makeTmpDir, writeFile } from "../../helpers/tmp.ts";

describe("readFrontmatter", () => {
  let root: string;
  beforeEach(() => {
    root = makeTmpDir();
  });
  afterEach(() => {
    cleanup(root);
  });

  function write(contents: string): string {
    const path = join(root, "SKILL.md");
    writeFile(path, contents);
    return path;
  }

  it("extracts name and description from valid frontmatter", () => {
    const p = write("---\nname: tdd\ndescription: Test-driven development\n---\nbody\n");
    expect(readFrontmatter(p)).toEqual({
      name: "tdd",
      description: "Test-driven development",
      malformed: false,
    });
  });

  it("returns null for a missing name or description", () => {
    const p = write("---\nname: tdd\n---\nbody\n");
    expect(readFrontmatter(p)).toEqual({ name: "tdd", description: null, malformed: false });
  });

  it("treats empty-string values as null", () => {
    const p = write('---\nname: ""\ndescription: ""\n---\nbody\n');
    expect(readFrontmatter(p)).toEqual({ name: null, description: null, malformed: false });
  });

  it("treats non-string values as null (not malformed)", () => {
    const p = write("---\nname: 42\ndescription:\n  - a\n  - b\n---\nbody\n");
    expect(readFrontmatter(p)).toEqual({ name: null, description: null, malformed: false });
  });

  it("flags unparseable YAML as malformed", () => {
    const p = write("---\nname: {unterminated\ndescription: [also-bad\n---\nbody\n");
    expect(readFrontmatter(p)).toEqual({ name: null, description: null, malformed: true });
  });

  it("flags an unreadable path as malformed", () => {
    expect(readFrontmatter(join(root, "does-not-exist.md"))).toEqual({
      name: null,
      description: null,
      malformed: true,
    });
  });
});
