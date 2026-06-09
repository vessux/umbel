import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  findProjectRoot,
  parsePin,
  readPin,
  removePin,
  writePin,
  writeVanillaPin,
} from "../../../src/bundle/pin.ts";
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
      kind: "bundle",
      name: "x",
      path: join(project, ".umbel-bundle"),
    });
  });

  it("returns null when no pin file exists", () => {
    expect(readPin(project, home)).toBeNull();
  });

  it("returns null when pin file is empty", () => {
    writePin(project, home, "");
    expect(readPin(project, home)).toBeNull();
  });

  it("walks up from a subdirectory to the project root for read", () => {
    writePin(project, home, "x");
    const sub = join(project, "src", "deep");
    mkdirSync(sub, { recursive: true });
    const r = readPin(sub, home);
    expect(r?.kind === "bundle" ? r.name : null).toBe("x");
  });

  it("writeVanillaPin writes the sentinel and readPin returns vanilla", () => {
    const path = writeVanillaPin(project, home);
    expect(path).toBe(join(project, ".umbel-bundle"));
    expect(readFileSync(path, "utf8")).toBe("__vanilla__\n");
    expect(readPin(project, home)).toEqual({
      kind: "vanilla",
      path,
    });
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

describe("parsePin", () => {
  it("single name is one bundle candidate (byte-compatible with old pins)", () => {
    expect(parsePin("data-science\n")).toEqual({
      kind: "candidates",
      candidates: [{ kind: "bundle", name: "data-science" }],
    });
  });

  it("empty / whitespace-only file is absent", () => {
    expect(parsePin("")).toEqual({ kind: "absent" });
    expect(parsePin("   \n\t\n")).toEqual({ kind: "absent" });
  });

  it("multiple lines become an ordered candidate list", () => {
    expect(parsePin("discovery\ndelivery\n")).toEqual({
      kind: "candidates",
      candidates: [
        { kind: "bundle", name: "discovery" },
        { kind: "bundle", name: "delivery" },
      ],
    });
  });

  it("strips full-line and inline trailing # comments", () => {
    expect(parsePin("# why these two\ndiscovery  # primary\ndelivery # secondary\n")).toEqual({
      kind: "candidates",
      candidates: [
        { kind: "bundle", name: "discovery" },
        { kind: "bundle", name: "delivery" },
      ],
    });
  });

  it("skips blank and whitespace-only lines, trims each candidate", () => {
    expect(parsePin("\n  discovery  \n\n   \n delivery\n")).toEqual({
      kind: "candidates",
      candidates: [
        { kind: "bundle", name: "discovery" },
        { kind: "bundle", name: "delivery" },
      ],
    });
  });

  it("dedupes preserving first occurrence", () => {
    expect(parsePin("a\nb\na\n")).toEqual({
      kind: "candidates",
      candidates: [
        { kind: "bundle", name: "a" },
        { kind: "bundle", name: "b" },
      ],
    });
  });

  it("__vanilla__ is a candidate among bundles", () => {
    expect(parsePin("discovery\n__vanilla__\ndelivery\n")).toEqual({
      kind: "candidates",
      candidates: [
        { kind: "bundle", name: "discovery" },
        { kind: "vanilla" },
        { kind: "bundle", name: "delivery" },
      ],
    });
  });

  it("__vanilla__ as the sole candidate (direct vanilla)", () => {
    expect(parsePin("__vanilla__\n")).toEqual({
      kind: "candidates",
      candidates: [{ kind: "vanilla" }],
    });
  });

  it("all-commented-out parses to absent", () => {
    expect(parsePin("# discovery\n# delivery\n")).toEqual({ kind: "absent" });
  });

  it("keeps a source-qualified candidate name intact", () => {
    expect(parsePin("myrepo/data-science\n")).toEqual({
      kind: "candidates",
      candidates: [{ kind: "bundle", name: "myrepo/data-science" }],
    });
  });
});
