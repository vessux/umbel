import type { Capabilities, SkillRow, SkillState } from "../types.ts";
import { type Theme, makeTheme } from "./colors.ts";
import { iconFor } from "./icons.ts";

export interface RenderedRow {
  /** Full line to show in the picker. */
  label: string;
  /** Skill name (used as the checkbox value). */
  name: string;
  /** Whether the checkbox is pre-checked. */
  checked: boolean;
  /** Disabled reason — present (string) iff the row is not toggleable. */
  disabled?: string;
}

function colorIcon(state: SkillState, icon: string, theme: Theme): string {
  switch (state.kind) {
    case "linked-correct":
      return theme.green(icon);
    case "linked-wrong":
      return theme.yellow(icon);
    case "real":
      return theme.red(icon);
    case "malformed":
      return theme.brightBlack(icon);
    case "absent":
      return icon;
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1))}…`;
}

export function renderSkillRow(row: SkillRow, caps: Capabilities, termWidth: number): RenderedRow {
  const theme = makeTheme({ color: caps.color });
  // clack's own ○/◉ already conveys selection. Show a status icon only when
  // it adds information beyond "selected or not":
  //   absent & linked-correct → blank (selection alone is unambiguous)
  //   linked-wrong / real / malformed → bare colored icon
  const showStatus = row.state.kind !== "absent" && row.state.kind !== "linked-correct";
  const statusField = showStatus
    ? colorIcon(row.state, iconFor(row.state.kind, caps.unicode), theme)
    : " ";
  const nameField = row.skill.name.padEnd(12);
  const desc =
    row.skill.description ??
    (row.state.kind === "malformed" ? "(malformed SKILL.md)" : "(no description)");
  // Reserve ~24 chars for the prefix "<icon>  <name>  " plus checkbox chrome.
  const descWidth = Math.max(10, termWidth - 28);
  const truncated = truncate(desc, descWidth);
  const descColored = row.state.kind === "malformed" ? theme.brightBlack(truncated) : truncated;
  const label = `${statusField} ${nameField} ${descColored}`;

  const out: RenderedRow = { label, name: row.skill.name, checked: row.defaultChecked };
  if (!row.toggleable) out.disabled = "real dir (rerun with --force)";
  return out;
}
