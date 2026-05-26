import type { SkillState } from "../types.ts";

type StateKind = SkillState["kind"];

// Unicode: [ ] / [●] / [⚠] / [✖] / [?]
const UNICODE: Record<StateKind, string> = {
  absent: " ",
  "linked-correct": "●",
  "linked-wrong": "⚠",
  real: "✖",
  malformed: "?",
};

// ASCII fallback: [ ] / [*] / [!] / [X] / [?]
const ASCII: Record<StateKind, string> = {
  absent: " ",
  "linked-correct": "*",
  "linked-wrong": "!",
  real: "X",
  malformed: "?",
};

export function iconFor(kind: StateKind, unicode: boolean): string {
  return (unicode ? UNICODE : ASCII)[kind];
}
