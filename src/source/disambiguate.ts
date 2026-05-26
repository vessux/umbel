import { resolveCollisions } from "../bundle/collision.ts";
import type { Skill } from "../types.ts";

/**
 * Hold the invariant "installName is unique per skill" across the whole scan.
 * Without this, two qualified refs like `pocock/tdd` and `superpowers/tdd`
 * sharing a frontmatter `name: tdd` would resolve to the same install path
 * and the second seed would silently overwrite the first.
 */
export function disambiguateSkills(skills: Skill[]): Skill[] {
  const items = skills.map((s) => ({
    source: s.source,
    canonical: s.installName,
    skill: s,
  }));
  return resolveCollisions(items).map(({ item, finalName, collides }) =>
    collides ? { ...item.skill, installName: finalName } : item.skill,
  );
}
