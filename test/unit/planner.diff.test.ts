import { describe, expect, it } from "vitest";
import { renderPlanDiff } from "../../src/planner/diff.ts";
import type { Plan, Skill } from "../../src/types.ts";

const TARGET = { kind: "custom" as const, path: "/tgt" };

function sk(name: string): Skill {
  const [source = ""] = name.split("/");
  return {
    name,
    source,
    installName: name,
    sourcePath: `/src/${name}`,
    description: "d",
    malformed: false,
  };
}

describe("renderPlanDiff", () => {
  it("renders all four action kinds without color", () => {
    const plan: Plan = {
      target: TARGET,
      entries: [
        { action: "remove", skill: sk("tdd"), targetPath: "/tgt/tdd" },
        { action: "relink", skill: sk("review"), targetPath: "/tgt/review" },
        {
          action: "replace",
          skill: sk("polish"),
          targetPath: "/tgt/polish",
          backupPath: "/tgt/polish.bak-20260422T100000",
        },
        { action: "install", skill: sk("grill-me"), targetPath: "/tgt/grill-me" },
      ],
    };
    expect(renderPlanDiff(plan, { color: false })).toMatchInlineSnapshot(`
      "  - remove   tdd
        ~ relink   review
        ! replace  polish  (backup → /tgt/polish.bak-20260422T100000)
        + install  grill-me"
    `);
  });

  it("empty plan renders (no changes)", () => {
    expect(renderPlanDiff({ target: TARGET, entries: [] }, { color: false })).toBe(
      "  (no changes)",
    );
  });

  it("color on emits ANSI escapes", () => {
    const plan: Plan = {
      target: TARGET,
      entries: [{ action: "install", skill: sk("a"), targetPath: "/tgt/a" }],
    };
    expect(renderPlanDiff(plan, { color: true })).toContain("\x1b[32m");
    expect(renderPlanDiff(plan, { color: true })).toContain("\x1b[0m");
  });
});
