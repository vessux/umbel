import { realpathSync } from "node:fs";
import { join } from "node:path";
import type { Skill } from "../types.ts";
import { readFrontmatter } from "./frontmatter.ts";
import { iterArtifactLeaves } from "./walk.ts";

/**
 * Scan `<root>/<source>/<leaf>/SKILL.md` into typed Skill records.
 * `name` is the qualified `<source>/<leaf>` identifier; `installName` is the
 * canonical (frontmatter `name:` or leaf) used as the destination dir.
 */
export function scanSource(sourceRoot: string): Skill[] {
  const skills: Skill[] = [];
  for (const { source, leaf, dir } of iterArtifactLeaves(sourceRoot, "SKILL.md")) {
    const fm = readFrontmatter(join(dir, "SKILL.md"));
    skills.push({
      name: `${source}/${leaf}`,
      source,
      installName: fm.name ?? leaf,
      sourcePath: realpathSync(dir),
      description: fm.description,
      malformed: fm.malformed,
    });
  }
  skills.sort((a, b) => a.name.localeCompare(b.name));
  return skills;
}
