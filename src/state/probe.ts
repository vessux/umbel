import { lstatSync, realpathSync } from "node:fs";
import { join } from "node:path";
import type { Skill, SkillRow, SkillState } from "../types.ts";

export function probeSkillState(skill: Skill, targetParent: string): SkillState {
  if (skill.malformed) return { kind: "malformed" };

  const targetPath = join(targetParent, skill.installName);

  let lst: ReturnType<typeof lstatSync>;
  try {
    lst = lstatSync(targetPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { kind: "absent" };
    throw err;
  }

  if (lst.isSymbolicLink()) {
    let resolved: string | null;
    try {
      resolved = realpathSync(targetPath);
    } catch {
      resolved = null;
    }
    return resolved === skill.sourcePath ? { kind: "linked-correct" } : { kind: "linked-wrong" };
  }

  return { kind: "real", isDirectory: lst.isDirectory() };
}

export function probeAll(skills: Skill[], targetParent: string, force: boolean): SkillRow[] {
  return skills.map((s) => buildRow(s, probeSkillState(s, targetParent), force));
}

function buildRow(skill: Skill, state: SkillState, force: boolean): SkillRow {
  const defaultChecked = state.kind === "linked-correct" || state.kind === "linked-wrong";
  const toggleable = state.kind !== "real" || force;
  return { skill, state, defaultChecked, toggleable };
}
