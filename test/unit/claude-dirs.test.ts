import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findClaudeAncestor, findClaudeBundlesDir, isDir } from "../../src/claude-dirs.ts";
import { cleanup, makeTmpDir } from "../helpers/tmp.ts";

// A home outside the tmp tree, so it never short-circuits the upward walk.
const HOME = "/home/nobody";

describe("findClaudeAncestor", () => {
  let root: string;
  beforeEach(() => {
    root = makeTmpDir();
  });
  afterEach(() => {
    cleanup(root);
  });

  it("finds .claude in the same dir as start", () => {
    mkdirSync(join(root, ".claude"));
    expect(findClaudeAncestor(root, HOME)).toBe(root);
  });

  it("walks up to a parent that has .claude", () => {
    mkdirSync(join(root, ".claude"));
    const nested = join(root, "a", "b");
    mkdirSync(nested, { recursive: true });
    expect(findClaudeAncestor(nested, HOME)).toBe(root);
  });

  it("never matches home's own .claude (exclusive upper boundary)", () => {
    mkdirSync(join(root, ".claude"));
    expect(findClaudeAncestor(root, root)).toBeNull();
  });

  it("stops at the nearest .git when stopAtGit is set", () => {
    mkdirSync(join(root, ".claude"));
    const inside = join(root, "repo", "src");
    mkdirSync(inside, { recursive: true });
    mkdirSync(join(root, "repo", ".git"), { recursive: true });
    expect(findClaudeAncestor(inside, HOME, { stopAtGit: true })).toBeNull();
    // Without the boundary the walk crosses the repo and finds the ancestor.
    expect(findClaudeAncestor(inside, HOME)).toBe(root);
  });
});

describe("findClaudeBundlesDir", () => {
  let root: string;
  beforeEach(() => {
    root = makeTmpDir();
  });
  afterEach(() => {
    cleanup(root);
  });

  it("returns <ancestor>/.claude/bundles", () => {
    mkdirSync(join(root, ".claude"));
    expect(findClaudeBundlesDir(root, HOME)).toBe(join(root, ".claude", "bundles"));
  });

  it("returns null when no .claude ancestor exists", () => {
    expect(findClaudeBundlesDir(root, HOME)).toBeNull();
  });
});

describe("isDir", () => {
  let root: string;
  beforeEach(() => {
    root = makeTmpDir();
  });
  afterEach(() => {
    cleanup(root);
  });

  it("is true for a directory", () => {
    expect(isDir(root)).toBe(true);
  });

  it("is false for a regular file", () => {
    const f = join(root, "file.txt");
    writeFileSync(f, "hi");
    expect(isDir(f)).toBe(false);
  });

  it("is false for a nonexistent path", () => {
    expect(isDir(join(root, "nope"))).toBe(false);
  });
});
