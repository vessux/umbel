import { ApplyError } from "../errors.ts";
import type { Plan, PlanEntry } from "../types.ts";
import { ensureDir, moveToBackup, symlinkAbsolute, unlinkPath } from "./fsops.ts";

export function applyPlan(plan: Plan): void {
  if (plan.entries.length === 0) return;
  ensureDir(plan.target.path);

  for (const entry of plan.entries) {
    try {
      applyEntry(entry);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ApplyError(`failed to ${entry.action} ${entry.skill.name}: ${msg}`);
    }
  }
}

function applyEntry(entry: PlanEntry): void {
  switch (entry.action) {
    case "remove":
      unlinkPath(entry.targetPath);
      return;
    case "relink":
      unlinkPath(entry.targetPath);
      symlinkAbsolute(entry.skill.sourcePath, entry.targetPath);
      return;
    case "replace":
      if (!entry.backupPath) {
        throw new ApplyError("replace entry missing backupPath");
      }
      moveToBackup(entry.targetPath, entry.backupPath);
      symlinkAbsolute(entry.skill.sourcePath, entry.targetPath);
      return;
    case "install":
      symlinkAbsolute(entry.skill.sourcePath, entry.targetPath);
      return;
  }
}
