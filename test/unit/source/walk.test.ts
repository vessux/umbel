import { symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NotFoundError } from "../../../src/errors.ts";
import { walkArtifactRoot } from "../../../src/source/walk.ts";
import { buildSourceTree, cleanup, makeTmpDir } from "../../helpers/tmp.ts";

describe("walkArtifactRoot", () => {
  let root: string;

  beforeEach(() => {
    root = makeTmpDir();
  });
  afterEach(() => {
    cleanup(root);
  });

  it("returns qualified <source>/<leaf> for every dir containing the artifact file", () => {
    buildSourceTree(root, [
      { name: "tdd", source: "pocock" },
      { name: "grill-me", source: "pocock" },
      { name: "review", source: "local" },
    ]);
    const out = walkArtifactRoot(root, "SKILL.md");
    expect(out.sort()).toEqual(["local/review", "pocock/grill-me", "pocock/tdd"]);
  });

  it("excludes leaf dirs that don't contain the artifact file", () => {
    buildSourceTree(root, [
      { name: "keeper", source: "pocock" },
      { name: "no-artifact", source: "pocock", noSkillMd: true },
    ]);
    const out = walkArtifactRoot(root, "SKILL.md");
    expect(out).toEqual(["pocock/keeper"]);
  });

  it("skips non-directory entries at both source and leaf levels", () => {
    buildSourceTree(root, [{ name: "keeper", source: "pocock" }]);
    // stray file at root level (looks like a source but is a file)
    writeFileSync(join(root, "README.md"), "stray\n");
    // stray file inside source dir (looks like a leaf but is a file)
    writeFileSync(join(root, "pocock", "stray.md"), "stray\n");
    const out = walkArtifactRoot(root, "SKILL.md");
    expect(out).toEqual(["pocock/keeper"]);
  });

  it("follows leaf-level symlinks pointing to a real artifact dir", () => {
    buildSourceTree(root, [{ name: "real", source: "pocock" }]);
    symlinkSync(join(root, "pocock", "real"), join(root, "pocock", "linked"));
    const out = walkArtifactRoot(root, "SKILL.md");
    expect(out.sort()).toEqual(["pocock/linked", "pocock/real"]);
  });

  it("throws NotFoundError when root does not exist", () => {
    expect(() => walkArtifactRoot(join(root, "nope"), "SKILL.md")).toThrow(NotFoundError);
  });

  it("returns results sorted alphabetically by qualified name", () => {
    // Create in non-alpha order; readdirSync order is not guaranteed alpha across OSes.
    buildSourceTree(root, [
      { name: "zebra", source: "pocock" },
      { name: "alpha", source: "pocock" },
      { name: "mid", source: "local" },
    ]);
    const out = walkArtifactRoot(root, "SKILL.md");
    expect(out).toEqual(["local/mid", "pocock/alpha", "pocock/zebra"]);
  });
});
