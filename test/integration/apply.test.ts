import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyPlan } from "../../src/applier/apply.ts";
import { buildPlan } from "../../src/planner/plan.ts";
import { disambiguateSkills } from "../../src/source/disambiguate.ts";
import { scanSource } from "../../src/source/scan.ts";
import { probeAll } from "../../src/state/probe.ts";
import type { Plan, Target } from "../../src/types.ts";
import { buildSourceTree, cleanup, makeTmpDir } from "../helpers/tmp.ts";

function planFor(source: string, targetPath: string, selection: string[], force = false): Plan {
  const skills = disambiguateSkills(scanSource(source));
  const target: Target = { kind: "custom", path: targetPath };
  const rows = probeAll(skills, target.path, force);
  return buildPlan(rows, new Set(selection), target, {
    force,
    now: new Date("2026-04-22T10:00:00Z"),
  });
}

describe("applyPlan", () => {
  let root: string;
  let source: string;
  let target: string;

  beforeEach(() => {
    root = makeTmpDir();
    source = join(root, "src");
    target = join(root, "tgt");
    mkdirSync(source, { recursive: true });
    buildSourceTree(source, [
      { name: "tdd", source: "pocock", description: "t" },
      { name: "review", source: "pocock", description: "r" },
    ]);
  });
  afterEach(() => {
    cleanup(root);
  });

  // Qualified ref `pocock/tdd` resolves to source dir `<source>/pocock/tdd`
  // and installs flat at `<target>/tdd` (installName from frontmatter = leaf).
  const TDD_REF = "pocock/tdd";

  it("install: creates absolute symlink to realpath of source", () => {
    const plan = planFor(source, target, [TDD_REF]);
    applyPlan(plan);
    const link = join(target, "tdd");
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readlinkSync(link)).toBe(join(source, "pocock", "tdd"));
  });

  it("install: creates target parent dir with mkdir -p", () => {
    expect(existsSync(target)).toBe(false);
    const plan = planFor(source, target, [TDD_REF]);
    applyPlan(plan);
    expect(existsSync(target)).toBe(true);
  });

  it("relink: unlinks old symlink and points to current source", () => {
    mkdirSync(target);
    const oldSource = join(root, "old-source", "tdd");
    mkdirSync(oldSource, { recursive: true });
    symlinkSync(oldSource, join(target, "tdd"));
    const plan = planFor(source, target, [TDD_REF]);
    applyPlan(plan);
    expect(readlinkSync(join(target, "tdd"))).toBe(join(source, "pocock", "tdd"));
  });

  it("remove: deletes a correct symlink when skill is unchecked", () => {
    mkdirSync(target);
    symlinkSync(join(source, "pocock", "tdd"), join(target, "tdd"));
    // Selection empty → correct symlink should be removed.
    const plan = planFor(source, target, []);
    applyPlan(plan);
    expect(existsSync(join(target, "tdd"))).toBe(false);
  });

  it("replace with --force: backs up real dir to .bak-<ts>, creates symlink", () => {
    mkdirSync(target);
    mkdirSync(join(target, "tdd"));
    writeFileSync(join(target, "tdd", "manual.txt"), "user-written");
    const plan = planFor(source, target, [TDD_REF], true);
    applyPlan(plan);
    const link = join(target, "tdd");
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    const backup = plan.entries[0]!.backupPath!;
    expect(backup).toMatch(/\.bak-20260422T/);
    expect(readFileSync(join(backup, "manual.txt"), "utf8")).toBe("user-written");
  });

  it("idempotent: re-running same plan is a no-op", () => {
    applyPlan(planFor(source, target, [TDD_REF]));
    const rerun = planFor(source, target, [TDD_REF]);
    expect(rerun.entries).toEqual([]);
  });

  it("empty plan does not create target dir", () => {
    const plan: Plan = { target: { kind: "custom", path: target }, entries: [] };
    applyPlan(plan);
    expect(existsSync(target)).toBe(false);
  });

  it("collision: two selected skills sharing canonical name install at source-prefixed paths", () => {
    // Second source with a `tdd` colliding on frontmatter `name:` with pocock/tdd.
    buildSourceTree(source, [{ name: "tdd", source: "superpowers", description: "sp" }]);
    const plan = planFor(source, target, ["pocock/tdd", "superpowers/tdd"]);
    applyPlan(plan);
    // No bare `tdd/` — both colliding entries get source-prefixed.
    expect(existsSync(join(target, "tdd"))).toBe(false);
    // Each colliding entry lands under its disambiguated path, pointing at its source.
    expect(readlinkSync(join(target, "pocock-tdd"))).toBe(join(source, "pocock", "tdd"));
    expect(readlinkSync(join(target, "superpowers-tdd"))).toBe(join(source, "superpowers", "tdd"));
  });

  it("collision: re-running with both selected is idempotent (no EEXIST on second apply)", () => {
    buildSourceTree(source, [{ name: "tdd", source: "superpowers", description: "sp" }]);
    applyPlan(planFor(source, target, ["pocock/tdd", "superpowers/tdd"]));
    const rerun = planFor(source, target, ["pocock/tdd", "superpowers/tdd"]);
    expect(rerun.entries).toEqual([]);
  });

  it("collision: with only one of the pair selected, the unselected sibling does not strand the install", () => {
    buildSourceTree(source, [{ name: "tdd", source: "superpowers", description: "sp" }]);
    applyPlan(planFor(source, target, ["pocock/tdd"]));
    expect(readlinkSync(join(target, "pocock-tdd"))).toBe(join(source, "pocock", "tdd"));
    expect(existsSync(join(target, "superpowers-tdd"))).toBe(false);
    // Re-running with the same selection — still idempotent, pocock still installed.
    const rerun = planFor(source, target, ["pocock/tdd"]);
    expect(rerun.entries).toEqual([]);
    expect(readlinkSync(join(target, "pocock-tdd"))).toBe(join(source, "pocock", "tdd"));
  });
});
