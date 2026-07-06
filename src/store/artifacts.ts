import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Tracer-scope skill scan: `skills/<leaf>/SKILL.md` (a skills tree) and
 * `<leaf>/SKILL.md` (repo of skill dirs). The full shape auto-detection
 * (lone SKILL.md, .claude-plugin, frameworks) is the adopt/try slice.
 */
export function listSkillLeaves(checkoutDir: string): Map<string, string> {
  const out = new Map<string, string>();
  // skills/ is scanned second so it overwrites a same-named root entry —
  // the skills/ tree wins when both exist.
  for (const base of [checkoutDir, join(checkoutDir, "skills")]) {
    let entries: string[];
    try {
      entries = readdirSync(base);
    } catch {
      continue;
    }
    for (const name of entries.sort()) {
      const dir = join(base, name);
      if (existsSync(join(dir, "SKILL.md"))) out.set(name, dir);
    }
  }
  return out;
}

export function skillDirIn(checkoutDir: string, leaf: string): string | null {
  return listSkillLeaves(checkoutDir).get(leaf) ?? null;
}
