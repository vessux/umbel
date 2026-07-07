import { describe, expect, it } from "vitest";
import { helpText } from "../../src/args.ts";

describe("helpText", () => {
  it("documents the run-exported env vars in the Env section", () => {
    const help = helpText();
    expect(help).toContain("UMBEL_RESOLVED_DIR");
    expect(help).toContain("UMBEL_BUNDLE_VERSION");
  });

  it("no longer advertises the removed skills verb", () => {
    expect(helpText()).not.toContain("umbel skills");
  });
});
