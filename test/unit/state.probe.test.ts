import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { probeSkillState } from "../../src/state/probe.ts";
import type { Skill } from "../../src/types.ts";
import { buildSourceTree, cleanup, makeTmpDir } from "../helpers/tmp.ts";

function makeSkill(
  qualifiedName: string,
  installName: string,
  sourcePath: string,
  overrides: Partial<Skill> = {},
): Skill {
  const [source = ""] = qualifiedName.split("/");
  return {
    name: qualifiedName,
    source,
    installName,
    sourcePath,
    description: "desc",
    malformed: false,
    ...overrides,
  };
}

describe("probeSkillState", () => {
  let root: string;
  let source: string;
  let target: string;
  let tddSrc: string;
  let otherSrc: string;

  beforeEach(() => {
    root = makeTmpDir();
    source = join(root, "src");
    target = join(root, "tgt");
    mkdirSync(source, { recursive: true });
    mkdirSync(target, { recursive: true });
    buildSourceTree(source, [
      { name: "tdd", source: "pocock", description: "t" },
      { name: "other", source: "pocock", description: "o" },
    ]);
    tddSrc = join(source, "pocock", "tdd");
    otherSrc = join(source, "pocock", "other");
  });

  afterEach(() => {
    cleanup(root);
  });

  it("absent when nothing exists at target/<installName>", () => {
    const skill = makeSkill("pocock/tdd", "tdd", tddSrc);
    expect(probeSkillState(skill, target)).toEqual({ kind: "absent" });
  });

  it("linked-correct when symlink resolves to skill.sourcePath", () => {
    const skill = makeSkill("pocock/tdd", "tdd", tddSrc);
    symlinkSync(tddSrc, join(target, "tdd"));
    const s = probeSkillState(skill, target);
    expect(s.kind).toBe("linked-correct");
  });

  it("linked-wrong when symlink points to a different source", () => {
    const skill = makeSkill("pocock/tdd", "tdd", tddSrc);
    symlinkSync(otherSrc, join(target, "tdd"));
    const s = probeSkillState(skill, target);
    expect(s.kind).toBe("linked-wrong");
  });

  it("linked-wrong when symlink is dangling", () => {
    const skill = makeSkill("pocock/tdd", "tdd", tddSrc);
    symlinkSync("/nonexistent/path", join(target, "tdd"));
    expect(probeSkillState(skill, target).kind).toBe("linked-wrong");
  });

  it("real when a directory exists at target", () => {
    const skill = makeSkill("pocock/tdd", "tdd", tddSrc);
    mkdirSync(join(target, "tdd"));
    const s = probeSkillState(skill, target);
    expect(s.kind).toBe("real");
    if (s.kind === "real") expect(s.isDirectory).toBe(true);
  });

  it("real when a file exists at target", () => {
    const skill = makeSkill("pocock/tdd", "tdd", tddSrc);
    writeFileSync(join(target, "tdd"), "hi");
    const s = probeSkillState(skill, target);
    expect(s.kind).toBe("real");
    if (s.kind === "real") expect(s.isDirectory).toBe(false);
  });

  it("malformed always overrides fs state", () => {
    const skill = makeSkill("pocock/tdd", "tdd", tddSrc, { malformed: true });
    mkdirSync(join(target, "tdd"));
    expect(probeSkillState(skill, target)).toEqual({ kind: "malformed" });
  });
});
