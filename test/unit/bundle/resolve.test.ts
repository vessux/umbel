import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ResolvedBundle } from "../../../src/bundle/compose.ts";
import { resolveSources } from "../../../src/bundle/resolve.ts";
import { cleanup, makeTmpDir } from "../../helpers/tmp.ts";

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

  it("bare ref (no '/') in manifest → hints at missing source qualifier", () => {
    mkSubArtifact(roots.skills, "local", "tdd");
    expect(() => resolveSources(bundle({ skills: ["tdd"] }), { roots })).toThrow(
      /missing source qualifier; use '<source>\/<leaf>'/,
    );
  });

  it("qualified-but-missing ref → original 'not found' message (no hint)", () => {
    mkSubArtifact(roots.skills, "local", "tdd");
    expect(() => resolveSources(bundle({ skills: ["local/ghost"] }), { roots })).toThrow(
      /source\(s\) not found: skills\/local\/ghost/,
    );
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
});
