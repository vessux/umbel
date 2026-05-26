import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findClaudeSkillsDir } from "../../src/target/walk.ts";
import { cleanup, makeTmpDir } from "../helpers/tmp.ts";

describe("findClaudeSkillsDir", () => {
  let root: string;

  beforeEach(() => {
    root = makeTmpDir();
  });
  afterEach(() => {
    cleanup(root);
  });

  it("finds .claude in the same dir as CWD", () => {
    mkdirSync(join(root, ".claude"));
    expect(findClaudeSkillsDir(root, "/home/u")).toBe(join(root, ".claude", "skills"));
  });

  it("walks up to find .claude in an ancestor", () => {
    mkdirSync(join(root, ".claude"));
    const deep = join(root, "a", "b", "c");
    mkdirSync(deep, { recursive: true });
    expect(findClaudeSkillsDir(deep, "/home/u")).toBe(join(root, ".claude", "skills"));
  });

  it("stops at .git boundary if .claude was not found first", () => {
    const project = join(root, "repo");
    mkdirSync(join(project, ".git"), { recursive: true });
    mkdirSync(join(root, ".claude")); // .claude lives OUTSIDE the git repo
    const inside = join(project, "src");
    mkdirSync(inside, { recursive: true });
    expect(findClaudeSkillsDir(inside, "/home/u")).toBeNull();
  });

  it("prefers .claude inside the repo over .git stop", () => {
    const project = join(root, "repo");
    mkdirSync(join(project, ".git"), { recursive: true });
    mkdirSync(join(project, ".claude"));
    const inside = join(project, "src", "deep");
    mkdirSync(inside, { recursive: true });
    expect(findClaudeSkillsDir(inside, "/home/u")).toBe(join(project, ".claude", "skills"));
  });

  it("stops at home boundary", () => {
    const home = join(root, "home");
    const project = join(home, "proj");
    mkdirSync(project, { recursive: true });
    expect(findClaudeSkillsDir(project, home)).toBeNull();
  });

  it("returns null when nothing is found", () => {
    const deep = join(root, "a", "b");
    mkdirSync(deep, { recursive: true });
    expect(findClaudeSkillsDir(deep, "/elsewhere")).toBeNull();
  });

  it("ignores a .claude file (not a dir)", () => {
    writeFileSync(join(root, ".claude"), "not a dir");
    expect(findClaudeSkillsDir(root, "/home/u")).toBeNull();
  });
});
