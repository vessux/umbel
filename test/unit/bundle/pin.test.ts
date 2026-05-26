import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findProjectRoot, readPin, removePin, writePin } from "../../../src/bundle/pin.ts";
import { cleanup, makeTmpDir } from "../../helpers/tmp.ts";

describe("pin file", () => {
  let project: string;
  let home: string;

  beforeEach(() => {
    home = makeTmpDir("home-");
    project = makeTmpDir("project-");
    mkdirSync(join(project, ".claude"), { recursive: true });
  });
  afterEach(() => {
    cleanup(home);
    cleanup(project);
  });

  it("writes a pin file at <project>/.umbel-bundle with trailing newline", () => {
    const path = writePin(project, home, "data-science");
    expect(path).toBe(join(project, ".umbel-bundle"));
    expect(readFileSync(path, "utf8")).toBe("data-science\n");
  });

  it("reads back the pinned name", () => {
    writePin(project, home, "x");
    expect(readPin(project, home)).toEqual({
      name: "x",
      path: join(project, ".umbel-bundle"),
    });
  });

  it("returns null when no pin file exists", () => {
    expect(readPin(project, home)).toBeNull();
  });

  it("walks up from a subdirectory to the project root for read", () => {
    writePin(project, home, "x");
    const sub = join(project, "src", "deep");
    mkdirSync(sub, { recursive: true });
    expect(readPin(sub, home)?.name).toBe("x");
  });

  it("removePin removes the file and returns true", () => {
    writePin(project, home, "x");
    expect(removePin(project, home)).toBe(true);
    expect(existsSync(join(project, ".umbel-bundle"))).toBe(false);
  });

  it("removePin returns false when no pin exists", () => {
    expect(removePin(project, home)).toBe(false);
  });

  it("findProjectRoot returns the dir containing .claude/", () => {
    const sub = join(project, "src", "deep");
    mkdirSync(sub, { recursive: true });
    expect(findProjectRoot(sub, home)).toBe(project);
  });

  it("findProjectRoot returns null when no .claude/ ancestor", () => {
    const standalone = makeTmpDir("standalone-");
    try {
      expect(findProjectRoot(standalone, home)).toBeNull();
    } finally {
      cleanup(standalone);
    }
  });
});
