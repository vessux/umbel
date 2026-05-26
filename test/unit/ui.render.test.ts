import { describe, expect, it } from "vitest";
import type { Capabilities, Skill, SkillRow, SkillState } from "../../src/types.ts";
import { renderSkillRow } from "../../src/ui/render.ts";

const CAPS_PLAIN: Capabilities = { color: false, unicode: true, interactive: true };
const CAPS_ASCII: Capabilities = { color: false, unicode: false, interactive: true };
const CAPS_COLOR: Capabilities = { color: true, unicode: true, interactive: true };

function sk(name: string, description: string | null = "desc", malformed = false): Skill {
  const [source = ""] = name.split("/");
  return {
    name,
    source,
    installName: name,
    sourcePath: `/src/${name}`,
    description,
    malformed,
  };
}

function row(skill: Skill, state: SkillState, toggleable = true): SkillRow {
  const defaultChecked = state.kind === "linked-correct" || state.kind === "linked-wrong";
  return { skill, state, defaultChecked, toggleable };
}

describe("renderSkillRow", () => {
  it("absent + Unicode + no color → blank status (space prefix)", () => {
    const r = renderSkillRow(row(sk("tdd"), { kind: "absent" }), CAPS_PLAIN, 80);
    expect(r.label).toMatch(/^ {2}tdd\s+desc$/);
    expect(r.checked).toBe(false);
    expect(r.disabled).toBeUndefined();
  });

  it("linked-correct defaults to checked; status icon is blank (inquirer's ◉ carries the signal)", () => {
    const r = renderSkillRow(row(sk("tdd"), { kind: "linked-correct" }), CAPS_PLAIN, 80);
    expect(r.label).toMatch(/^ {2}tdd/);
    expect(r.checked).toBe(true);
  });

  it("linked-wrong renders bare ⚠ icon (no brackets)", () => {
    const r = renderSkillRow(row(sk("tdd"), { kind: "linked-wrong" }), CAPS_PLAIN, 80);
    expect(r.label).toMatch(/^⚠ tdd/);
    expect(r.checked).toBe(true);
  });

  it("ASCII fallback for real state uses X", () => {
    const r = renderSkillRow(
      row(sk("tdd"), { kind: "real", isDirectory: true }, false),
      CAPS_ASCII,
      80,
    );
    expect(r.label).toMatch(/^X tdd/);
    expect(r.disabled).toBeDefined();
  });

  it("real + non-toggleable → disabled with hint", () => {
    const r = renderSkillRow(
      row(sk("tdd"), { kind: "real", isDirectory: true }, false),
      CAPS_PLAIN,
      80,
    );
    expect(r.disabled).toContain("--force");
  });

  it("malformed uses (malformed SKILL.md) description and ? icon", () => {
    const r = renderSkillRow(row(sk("broken", null, true), { kind: "malformed" }), CAPS_PLAIN, 80);
    expect(r.label).toMatch(/^\? broken/);
    expect(r.label).toContain("malformed SKILL.md");
  });

  it("color theme emits no ANSI for linked-correct (icon hidden)", () => {
    const r = renderSkillRow(row(sk("tdd"), { kind: "linked-correct" }), CAPS_COLOR, 80);
    expect(r.label).not.toContain("\x1b[");
  });

  it("color theme emits yellow for linked-wrong icon", () => {
    const r = renderSkillRow(row(sk("tdd"), { kind: "linked-wrong" }), CAPS_COLOR, 80);
    expect(r.label).toContain("\x1b[33m");
  });

  it("truncates long descriptions to available width", () => {
    const longDesc = "x".repeat(300);
    const r = renderSkillRow(row(sk("tdd", longDesc), { kind: "absent" }), CAPS_PLAIN, 60);
    // label ≤ ~60 chars plus a truncation marker.
    expect(r.label.length).toBeLessThan(80);
    expect(r.label).toContain("…");
  });

  it("NO_COLOR + non-Unicode combined → ASCII icon, no SGR", () => {
    const caps: Capabilities = { color: false, unicode: false, interactive: true };
    const r = renderSkillRow(row(sk("tdd"), { kind: "linked-wrong" }), caps, 80);
    expect(r.label).not.toContain("\x1b[");
    expect(r.label).toMatch(/^! tdd/);
  });
});
