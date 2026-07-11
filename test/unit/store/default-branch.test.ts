import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveDefaultBranch } from "../../../src/store/store.ts";
import { makeGitFixture } from "../../helpers/git.ts";
import { cleanup, makeTmpDir } from "../../helpers/tmp.ts";

describe("resolveDefaultBranch", () => {
  let root: string;
  beforeAll(() => {
    root = makeTmpDir();
    makeGitFixture(join(root, "repo"), { "README.md": "hi\n" });
  });
  afterAll(() => cleanup(root));

  it("returns the HEAD branch of a repo (main)", () => {
    expect(resolveDefaultBranch(`file://${join(root, "repo")}`)).toBe("main");
  });
  it("throws NotFoundError on an unreachable url", () => {
    expect(() => resolveDefaultBranch(`file://${join(root, "nope")}`)).toThrow();
  });
});
