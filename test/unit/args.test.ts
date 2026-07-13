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

  it("documents the fork and remove verbs", () => {
    const help = helpText();
    expect(help).toContain("umbel remove");
    expect(help).toContain("umbel fork");
  });

  it("lists the --yes trust-override flag on add and install", () => {
    const lines = helpText().split("\n");
    const addLine = lines.find((l) => l.includes("umbel add "));
    const installLine = lines.find((l) => l.includes("umbel install "));
    expect(addLine).toContain("--yes");
    expect(installLine).toContain("--yes");
  });
});
