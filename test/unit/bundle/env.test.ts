import { describe, expect, it } from "vitest";
import { resolveLinkDir } from "../../../src/bundle/env.ts";
import { UsageError } from "../../../src/errors.ts";
import { parseCoordinate } from "../../../src/store/coordinate.ts";

describe("resolveLinkDir", () => {
  it("expands ${HOME} from the process env", () => {
    const c = parseCoordinate("link:${HOME}/dev/lib");
    expect(resolveLinkDir(c, { HOME: "/home/x" })).toBe("/home/x/dev/lib");
  });

  it("resolves the built-in local under ${UMBEL_HOME} defaulting to the config root", () => {
    const c = parseCoordinate("local");
    expect(resolveLinkDir(c, { UMBEL_ARTIFACTS_DIR: "/cfg/umbel" })).toBe("/cfg/umbel/local");
  });

  it("prefers an explicit UMBEL_HOME env var for ${UMBEL_HOME}", () => {
    const c = parseCoordinate("local");
    expect(resolveLinkDir(c, { UMBEL_HOME: "/home/u/.umbel", UMBEL_ARTIFACTS_DIR: "/cfg" })).toBe(
      "/home/u/.umbel/local",
    );
  });

  it("hard-errors on an undefined variable in a link path", () => {
    const c = parseCoordinate("link:${MISSING}/x");
    expect(() => resolveLinkDir(c, {})).toThrowError(UsageError);
  });
});
