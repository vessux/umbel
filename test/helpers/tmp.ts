import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export function makeTmpDir(prefix = "umbel-"): string {
  // realpath to normalize macOS /var → /private/var so string comparison works in tests.
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

export function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

export function writeFile(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

export interface SkillFixture {
  /** Leaf dir name under the source subfolder; also the default frontmatter name. */
  name: string;
  /** Source subfolder this skill lives under; defaults to "test". */
  source?: string;
  description?: string;
  malformedFrontmatter?: boolean;
  noSkillMd?: boolean;
  extraFiles?: Record<string, string>;
}

/**
 * Build a subfoldered skills source tree at `<root>/<source>/<leaf>/SKILL.md`.
 * Default source subfolder is "test"; pass `source` on a fixture to override.
 */
export function buildSourceTree(root: string, skills: SkillFixture[]): void {
  for (const s of skills) {
    const source = s.source ?? "test";
    const dir = join(root, source, s.name);
    mkdirSync(dir, { recursive: true });
    if (!s.noSkillMd) {
      let content: string;
      if (s.malformedFrontmatter) {
        // Unterminated flow mapping → gray-matter throws.
        content = "---\nname: {unterminated\ndescription: [also-bad\n---\nbody\n";
      } else if (s.description !== undefined) {
        content = `---\nname: ${s.name}\ndescription: ${s.description}\n---\nbody\n`;
      } else {
        content = `---\nname: ${s.name}\n---\nbody\n`;
      }
      writeFileSync(join(dir, "SKILL.md"), content);
    }
    if (s.extraFiles) {
      for (const [rel, c] of Object.entries(s.extraFiles)) {
        writeFile(join(dir, rel), c);
      }
    }
  }
}
