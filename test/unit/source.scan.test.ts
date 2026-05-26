import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NotFoundError } from "../../src/errors.ts";
import { scanSource } from "../../src/source/scan.ts";
import { buildSourceTree, cleanup, makeTmpDir } from "../helpers/tmp.ts";

describe("scanSource", () => {
  let root: string;

  beforeEach(() => {
    root = makeTmpDir();
  });
  afterEach(() => {
    cleanup(root);
  });

  it("returns skills with qualified names and frontmatter descriptions", () => {
    buildSourceTree(root, [
      { name: "tdd", source: "pocock", description: "Test-driven development" },
      { name: "grill-me", source: "pocock", description: "Interview the user" },
    ]);
    const skills = scanSource(root);
    expect(skills.map((s) => s.name)).toEqual(["pocock/grill-me", "pocock/tdd"]);
    expect(skills[0]!.description).toBe("Interview the user");
    expect(skills[1]!.description).toBe("Test-driven development");
    for (const s of skills) {
      expect(s.malformed).toBe(false);
      expect(s.sourcePath.startsWith("/")).toBe(true);
    }
  });

  it("installName comes from frontmatter name when present (matches leaf here)", () => {
    buildSourceTree(root, [
      { name: "tdd", source: "pocock", description: "Test-driven development" },
    ]);
    const skills = scanSource(root);
    expect(skills[0]!.name).toBe("pocock/tdd");
    expect(skills[0]!.installName).toBe("tdd");
  });

  it("installName uses frontmatter name when it differs from leaf", () => {
    // Source leaf = "annotate" but frontmatter declares name "plannotator-annotate".
    mkdirSync(join(root, "plannotator", "annotate"), { recursive: true });
    writeFileSync(
      join(root, "plannotator", "annotate", "SKILL.md"),
      "---\nname: plannotator-annotate\ndescription: hi\n---\nbody\n",
    );
    const skills = scanSource(root);
    expect(skills[0]!.name).toBe("plannotator/annotate");
    expect(skills[0]!.installName).toBe("plannotator-annotate");
  });

  it("skips dirs without SKILL.md", () => {
    buildSourceTree(root, [
      { name: "keeper", source: "pocock", description: "ok" },
      { name: "not-a-skill", source: "pocock", noSkillMd: true },
    ]);
    const skills = scanSource(root);
    expect(skills.map((s) => s.name)).toEqual(["pocock/keeper"]);
  });

  it("ignores nesting beyond <source>/<leaf>/SKILL.md", () => {
    mkdirSync(join(root, "foo", "bar", "baz"), { recursive: true });
    writeFileSync(
      join(root, "foo", "bar", "baz", "SKILL.md"),
      "---\nname: too-deep\ndescription: nope\n---\n",
    );
    const skills = scanSource(root);
    expect(skills).toEqual([]);
  });

  it("tolerates malformed frontmatter (flags malformed=true)", () => {
    buildSourceTree(root, [{ name: "broken", source: "pocock", malformedFrontmatter: true }]);
    const skills = scanSource(root);
    expect(skills).toHaveLength(1);
    expect(skills[0]!.malformed).toBe(true);
    expect(skills[0]!.description).toBeNull();
  });

  it("missing description in valid frontmatter → description=null", () => {
    buildSourceTree(root, [{ name: "noisy", source: "pocock" }]);
    const skills = scanSource(root);
    expect(skills[0]!.description).toBeNull();
    expect(skills[0]!.malformed).toBe(false);
  });

  it("throws NotFoundError when source root is missing", () => {
    expect(() => scanSource(join(root, "nope"))).toThrow(NotFoundError);
  });

  it("follows leaf-level symlinks when they point to a skill dir", () => {
    buildSourceTree(root, [{ name: "real-skill", source: "pocock", description: "real" }]);
    const realDir = join(root, "pocock", "real-skill");
    symlinkSync(realDir, join(root, "pocock", "linked-skill"));
    const skills = scanSource(root);
    expect(skills.map((s) => s.name).sort()).toEqual(["pocock/linked-skill", "pocock/real-skill"]);
  });
});
