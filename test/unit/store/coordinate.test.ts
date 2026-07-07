import { describe, expect, it } from "vitest";
import { UsageError } from "../../../src/errors.ts";
import {
  deriveAlias,
  expandPath,
  githubUrl,
  parseCoordinate,
} from "../../../src/store/coordinate.ts";

describe("parseCoordinate", () => {
  it("parses github:org/repo@ref", () => {
    const c = parseCoordinate("github:acme/tools@v1.2.0");
    expect(c).toEqual({
      transport: "github",
      org: "acme",
      repo: "tools",
      ref: "v1.2.0",
      raw: "github:acme/tools@v1.2.0",
    });
  });

  it("accepts dots, dashes, underscores in org/repo and slashes in ref", () => {
    const c = parseCoordinate("github:My-Org/repo.name_x@release/1.0");
    if (c.transport !== "github") throw new Error("expected a github coordinate");
    expect(c.org).toBe("My-Org");
    expect(c.repo).toBe("repo.name_x");
    expect(c.ref).toBe("release/1.0");
  });

  it("rejects a missing ref with a pin hint", () => {
    expect(() => parseCoordinate("github:acme/tools")).toThrowError(UsageError);
    expect(() => parseCoordinate("github:acme/tools")).toThrowError(/@<tag>/);
  });

  it("rejects empty org, repo, or ref", () => {
    for (const bad of ["github:/tools@v1", "github:acme/@v1", "github:acme/tools@"]) {
      expect(() => parseCoordinate(bad)).toThrowError(UsageError);
    }
  });

  it("rejects #subpath as not supported yet", () => {
    expect(() => parseCoordinate("github:acme/tools@v1#skills")).toThrowError(
      /subpath.*not supported yet/,
    );
  });

  it("rejects git: as not supported yet", () => {
    expect(() => parseCoordinate("git:https://x.example/r.git@v1")).toThrowError(
      /not supported yet/,
    );
  });

  it("rejects a github: coordinate carrying variable expansion", () => {
    expect(() => parseCoordinate("github:acme/tools@v${REF}")).toThrowError(UsageError);
    expect(() => parseCoordinate("github:acme/tools@v${REF}")).toThrowError(/only.*link:/i);
  });

  it("rejects . and .. org/repo segments", () => {
    expect(() => parseCoordinate("github:../..@v1")).toThrowError(UsageError);
    expect(() => parseCoordinate("github:acme/..@v1")).toThrowError(UsageError);
  });

  it("rejects an unknown coordinate shape", () => {
    expect(() => parseCoordinate("https://github.com/acme/tools")).toThrowError(UsageError);
  });

  it("parses link:<path> to a link coordinate, keeping the path unexpanded", () => {
    const c = parseCoordinate("link:${HOME}/dev/mylib");
    expect(c).toEqual({
      transport: "link",
      path: "${HOME}/dev/mylib",
      raw: "link:${HOME}/dev/mylib",
    });
  });

  it("rejects an empty link: path", () => {
    expect(() => parseCoordinate("link:")).toThrowError(UsageError);
  });

  it("parses the built-in 'local' as link:${UMBEL_HOME}/local", () => {
    const c = parseCoordinate("local");
    expect(c).toEqual({ transport: "link", path: "${UMBEL_HOME}/local", raw: "local" });
  });
});

describe("expandPath", () => {
  const lookup = (vars: Record<string, string>) => (name: string) => vars[name];

  it("expands ${VAR} from the resolver", () => {
    expect(expandPath("${HOME}/dev", lookup({ HOME: "/home/x" }))).toBe("/home/x/dev");
  });

  it("expands multiple variables in one path", () => {
    expect(expandPath("${A}/${B}", lookup({ A: "/one", B: "two" }))).toBe("/one/two");
  });

  it("hard-errors on an undefined variable", () => {
    expect(() => expandPath("${NOPE}/x", lookup({}))).toThrowError(UsageError);
    expect(() => expandPath("${NOPE}/x", lookup({}))).toThrowError(/undefined variable/);
  });

  it("hard-errors on an empty-string variable", () => {
    expect(() => expandPath("${E}/x", lookup({ E: "" }))).toThrowError(/undefined variable/);
  });

  it("rejects a malformed (unclosed) variable reference", () => {
    expect(() => expandPath("${HOME/x", lookup({ HOME: "/h" }))).toThrowError(UsageError);
  });

  it("does not treat a resolved value that itself contains ${ as malformed", () => {
    expect(expandPath("${HOME}/x", lookup({ HOME: "/weird/a${b" }))).toBe("/weird/a${b/x");
  });

  it("leaves a path with no variables untouched", () => {
    expect(expandPath("/abs/path", lookup({}))).toBe("/abs/path");
  });
});

describe("githubUrl", () => {
  it("maps to https://github.com/<org>/<repo> by default", () => {
    const c = parseCoordinate("github:acme/tools@v1");
    expect(githubUrl(c, {})).toBe("https://github.com/acme/tools");
  });

  it("honors UMBEL_GITHUB_BASE and strips trailing slashes", () => {
    const c = parseCoordinate("github:acme/tools@v1");
    expect(githubUrl(c, { UMBEL_GITHUB_BASE: "file:///tmp/fixtures/" })).toBe(
      "file:///tmp/fixtures/acme/tools",
    );
  });
});

describe("deriveAlias", () => {
  it("uses the lowercased repo name", () => {
    expect(deriveAlias(parseCoordinate("github:acme/Tools@v1"))).toBe("tools");
  });

  it("strips a .git suffix and sanitizes odd chars", () => {
    expect(deriveAlias(parseCoordinate("github:acme/My.Repo.git@v1"))).toBe("my-repo");
  });

  it("rejects a repo that sanitizes to an invalid alias", () => {
    expect(() => deriveAlias(parseCoordinate("github:acme/---@v1"))).toThrowError(UsageError);
  });

  it("rejects an alias that does not start with a letter", () => {
    expect(() => deriveAlias(parseCoordinate("github:acme/3d-tools@v1"))).toThrowError(UsageError);
  });

  it("refuses to derive an alias from a link: coordinate", () => {
    expect(() => deriveAlias(parseCoordinate("link:${HOME}/x"))).toThrowError(UsageError);
    expect(() => deriveAlias(parseCoordinate("local"))).toThrowError(UsageError);
  });
});
