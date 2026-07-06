import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listSkillLeaves, skillDirIn } from "../../../src/store/artifacts.ts";
import { cleanup, makeTmpDir, writeFile } from "../../helpers/tmp.ts";

describe("store artifact scan", () => {
  let root: string;
  beforeEach(() => {
    root = makeTmpDir();
  });
  afterEach(() => cleanup(root));

  it("finds skills under skills/<leaf>/SKILL.md", () => {
    writeFile(join(root, "skills/greet/SKILL.md"), "---\nname: greet\n---\n");
    writeFile(join(root, "skills/farewell/SKILL.md"), "---\nname: farewell\n---\n");
    const leaves = listSkillLeaves(root);
    expect([...leaves.keys()].sort()).toEqual(["farewell", "greet"]);
    expect(leaves.get("greet")).toBe(join(root, "skills/greet"));
  });

  it("finds root-level <leaf>/SKILL.md when there is no skills/ tree", () => {
    writeFile(join(root, "greet/SKILL.md"), "---\nname: greet\n---\n");
    expect(listSkillLeaves(root).get("greet")).toBe(join(root, "greet"));
  });

  it("prefers the skills/ tree over a same-named root dir", () => {
    writeFile(join(root, "skills/greet/SKILL.md"), "x");
    writeFile(join(root, "greet/SKILL.md"), "y");
    expect(listSkillLeaves(root).get("greet")).toBe(join(root, "skills/greet"));
  });

  it("ignores dirs without SKILL.md and plain files", () => {
    writeFile(join(root, "docs/README.md"), "x");
    writeFile(join(root, "LICENSE"), "x");
    expect(listSkillLeaves(root).size).toBe(0);
  });

  it("skillDirIn returns the dir or null", () => {
    writeFile(join(root, "skills/greet/SKILL.md"), "x");
    expect(skillDirIn(root, "greet")).toBe(join(root, "skills/greet"));
    expect(skillDirIn(root, "ghost")).toBeNull();
  });
});
