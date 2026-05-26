export interface Options {
  target: string | null;
  source: string;
  skills: string[] | null;
  force: boolean;
  dryRun: boolean;
  help: boolean;
  version: boolean;
}

export interface Skill {
  /** Qualified ref `<source>/<leaf>`; the identity used in manifests and `--skills`. */
  name: string;
  /** Source subfolder segment (e.g. `superpowers` in `superpowers/tdd`). */
  source: string;
  /** Canonical name for `<project>/.claude/skills/<installName>/` (frontmatter `name:` or leaf). */
  installName: string;
  sourcePath: string;
  description: string | null;
  malformed: boolean;
}

export type SkillState =
  | { kind: "absent" }
  | { kind: "linked-correct" }
  | { kind: "linked-wrong" }
  | { kind: "real"; isDirectory: boolean }
  | { kind: "malformed" };

export interface SkillRow {
  skill: Skill;
  state: SkillState;
  defaultChecked: boolean;
  toggleable: boolean;
}

export type TargetKind = "claude" | "generic" | "custom";

export interface Target {
  kind: TargetKind;
  path: string;
}

export type PlanAction = "install" | "relink" | "remove" | "replace";

export interface PlanEntry {
  action: PlanAction;
  skill: Skill;
  targetPath: string;
  backupPath?: string;
}

export interface Plan {
  target: Target;
  entries: PlanEntry[];
}

export interface Capabilities {
  color: boolean;
  unicode: boolean;
  interactive: boolean;
}
