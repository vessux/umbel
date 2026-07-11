import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { normalizeRepo } from "../../../src/store/normalize.ts";
import { cleanup, makeTmpDir, writeFile } from "../../helpers/tmp.ts";

describe("normalizeRepo — skills", () => {
  let src: string;
  let dest: string;
  beforeEach(() => {
    src = makeTmpDir("umbel-src-");
    dest = makeTmpDir("umbel-dest-");
  });
  afterEach(() => {
    cleanup(src);
    cleanup(dest);
  });

  it("detects a skills/ tree", () => {
    writeFile(join(src, "skills/greet/SKILL.md"), "---\nname: greet\n---\nhi\n");
    writeFile(join(src, "skills/greet/run.sh"), "echo hi\n");
    const { artifacts } = normalizeRepo(src, dest);
    expect(artifacts).toEqual([{ kind: "skills", leaf: "greet", dir: join(dest, "skills/greet") }]);
    expect(readFileSync(join(dest, "skills/greet/SKILL.md"), "utf8")).toContain("greet");
    expect(existsSync(join(dest, "skills/greet/run.sh"))).toBe(true);
  });

  it("detects a repo-of-dirs (<leaf>/SKILL.md at root)", () => {
    writeFile(join(src, "greet/SKILL.md"), "---\nname: greet\n---\nhi\n");
    const { artifacts } = normalizeRepo(src, dest);
    expect(artifacts).toEqual([{ kind: "skills", leaf: "greet", dir: join(dest, "skills/greet") }]);
  });

  it("detects a lone SKILL.md at the repo root (leaf = frontmatter name)", () => {
    writeFile(join(src, "SKILL.md"), "---\nname: solo\n---\nhi\n");
    const { artifacts } = normalizeRepo(src, dest);
    expect(artifacts.map((a) => [a.kind, a.leaf])).toEqual([["skills", "solo"]]);
    expect(existsSync(join(dest, "skills/solo/SKILL.md"))).toBe(true);
  });

  it("returns no artifacts for an empty repo", () => {
    const { artifacts } = normalizeRepo(src, dest);
    expect(artifacts).toEqual([]);
  });
});
