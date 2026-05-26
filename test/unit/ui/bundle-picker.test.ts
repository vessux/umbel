import { describe, expect, it } from "vitest";
import type { BundleEntry } from "../../../src/bundle/discover.ts";
import { formatBundleLabel } from "../../../src/ui/bundle-picker.ts";

function entry(
  partial: Partial<BundleEntry> & { name: string; scope: BundleEntry["scope"] },
): BundleEntry {
  return {
    path: "/x",
    malformed: false,
    shadowed: false,
    ...partial,
    manifest: partial.manifest ?? { name: partial.name, sourcePath: "/x", body: "" },
  };
}

describe("formatBundleLabel", () => {
  it("renders name + description + scope tag", () => {
    const label = formatBundleLabel(
      entry({
        name: "data-science",
        scope: "user",
        manifest: { name: "data-science", sourcePath: "/x", body: "", description: "DS tools" },
      }),
      false,
    );
    expect(label).toContain("data-science");
    expect(label).toContain("DS tools");
    expect(label).toContain("[user]");
  });

  it("appends [pinned] when pinned", () => {
    const label = formatBundleLabel(entry({ name: "y", scope: "user" }), true);
    expect(label).toContain("[pinned]");
  });

  it("appends [shadowed] when the entry is shadowed", () => {
    const label = formatBundleLabel(entry({ name: "x", scope: "user", shadowed: true }), false);
    expect(label).toContain("[shadowed]");
  });
});
