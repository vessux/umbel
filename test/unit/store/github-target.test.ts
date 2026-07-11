import { describe, expect, it } from "vitest";
import { UsageError } from "../../../src/errors.ts";
import { parseGithubTarget } from "../../../src/store/github-target.ts";

describe("parseGithubTarget", () => {
  it("parses a bare https URL", () => {
    expect(parseGithubTarget("https://github.com/acme/tools")).toEqual({
      org: "acme",
      repo: "tools",
    });
  });
  it("strips a .git suffix and a trailing slash", () => {
    expect(parseGithubTarget("https://github.com/acme/tools.git/")).toEqual({
      org: "acme",
      repo: "tools",
    });
  });
  it("reads a ref from /tree/<ref>", () => {
    expect(parseGithubTarget("https://github.com/acme/tools/tree/v2")).toEqual({
      org: "acme",
      repo: "tools",
      ref: "v2",
    });
  });
  it("parses a github: coordinate without a ref", () => {
    expect(parseGithubTarget("github:acme/tools")).toEqual({ org: "acme", repo: "tools" });
  });
  it("parses a github: coordinate with a ref", () => {
    expect(parseGithubTarget("github:acme/tools@v1")).toEqual({
      org: "acme",
      repo: "tools",
      ref: "v1",
    });
  });
  it("rejects a non-github host", () => {
    expect(() => parseGithubTarget("https://gitlab.com/a/b")).toThrow(UsageError);
  });
  it("rejects garbage", () => {
    expect(() => parseGithubTarget("not a url")).toThrow(UsageError);
  });
});
