import { describe, expect, it } from "vitest";
import type { BundleEntry } from "../../../src/bundle/discover.ts";
import { renderList } from "../../../src/bundle/list.ts";

const SCOPE_DIRS = {
  userDir: "/home/u/.agents/bundles",
  projectDir: "/repo/.claude/bundles",
};

function entry(
  partial: Partial<BundleEntry> & { name: string; scope: BundleEntry["scope"] },
): BundleEntry {
  return {
    path: "/x",
    malformed: false,
    shadowed: false,
    ...partial,
    manifest: partial.manifest ?? {
      name: partial.name,
      sourcePath: "/x",
      body: "",
    },
  };
}

describe("renderList", () => {
  it("prints 'no bundles found' when no entries", () => {
    const out = renderList([], SCOPE_DIRS);
    expect(out).toMatch(/no bundles found/i);
  });

  it("groups entries by scope with headers", () => {
    const entries = [
      entry({ name: "ds-no-mcp", scope: "project" }),
      entry({ name: "base", scope: "user" }),
      entry({ name: "data-science", scope: "user" }),
    ];
    const out = renderList(entries, SCOPE_DIRS);
    expect(out).toContain("PROJECT (/repo/.claude/bundles)");
    expect(out).toContain("USER (/home/u/.agents/bundles)");
    expect(out.indexOf("PROJECT")).toBeLessThan(out.indexOf("USER"));
  });

  it("renders columns for name, description, extends, pinned", () => {
    const entries = [
      entry({
        name: "data-science",
        scope: "user",
        manifest: {
          name: "data-science",
          sourcePath: "/x",
          body: "",
          description: "Tools for data science work",
          extends: ["base", "lang-py"],
        },
      }),
    ];
    const out = renderList(entries, SCOPE_DIRS);
    expect(out).toMatch(/NAME\s+DESCRIPTION\s+EXTENDS\s+PINNED/);
    expect(out).toContain("data-science");
    expect(out).toContain("Tools for data science work");
    expect(out).toContain("base, lang-py");
  });

  it("marks a single pinned bundle with yes (no footnote)", () => {
    const entries = [
      entry({ name: "data-science", scope: "project" }),
      entry({ name: "base", scope: "user" }),
    ];
    const out = renderList(entries, SCOPE_DIRS, { pinnedNames: ["data-science"] });
    const dsLine = out.split("\n").find((l) => l.includes("data-science"))!;
    const baseLine = out.split("\n").find((l) => l.includes("base "))!;
    expect(dsLine).toMatch(/yes/);
    expect(baseLine).not.toMatch(/yes/);
    expect(out).not.toContain("default candidate");
  });

  it("marks every candidate, distinguishing the default with yes* + a footnote", () => {
    const entries = [
      entry({ name: "discovery", scope: "project" }),
      entry({ name: "delivery", scope: "project" }),
      entry({ name: "other", scope: "user" }),
    ];
    const out = renderList(entries, SCOPE_DIRS, {
      pinnedNames: ["discovery", "delivery"],
      defaultName: "discovery",
    });
    const discoveryLine = out.split("\n").find((l) => l.includes("discovery"))!;
    const deliveryLine = out.split("\n").find((l) => l.includes("delivery"))!;
    const otherLine = out.split("\n").find((l) => l.includes("other"))!;
    expect(discoveryLine).toMatch(/yes\*/);
    expect(deliveryLine).toMatch(/yes(?!\*)/);
    expect(otherLine).not.toMatch(/yes/);
    expect(out).toMatch(/\* default candidate/);
  });

  it("omits a scope group entirely when it has no rows", () => {
    const entries = [entry({ name: "base", scope: "user" })];
    const out = renderList(entries, SCOPE_DIRS);
    expect(out).not.toContain("PROJECT");
    expect(out).toContain("USER");
  });
});
