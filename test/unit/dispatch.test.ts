import { describe, expect, it } from "vitest";
import { parseSubcommand } from "../../src/args.ts";

describe("parseSubcommand", () => {
  it("returns help for empty argv", () => {
    expect(parseSubcommand([])).toEqual({ kind: "help" });
  });

  it("returns help for -h / --help", () => {
    expect(parseSubcommand(["-h"])).toEqual({ kind: "help" });
    expect(parseSubcommand(["--help"])).toEqual({ kind: "help" });
  });

  it("returns version for -v / --version", () => {
    expect(parseSubcommand(["-v"])).toEqual({ kind: "version" });
    expect(parseSubcommand(["--version"])).toEqual({ kind: "version" });
  });

  it("recognizes 'skills' subcommand", () => {
    expect(parseSubcommand(["skills"])).toEqual({ kind: "skills", rest: [] });
    expect(parseSubcommand(["skills", "--target", "./x"])).toEqual({
      kind: "skills",
      rest: ["--target", "./x"],
    });
  });

  it("recognizes top-level bundle verbs", () => {
    expect(parseSubcommand(["list"])).toEqual({ kind: "verb", verb: "list", rest: [] });
    expect(parseSubcommand(["run", "data-science", "--", "--version"])).toEqual({
      kind: "verb",
      verb: "run",
      rest: ["data-science", "--", "--version"],
    });
    expect(parseSubcommand(["init"])).toEqual({ kind: "verb", verb: "init", rest: [] });
  });

  it("returns error for unknown commands", () => {
    const r = parseSubcommand(["bogus"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toMatch(/unknown command 'bogus'/);
  });

  it("returns error for stray top-level flags", () => {
    const r = parseSubcommand(["--target", "./x"]);
    expect(r.kind).toBe("error");
  });

  it("does not treat 'bundle' as a verb (flattened CLI)", () => {
    const r = parseSubcommand(["bundle"]);
    expect(r.kind).toBe("error");
  });

  it("recognizes 'add' as a bundle verb", () => {
    const sub = parseSubcommand(["add", "github:a/b@v1"]);
    expect(sub).toEqual({ kind: "verb", verb: "add", rest: ["github:a/b@v1"] });
  });
});
