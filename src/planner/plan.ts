import { existsSync } from "node:fs";
import { join } from "node:path";
import { ConflictError, NotFoundError } from "../errors.ts";
import type { Plan, PlanEntry, SkillRow, Target } from "../types.ts";

export interface BuildPlanOptions {
  force: boolean;
  now?: Date;
}

function backupName(targetPath: string, now: Date): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const ts =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}T` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  let candidate = `${targetPath}.bak-${ts}`;
  let n = 0;
  while (existsSync(candidate)) {
    n += 1;
    candidate = `${targetPath}.bak-${ts}-${n}`;
  }
  return candidate;
}

export function buildPlan(
  rows: SkillRow[],
  selection: Set<string>,
  target: Target,
  options: BuildPlanOptions,
): Plan {
  const byName = new Map(rows.map((r) => [r.skill.name, r]));

  // Validate explicit selections reference known skills.
  for (const name of selection) {
    if (!byName.has(name)) {
      if (!name.includes("/")) {
        throw new NotFoundError(
          `artifact ref '${name}' missing source qualifier; use '<source>/<leaf>'`,
        );
      }
      throw new NotFoundError(`skill not found in source: ${name}`);
    }
  }

  const now = options.now ?? new Date();
  const entries: PlanEntry[] = [];

  for (const row of rows) {
    const { skill, state } = row;
    const checked = selection.has(skill.name);
    // Selection / display uses qualified `<source>/<leaf>` (skill.name);
    // on-disk install uses canonical `installName` (matches CC's expected
    // `<project>/.claude/skills/<name>/` shape).
    const targetPath = join(target.path, skill.installName);

    switch (state.kind) {
      case "absent":
        if (checked) {
          entries.push({ action: "install", skill, targetPath });
        }
        break;
      case "linked-correct":
        if (!checked) {
          entries.push({ action: "remove", skill, targetPath });
        }
        break;
      case "linked-wrong":
        if (checked) {
          entries.push({ action: "relink", skill, targetPath });
        } else {
          entries.push({ action: "remove", skill, targetPath });
        }
        break;
      case "real":
        if (checked) {
          if (!options.force) {
            throw new ConflictError(
              `${targetPath} is a real ${state.isDirectory ? "directory" : "file"}; rerun with --force to back it up and replace`,
            );
          }
          entries.push({
            action: "replace",
            skill,
            targetPath,
            backupPath: backupName(targetPath, now),
          });
        }
        break;
      case "malformed":
        if (checked) {
          entries.push({ action: "install", skill, targetPath });
        }
        break;
    }
  }

  // Stable order: removes first, then relinks, then replaces, then installs.
  // Spec says ordering is not strictly required but this makes dry-run output predictable.
  const order: Record<PlanEntry["action"], number> = {
    remove: 0,
    relink: 1,
    replace: 2,
    install: 3,
  };
  entries.sort((a, b) => {
    const d = order[a.action] - order[b.action];
    return d !== 0 ? d : a.skill.name.localeCompare(b.skill.name);
  });

  return { target, entries };
}
