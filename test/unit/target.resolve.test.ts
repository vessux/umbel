import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveInteractiveTargets } from "../../src/target/resolve.ts";
import { cleanup, makeTmpDir } from "../helpers/tmp.ts";

describe("resolveInteractiveTargets", () => {
  let root: string;
  beforeEach(() => {
    root = makeTmpDir();
  });
  afterEach(() => {
    cleanup(root);
  });

  it("returns generic-only when .claude is not found", () => {
    const deep = join(root, "x");
    mkdirSync(deep);
    const choices = resolveInteractiveTargets(deep, "/home/u");
    expect(choices).toHaveLength(1);
    expect(choices[0]!.kind).toBe("generic");
    expect(choices[0]!.path).toBe(join(deep, "skills"));
  });

  it("returns detected claude first when .claude exists", () => {
    const proj = join(root, "proj");
    mkdirSync(join(proj, ".claude"), { recursive: true });
    const choices = resolveInteractiveTargets(proj, "/home/u");
    expect(choices).toHaveLength(2);
    expect(choices[0]!.kind).toBe("claude");
    expect(choices[0]!.path).toBe(join(proj, ".claude", "skills"));
    expect(choices[1]!.kind).toBe("generic");
  });
});
