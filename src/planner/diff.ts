import type { Plan, PlanAction } from "../types.ts";

const SIGIL: Record<PlanAction, string> = {
  install: "+",
  remove: "-",
  relink: "~",
  replace: "!",
};

const VERB: Record<PlanAction, string> = {
  install: "install",
  remove: "remove ",
  relink: "relink ",
  replace: "replace",
};

export interface DiffStyle {
  color: boolean;
}

// Only 16 themeable ANSI colors, no dim.
const ANSI_CODE: Record<PlanAction, number> = {
  install: 32, // green
  remove: 31, // red
  relink: 33, // yellow
  replace: 35, // magenta
};

function colorFor(action: PlanAction, color: boolean, s: string): string {
  if (!color) return s;
  return `\x1b[${ANSI_CODE[action]}m${s}\x1b[0m`;
}

export function renderPlanDiff(plan: Plan, style: DiffStyle = { color: false }): string {
  if (plan.entries.length === 0) {
    return "  (no changes)";
  }
  const lines: string[] = [];
  for (const entry of plan.entries) {
    const head = `  ${SIGIL[entry.action]} ${VERB[entry.action]}  ${entry.skill.name}`;
    let line = colorFor(entry.action, style.color, head);
    if (entry.action === "replace" && entry.backupPath) {
      line += `  (backup → ${entry.backupPath})`;
    }
    lines.push(line);
  }
  return lines.join("\n");
}
