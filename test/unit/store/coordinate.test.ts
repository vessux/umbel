import { describe, expect, it } from "vitest";
import { UsageError } from "../../../src/errors.ts";
import { deriveAlias, githubUrl, parseCoordinate } from "../../../src/store/coordinate.ts";

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

  it("rejects git:/link:/local transports as not supported yet", () => {
    for (const bad of ["git:https://x.example/r.git@v1", "link:../here", "local"]) {
      expect(() => parseCoordinate(bad)).toThrowError(/not supported yet/);
    }
  });

  it("rejects . and .. org/repo segments", () => {
    expect(() => parseCoordinate("github:../..@v1")).toThrowError(UsageError);
    expect(() => parseCoordinate("github:acme/..@v1")).toThrowError(UsageError);
  });

  it("rejects an unknown coordinate shape", () => {
    expect(() => parseCoordinate("https://github.com/acme/tools")).toThrowError(UsageError);
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
});
