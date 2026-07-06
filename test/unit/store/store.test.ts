import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NotFoundError } from "../../../src/errors.ts";
import { parseCoordinate } from "../../../src/store/coordinate.ts";
import { checkoutPath, ensureCheckout } from "../../../src/store/store.ts";
import { makeGitFixture } from "../../helpers/git.ts";
import { cleanup, makeTmpDir } from "../../helpers/tmp.ts";

describe("ensureCheckout", () => {
  let root: string;
  let storeRoot: string;
  let repoDir: string;
  let commit: string;
  const coord = () => parseCoordinate("github:acme/tools@v1");

  beforeEach(() => {
    root = makeTmpDir();
    storeRoot = join(root, "store");
    repoDir = join(root, "fixtures", "acme", "tools");
    commit = makeGitFixture(repoDir, {
      "skills/greet/SKILL.md": "---\nname: greet\n---\nhi\n",
      "README.md": "readme\n",
    });
  });
  afterEach(() => cleanup(root));

  it("clones the tag into a commit-addressed dir, strips .git, returns commit + contentHash", () => {
    const out = ensureCheckout({ coord: coord(), url: `file://${repoDir}`, storeRoot });
    expect(out.commit).toBe(commit);
    expect(out.dir).toBe(checkoutPath(storeRoot, coord(), commit));
    expect(out.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(existsSync(join(out.dir, "skills/greet/SKILL.md"))).toBe(true);
    expect(existsSync(join(out.dir, ".git"))).toBe(false);
  });

  it("leaves no staging dirs behind", () => {
    ensureCheckout({ coord: coord(), url: `file://${repoDir}`, storeRoot });
    const leftovers = readdirSync(storeRoot).filter((e) => e.startsWith(".staging"));
    expect(leftovers).toEqual([]);
  });

  it("is a pure local no-op when lockedCommit's checkout exists (no re-fetch)", () => {
    const first = ensureCheckout({ coord: coord(), url: `file://${repoDir}`, storeRoot });
    // A bogus URL proves no network/clone happens on the locked path.
    const second = ensureCheckout({
      coord: coord(),
      url: `file://${join(root, "does-not-exist")}`,
      storeRoot,
      lockedCommit: commit,
    });
    expect(second.commit).toBe(commit);
    expect(second.contentHash).toBe(first.contentHash);
  });

  it("re-clones when lockedCommit's checkout is missing", () => {
    const out = ensureCheckout({
      coord: coord(),
      url: `file://${repoDir}`,
      storeRoot,
      lockedCommit: commit,
    });
    expect(out.commit).toBe(commit);
  });

  it("resolves an annotated tag to the commit sha, not the tag object", () => {
    const annotatedRepo = join(root, "fixtures", "acme", "annotated");
    const annotatedCommit = makeGitFixture(annotatedRepo, { "a.txt": "a\n" }, "v1", true);
    const out = ensureCheckout({
      coord: coord(),
      url: `file://${annotatedRepo}`,
      storeRoot,
    });
    expect(out.commit).toBe(annotatedCommit);
  });

  it("throws NotFoundError with git's stderr on a missing ref", () => {
    const bad = parseCoordinate("github:acme/tools@nope");
    expect(() => ensureCheckout({ coord: bad, url: `file://${repoDir}`, storeRoot })).toThrowError(
      NotFoundError,
    );
  });

  it("throws NotFoundError on an unreachable repo", () => {
    expect(() =>
      ensureCheckout({ coord: coord(), url: `file://${join(root, "missing")}`, storeRoot }),
    ).toThrowError(NotFoundError);
  });
});
