import { join } from "node:path";
import type { Target } from "../types.ts";
import { findClaudeSkillsDir } from "./walk.ts";

export interface TargetChoice {
  label: string;
  path: string;
  kind: Target["kind"];
}

/**
 * Build the ordered list of target options to present in the interactive
 * target prompt. The first entry is the one pre-selected.
 */
export function resolveInteractiveTargets(cwd: string, home: string): TargetChoice[] {
  const detected = findClaudeSkillsDir(cwd, home);
  const generic: TargetChoice = {
    label: "./skills/                      (generic / sandbox bundle)",
    path: join(cwd, "skills"),
    kind: "generic",
  };

  if (detected) {
    return [
      {
        label: `${detected}   (Claude Code project)`,
        path: detected,
        kind: "claude",
      },
      generic,
    ];
  }
  return [generic];
}

export function targetFromOverride(absPath: string): Target {
  return { kind: "custom", path: absPath };
}
