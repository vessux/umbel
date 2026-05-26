import { describe, expect, it } from "vitest";
import { ConflictError, NotFoundError } from "../../src/errors.ts";
import { buildPlan } from "../../src/planner/plan.ts";
import type { Skill, SkillRow, SkillState, Target } from "../../src/types.ts";

const TARGET: Target = { kind: "custom", path: "/tgt" };

function skill(name: string, malformed = false): Skill {
  const [source = ""] = name.split("/");
  return {
    name,
    source,
    installName: name,
    sourcePath: `/src/${name}`,
    description: "d",
    malformed,
  };
}

function row(name: string, state: SkillState, force = false): SkillRow {
  const s = skill(name, state.kind === "malformed");
  const defaultChecked = state.kind === "linked-correct" || state.kind === "linked-wrong";
  const toggleable = state.kind !== "real" || force;
  return { skill: s, state, defaultChecked, toggleable };
}

const NOW = new Date("2026-04-22T10:00:00Z");

describe("buildPlan action table", () => {
  it("absent + checked = install", () => {
    const plan = buildPlan([row("a", { kind: "absent" })], new Set(["a"]), TARGET, {
      force: false,
      now: NOW,
    });
    expect(plan.entries).toEqual([{ action: "install", skill: skill("a"), targetPath: "/tgt/a" }]);
  });

  it("absent + unchecked = no-op", () => {
    const plan = buildPlan([row("a", { kind: "absent" })], new Set(), TARGET, {
      force: false,
      now: NOW,
    });
    expect(plan.entries).toEqual([]);
  });

  it("linked-correct + checked = no-op", () => {
    const plan = buildPlan([row("a", { kind: "linked-correct" })], new Set(["a"]), TARGET, {
      force: false,
      now: NOW,
    });
    expect(plan.entries).toEqual([]);
  });

  it("linked-correct + unchecked = remove", () => {
    const plan = buildPlan([row("a", { kind: "linked-correct" })], new Set(), TARGET, {
      force: false,
      now: NOW,
    });
    expect(plan.entries[0]!.action).toBe("remove");
  });

  it("linked-wrong + checked = relink", () => {
    const plan = buildPlan([row("a", { kind: "linked-wrong" })], new Set(["a"]), TARGET, {
      force: false,
      now: NOW,
    });
    expect(plan.entries[0]!.action).toBe("relink");
  });

  it("linked-wrong + unchecked = remove", () => {
    const plan = buildPlan([row("a", { kind: "linked-wrong" })], new Set(), TARGET, {
      force: false,
      now: NOW,
    });
    expect(plan.entries[0]!.action).toBe("remove");
  });

  it("real + checked without --force → ConflictError", () => {
    expect(() =>
      buildPlan([row("a", { kind: "real", isDirectory: true })], new Set(["a"]), TARGET, {
        force: false,
        now: NOW,
      }),
    ).toThrow(ConflictError);
  });

  it("real + checked with --force = replace + backup path", () => {
    const plan = buildPlan(
      [row("a", { kind: "real", isDirectory: true }, true)],
      new Set(["a"]),
      TARGET,
      { force: true, now: NOW },
    );
    const e = plan.entries[0]!;
    expect(e.action).toBe("replace");
    expect(e.backupPath).toMatch(/\.bak-20260422T/);
  });

  it("real + unchecked = no-op (even without force)", () => {
    const plan = buildPlan([row("a", { kind: "real", isDirectory: true })], new Set(), TARGET, {
      force: false,
      now: NOW,
    });
    expect(plan.entries).toEqual([]);
  });

  it("malformed + checked = install", () => {
    const plan = buildPlan([row("a", { kind: "malformed" })], new Set(["a"]), TARGET, {
      force: false,
      now: NOW,
    });
    expect(plan.entries[0]!.action).toBe("install");
  });

  it("unknown skill in selection → NotFoundError", () => {
    expect(() =>
      buildPlan([row("a", { kind: "absent" })], new Set(["local/ghost"]), TARGET, {
        force: false,
        now: NOW,
      }),
    ).toThrow(NotFoundError);
  });

  it("bare ref (no '/') → NotFoundError hints at missing source qualifier", () => {
    expect(() =>
      buildPlan([row("local/tdd", { kind: "absent" })], new Set(["tdd"]), TARGET, {
        force: false,
        now: NOW,
      }),
    ).toThrow(/missing source qualifier; use '<source>\/<leaf>'/);
  });

  it("qualified-but-missing ref → original 'not found' message (no hint)", () => {
    expect(() =>
      buildPlan([row("local/tdd", { kind: "absent" })], new Set(["local/ghost"]), TARGET, {
        force: false,
        now: NOW,
      }),
    ).toThrow(/skill not found in source: local\/ghost/);
  });

  it("orders entries: removes, relinks, replaces, installs", () => {
    const plan = buildPlan(
      [
        row("install-me", { kind: "absent" }),
        row("remove-me", { kind: "linked-correct" }),
        row("relink-me", { kind: "linked-wrong" }),
        row("replace-me", { kind: "real", isDirectory: true }, true),
      ],
      new Set(["install-me", "relink-me", "replace-me"]),
      TARGET,
      { force: true, now: NOW },
    );
    expect(plan.entries.map((e) => e.action)).toEqual(["remove", "relink", "replace", "install"]);
  });
});
