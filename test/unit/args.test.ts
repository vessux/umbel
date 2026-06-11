import { describe, expect, it } from "vitest";
import { helpText, parseArgs } from "../../src/args.ts";
import { UsageError } from "../../src/errors.ts";

const CWD = "/tmp/cwd";
const EMPTY_ENV: NodeJS.ProcessEnv = {};

describe("parseArgs", () => {
  it("defaults source to $XDG_CONFIG_HOME/umbel/skills and leaves target null", () => {
    const o = parseArgs([], { cwd: CWD, env: EMPTY_ENV });
    expect(o.target).toBeNull();
    expect(o.skills).toBeNull();
    expect(o.source.endsWith("/umbel/skills")).toBe(true);
  });

  it("accepts --target with space form and resolves relative to cwd", () => {
    const o = parseArgs(["--target", "./skills"], { cwd: CWD, env: EMPTY_ENV });
    expect(o.target).toBe("/tmp/cwd/skills");
  });

  it("accepts --target with equals form", () => {
    const o = parseArgs(["--target=./skills"], { cwd: CWD, env: EMPTY_ENV });
    expect(o.target).toBe("/tmp/cwd/skills");
  });

  it("parses --skills as csv", () => {
    const o = parseArgs(["--skills", "tdd,grill-me, review"], { cwd: CWD, env: EMPTY_ENV });
    expect(o.skills).toEqual(["tdd", "grill-me", "review"]);
  });

  it("--skills= with empty string yields empty array", () => {
    const o = parseArgs(["--skills="], { cwd: CWD, env: EMPTY_ENV });
    expect(o.skills).toEqual([]);
  });

  it("--force and --dry-run are boolean", () => {
    const o = parseArgs(["--force", "--dry-run"], { cwd: CWD, env: EMPTY_ENV });
    expect(o.force).toBe(true);
    expect(o.dryRun).toBe(true);
  });

  it("UMBEL_ARTIFACTS_DIR derives source via /skills suffix", () => {
    const o = parseArgs([], {
      cwd: CWD,
      env: { UMBEL_ARTIFACTS_DIR: "/elsewhere" },
    });
    expect(o.source).toBe("/elsewhere/skills");
  });

  it("XDG_CONFIG_HOME drives the default when UMBEL_ARTIFACTS_DIR unset", () => {
    const o = parseArgs([], {
      cwd: CWD,
      env: { XDG_CONFIG_HOME: "/xdg/config" },
    });
    expect(o.source).toBe("/xdg/config/umbel/skills");
  });

  it("--source overrides env var", () => {
    const o = parseArgs(["--source", "/flag/skills"], {
      cwd: CWD,
      env: { UMBEL_ARTIFACTS_DIR: "/env" },
    });
    expect(o.source).toBe("/flag/skills");
  });

  it("unknown flag → UsageError", () => {
    expect(() => parseArgs(["--nope"], { cwd: CWD, env: EMPTY_ENV })).toThrow(UsageError);
  });

  it("--target missing value → UsageError", () => {
    expect(() => parseArgs(["--target"], { cwd: CWD, env: EMPTY_ENV })).toThrow(UsageError);
  });

  it("positional argument → UsageError", () => {
    expect(() => parseArgs(["foo"], { cwd: CWD, env: EMPTY_ENV })).toThrow(UsageError);
  });

  it("--help / -h set help flag", () => {
    expect(parseArgs(["-h"], { cwd: CWD, env: EMPTY_ENV }).help).toBe(true);
    expect(parseArgs(["--help"], { cwd: CWD, env: EMPTY_ENV }).help).toBe(true);
  });
});

describe("helpText", () => {
  it("documents the run-exported env vars in the Env section", () => {
    const help = helpText();
    expect(help).toContain("UMBEL_RESOLVED_DIR");
    expect(help).toContain("UMBEL_BUNDLE_VERSION");
  });
});
