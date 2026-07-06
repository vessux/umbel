import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ResolvedBundle } from "../../../src/bundle/compose.ts";
import { resolveSources } from "../../../src/bundle/resolve.ts";
import { CliError } from "../../../src/errors.ts";
import { cleanup, makeTmpDir } from "../../helpers/tmp.ts";

function thrown(fn: () => unknown): CliError {
  try {
    fn();
  } catch (e) {
    if (e instanceof CliError) return e;
    throw e;
  }
  throw new Error("expected function to throw");
}

describe("resolveSources", () => {
  let root: string;
  let roots: {
    skills: string;
    agents: string;
    hooks: string;
    mcps: string;
  };

  beforeEach(() => {
    root = makeTmpDir();
    roots = {
      skills: join(root, "skills"),
      agents: join(root, "agents"),
      hooks: join(root, "hooks"),
      mcps: join(root, "mcps"),
    };
    for (const r of Object.values(roots)) mkdirSync(r, { recursive: true });
  });
  afterEach(() => {
    cleanup(root);
  });

  function mkArtifact(rootDir: string, name: string): string {
    const dir = join(rootDir, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\n---\nbody\n`);
    return dir;
  }

  function mkSubArtifact(rootDir: string, source: string, leaf: string): string {
    const dir = join(rootDir, source, leaf);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), `---\nname: ${leaf}\n---\nbody\n`);
    return dir;
  }

  function bundle(partial: Partial<ResolvedBundle>): ResolvedBundle {
    return {
      name: "test",
      sourcePath: "/x",
      body: "",
      ...partial,
    };
  }

  it("resolves every named skill to its absolute source path", () => {
    const tdd = mkArtifact(roots.skills, "tdd");
    const review = mkArtifact(roots.skills, "review");
    const out = resolveSources(bundle({ skills: ["tdd", "review"] }), { roots });
    expect(out.skills.get("tdd")).toBe(tdd);
    expect(out.skills.get("review")).toBe(review);
    expect(out.warnings).toEqual([]);
  });

  it("bare ref (no '/') in manifest → usage error (exit 2), hints at missing source qualifier", () => {
    mkSubArtifact(roots.skills, "local", "tdd");
    const err = thrown(() => resolveSources(bundle({ skills: ["tdd"] }), { roots }));
    expect(err.name).toBe("UsageError");
    expect(err.exitCode).toBe(2);
    expect(err.message).toMatch(/missing source qualifier; use '<source>\/<leaf>'/);
  });

  it("qualified-but-missing ref → not found (exit 3), original 'not found' message (no hint)", () => {
    mkSubArtifact(roots.skills, "local", "tdd");
    const err = thrown(() => resolveSources(bundle({ skills: ["local/ghost"] }), { roots }));
    expect(err.name).toBe("NotFoundError");
    expect(err.exitCode).toBe(3);
    expect(err.message).toMatch(/source\(s\) not found: skills\/local\/ghost/);
  });

  it("resolves all artifact kinds independently", () => {
    mkArtifact(roots.skills, "s1");
    mkArtifact(roots.agents, "a1");
    const out = resolveSources(
      bundle({
        skills: ["s1"],
        agents: ["a1"],
      }),
      { roots },
    );
    expect(out.skills.size).toBe(1);
    expect(out.agents.size).toBe(1);
  });

  it("warns when bundle skill name collides with project .claude/skills/", () => {
    mkArtifact(roots.skills, "tdd");
    const projectSkillsDir = join(root, "proj-skills");
    mkdirSync(join(projectSkillsDir, "tdd"), { recursive: true });
    const out = resolveSources(bundle({ skills: ["tdd"] }), {
      roots,
      projectSkillsDir,
    });
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0]).toMatch(/tdd.*project/i);
  });

  it("does not warn when project has no shadowing skill", () => {
    mkArtifact(roots.skills, "tdd");
    const projectSkillsDir = join(root, "proj-skills-empty");
    mkdirSync(projectSkillsDir, { recursive: true });
    const out = resolveSources(bundle({ skills: ["tdd"] }), {
      roots,
      projectSkillsDir,
    });
    expect(out.warnings).toEqual([]);
  });

  describe("store-backed refs", () => {
    // layout: <storeRoot>/github/acme/tools/<commit>/skills/greet/SKILL.md
    const COMMIT = "c".repeat(40);
    const HASH = "d".repeat(64);

    function mkStore(root: string): { storeRoot: string; skillDir: string } {
      const storeRoot = join(root, "store");
      const skillDir = join(storeRoot, "github/acme/tools", COMMIT, "skills/greet");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), "---\nname: greet\n---\n");
      return { storeRoot, skillDir };
    }

    const deps = { tools: "github:acme/tools@v1" };
    const lock = {
      version: 1 as const,
      deps: { tools: { coordinate: "github:acme/tools@v1", commit: COMMIT, contentHash: HASH } },
    };

    it("resolves <alias>/<leaf> through deps + lock + store and records a pin", () => {
      const { storeRoot, skillDir } = mkStore(root);
      const out = resolveSources(bundle({ skills: ["tools/greet"] }), {
        roots,
        store: { deps, lock, root: storeRoot },
      });
      expect(out.skills.get("tools/greet")).toBe(skillDir);
      expect(out.storePins?.get("skills/tools/greet")).toEqual({
        commit: COMMIT,
        contentHash: HASH,
      });
    });

    it("falls back to the pool for refs whose alias is not in deps", () => {
      const { storeRoot } = mkStore(root);
      const poolDir = mkSubArtifact(roots.skills, "local", "tdd");
      const out = resolveSources(bundle({ skills: ["local/tdd"] }), {
        roots,
        store: { deps, lock, root: storeRoot },
      });
      expect(out.skills.get("local/tdd")).toBe(poolDir);
      expect(out.storePins?.has("skills/local/tdd")).toBeFalsy();
    });

    it("errors usefully when the dependency has no lock entry", () => {
      const { storeRoot } = mkStore(root);
      const err = thrown(() =>
        resolveSources(bundle({ skills: ["tools/greet"] }), {
          roots,
          store: { deps, lock: undefined, root: storeRoot },
        }),
      );
      expect(err.name).toBe("UsageError");
      expect(err.message).toMatch(/not locked/);
    });

    it("errors NotFound when the locked checkout is missing from the store", () => {
      const err = thrown(() =>
        resolveSources(bundle({ skills: ["tools/greet"] }), {
          roots,
          store: { deps, lock, root: join(root, "empty-store") },
        }),
      );
      expect(err.name).toBe("NotFoundError");
      expect(err.message).toMatch(/store checkout missing/);
    });

    it("errors NotFound when the leaf is not in the checkout", () => {
      const { storeRoot } = mkStore(root);
      const err = thrown(() =>
        resolveSources(bundle({ skills: ["tools/ghost"] }), {
          roots,
          store: { deps, lock, root: storeRoot },
        }),
      );
      expect(err.name).toBe("NotFoundError");
    });

    it("rejects store-backed non-skill kinds (trust gate pending)", () => {
      const { storeRoot } = mkStore(root);
      const err = thrown(() =>
        resolveSources(bundle({ hooks: ["tools/hook1"] }), {
          roots,
          store: { deps, lock, root: storeRoot },
        }),
      );
      expect(err.name).toBe("UsageError");
      expect(err.message).toMatch(/not supported yet/);
    });
  });
});
