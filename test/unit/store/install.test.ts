import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseCoordinate } from "../../../src/store/coordinate.ts";
import { reconcile } from "../../../src/store/install.ts";
import { checkoutPath } from "../../../src/store/store.ts";
import { makeGitFixture } from "../../helpers/git.ts";
import { cleanup, makeTmpDir } from "../../helpers/tmp.ts";

describe("reconcile (non-frozen)", () => {
  let root: string;
  let env: NodeJS.ProcessEnv;
  let storeRoot: string;
  let toolsCommit: string;
  let libCommit: string;

  beforeEach(() => {
    root = makeTmpDir();
    toolsCommit = makeGitFixture(join(root, "gh/acme/tools"), {
      "skills/greet/SKILL.md": "---\nname: greet\n---\nhi\n",
    });
    libCommit = makeGitFixture(join(root, "gh/acme/lib"), {
      "skills/util/SKILL.md": "---\nname: util\n---\nutil\n",
    });
    storeRoot = join(root, "store");
    env = { UMBEL_GITHUB_BASE: `file://${join(root, "gh")}` };
  });
  afterEach(() => cleanup(root));

  it("resolves a dep that is new to the lock and stakes its checkout", () => {
    const r = reconcile({
      deps: { tools: "github:acme/tools@v1" },
      lock: null,
      storeRoot,
      env,
      frozen: false,
    });
    expect(r.changed).toBe(true);
    expect(r.added).toEqual(["tools"]);
    expect(r.lock.deps.tools!.commit).toBe(toolsCommit);
    expect(
      existsSync(
        join(
          checkoutPath(storeRoot, parseCoordinate("github:acme/tools@v1"), toolsCommit),
          "skills/greet/SKILL.md",
        ),
      ),
    ).toBe(true);
  });

  it("keeps an unchanged pin byte-for-byte and reports no change", () => {
    const lock = {
      version: 1 as const,
      deps: {
        tools: { coordinate: "github:acme/tools@v1", commit: toolsCommit, contentHash: "a".repeat(64) },
      },
    };
    const r = reconcile({ deps: { tools: "github:acme/tools@v1" }, lock, storeRoot, env, frozen: false });
    expect(r.changed).toBe(false);
    expect(r.kept).toEqual(["tools"]);
    // commit + contentHash carried verbatim (not re-hashed, not bumped)
    expect(r.lock.deps.tools).toEqual(lock.deps.tools);
  });

  it("drops a lock entry no longer in the manifest", () => {
    const lock = {
      version: 1 as const,
      deps: {
        tools: { coordinate: "github:acme/tools@v1", commit: toolsCommit, contentHash: "a".repeat(64) },
        lib: { coordinate: "github:acme/lib@v1", commit: libCommit, contentHash: "b".repeat(64) },
      },
    };
    const r = reconcile({ deps: { tools: "github:acme/tools@v1" }, lock, storeRoot, env, frozen: false });
    expect(r.changed).toBe(true);
    expect(r.removed).toEqual(["lib"]);
    expect(Object.keys(r.lock.deps)).toEqual(["tools"]);
    expect(r.lock.deps.tools).toEqual(lock.deps.tools); // kept pin untouched
  });

  it("re-resolves a dep whose coordinate changed, without touching other pins", () => {
    const v2 = makeGitFixture(join(root, "gh/acme/tools2"), {
      "skills/greet/SKILL.md": "---\nname: greet\n---\nnew\n",
    });
    const lock = {
      version: 1 as const,
      deps: {
        tools: { coordinate: "github:acme/tools@v1", commit: toolsCommit, contentHash: "a".repeat(64) },
        lib: { coordinate: "github:acme/lib@v1", commit: libCommit, contentHash: "b".repeat(64) },
      },
    };
    const r = reconcile({
      deps: { tools: "github:acme/tools2@v1", lib: "github:acme/lib@v1" },
      lock,
      storeRoot,
      env,
      frozen: false,
    });
    expect(r.changed).toBe(true);
    expect(r.added).toEqual(["tools"]); // coordinate changed → re-resolved
    expect(r.lock.deps.tools!.coordinate).toBe("github:acme/tools2@v1");
    expect(r.lock.deps.tools!.commit).toBe(v2);
    expect(r.lock.deps.lib).toEqual(lock.deps.lib); // untouched
  });
});
