import { chmodSync, mkdirSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashTree } from "../../../src/store/content-hash.ts";
import { cleanup, makeTmpDir, writeFile } from "../../helpers/tmp.ts";

describe("hashTree", () => {
  let root: string;
  beforeEach(() => {
    root = makeTmpDir();
  });
  afterEach(() => cleanup(root));

  function tree(dir: string): void {
    writeFile(join(dir, "skills/greet/SKILL.md"), "---\nname: greet\n---\nhi\n");
    writeFile(join(dir, "README.md"), "readme\n");
  }

  it("is deterministic and mtime-independent", () => {
    const a = join(root, "a");
    const b = join(root, "b");
    tree(a);
    tree(b);
    utimesSync(join(a, "README.md"), new Date(2000, 0, 1), new Date(2000, 0, 1));
    expect(hashTree(a)).toBe(hashTree(b));
    expect(hashTree(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when file content changes", () => {
    const a = join(root, "a");
    tree(a);
    const before = hashTree(a);
    writeFileSync(join(a, "README.md"), "changed\n");
    expect(hashTree(a)).not.toBe(before);
  });

  it("changes when a path changes", () => {
    const a = join(root, "a");
    const b = join(root, "b");
    writeFile(join(a, "x.md"), "same\n");
    writeFile(join(b, "y.md"), "same\n");
    expect(hashTree(a)).not.toBe(hashTree(b));
  });

  it("is sensitive to the executable bit", () => {
    const a = join(root, "a");
    writeFile(join(a, "run.sh"), "#!/bin/sh\n");
    const before = hashTree(a);
    chmodSync(join(a, "run.sh"), 0o755);
    expect(hashTree(a)).not.toBe(before);
  });

  it("hashes symlinks by target string, not by following them", () => {
    const a = join(root, "a");
    mkdirSync(a, { recursive: true });
    symlinkSync("/nonexistent-target", join(a, "ln"));
    expect(hashTree(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not collide when content bytes mimic frame boundaries", () => {
    const a = join(root, "a");
    const b = join(root, "b");
    const c1 = Buffer.from("C1");
    const c2 = Buffer.from("C2");
    mkdirSync(b, { recursive: true });
    writeFileSync(join(b, "a"), c1);
    writeFileSync(join(b, "b"), c2);
    mkdirSync(a, { recursive: true });
    writeFileSync(join(a, "a"), Buffer.concat([c1, Buffer.from("\0f\0b\0-\0"), c2]));
    expect(hashTree(a)).not.toBe(hashTree(b));
  });

  it("changes when a symlink target changes", () => {
    const a = join(root, "a");
    const b = join(root, "b");
    mkdirSync(a, { recursive: true });
    mkdirSync(b, { recursive: true });
    symlinkSync("/target-one", join(a, "ln"));
    symlinkSync("/target-two", join(b, "ln"));
    expect(hashTree(a)).not.toBe(hashTree(b));
  });

  it("ignores a .git directory", () => {
    const a = join(root, "a");
    const b = join(root, "b");
    tree(a);
    tree(b);
    writeFile(join(a, ".git/HEAD"), "ref: refs/heads/main\n");
    expect(hashTree(a)).toBe(hashTree(b));
  });
});
