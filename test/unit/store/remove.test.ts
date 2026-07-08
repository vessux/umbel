import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NotFoundError } from "../../../src/errors.ts";
import { serializeLock } from "../../../src/store/lock.ts";
import { runRemove } from "../../../src/store/remove.ts";
import { cleanup, makeTmpDir, writeFile } from "../../helpers/tmp.ts";

const MD = `---
name: web
deps:
  tdd: github:org/tdd@v1
  local: link:./x
skills:
  - tdd/writing
  - local/mine
agents:
  - tdd/planner
  - local/helper
---
`;

const LOCK = serializeLock({
  version: 1,
  deps: {
    tdd: {
      coordinate: "github:org/tdd@v1",
      commit: "a".repeat(40),
      contentHash: "b".repeat(64),
    },
  },
});

describe("runRemove", () => {
  let root: string;
  let env: NodeJS.ProcessEnv;
  let mdPath: string;
  let lockPath: string;

  beforeEach(() => {
    root = makeTmpDir();
    mdPath = join(root, "config/bundles/web.md");
    lockPath = join(root, "config/bundles/web.lock");
    writeFile(mdPath, MD);
    writeFile(lockPath, LOCK);
    env = { NO_TTY: "1", UMBEL_ARTIFACTS_DIR: join(root, "config") };
  });
  afterEach(() => cleanup(root));

  describe("dependency", () => {
    it("drops the dep, its refs, and its lock entry", async () => {
      const code = await runRemove(["tdd", "--bundle", "web"], env, root);
      expect(code).toBe(0);
      const out = readFileSync(mdPath, "utf8");
      expect(out).not.toContain("tdd/writing");
      expect(out).not.toContain("tdd/planner");
      expect(out).toContain("local/mine");
      expect(readFileSync(lockPath, "utf8")).not.toContain("tdd");
    });

    it("errors when the dep is absent", async () => {
      await expect(runRemove(["ghost", "--bundle", "web"], env, root)).rejects.toThrow(
        NotFoundError,
      );
    });
  });

  describe("ref", () => {
    it("drops one ref, keeps the dep and its lock", async () => {
      await runRemove(["tdd/writing", "--bundle", "web"], env, root);
      const out = readFileSync(mdPath, "utf8");
      expect(out).not.toContain("tdd/writing");
      expect(out).toContain("tdd: github:org/tdd@v1");
      expect(readFileSync(lockPath, "utf8")).toContain("tdd");
    });

    it("errors when the ref is not composed here", async () => {
      await expect(runRemove(["tdd/ghost", "--bundle", "web"], env, root)).rejects.toThrow(
        NotFoundError,
      );
    });

    it("removes a ref from a non-skills list (agents)", async () => {
      await runRemove(["tdd/planner", "--bundle", "web"], env, root);
      const out = readFileSync(mdPath, "utf8");
      expect(out).not.toContain("tdd/planner");
      expect(out).toContain("local/helper"); // sibling agent ref kept
      expect(out).toContain("tdd/writing"); // skill ref untouched
      expect(out).toContain("tdd: github:org/tdd@v1"); // dep kept
    });
  });
});
