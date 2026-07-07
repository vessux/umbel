import { autocomplete } from "@clack/prompts";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BundleEntry } from "../../../src/bundle/discover.ts";
import type { Candidate } from "../../../src/bundle/pin.ts";
import {
  VANILLA_PICK,
  formatBundleLabel,
  pickBundle,
  pickScopedBundle,
  scopedPickerOptions,
} from "../../../src/ui/bundle-picker.ts";

// Filtering (spec item 5) is the `select → autocomplete` swap; mock clack to
// assert the type-to-filter primitive is the one invoked, with the built options.
vi.mock("@clack/prompts", () => ({
  autocomplete: vi.fn(async (opts: { options: { value: string }[] }) => opts.options[0]!.value),
  isCancel: () => false,
  confirm: vi.fn(),
}));

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

describe("scopedPickerOptions", () => {
  it("renders exactly the candidate set in order, no injected vanilla row", () => {
    const candidates: Candidate[] = [
      { kind: "bundle", name: "discovery" },
      { kind: "bundle", name: "delivery" },
    ];
    const entries = [
      entry({
        name: "discovery",
        scope: "user",
        manifest: { name: "discovery", sourcePath: "/x", body: "", description: "Find work" },
      }),
      entry({ name: "delivery", scope: "user" }),
    ];
    const { options, initialValue } = scopedPickerOptions(candidates, entries);
    expect(options.map((o) => o.value)).toEqual(["discovery", "delivery"]);
    expect(options[0]!.label).toContain("Find work");
    expect(options.some((o) => o.value === VANILLA_PICK)).toBe(false);
    expect(initialValue).toBe("discovery");
  });

  it("renders an explicit __vanilla__ candidate as a (vanilla) row", () => {
    const candidates: Candidate[] = [{ kind: "bundle", name: "discovery" }, { kind: "vanilla" }];
    const { options } = scopedPickerOptions(candidates, []);
    const vanillaRow = options.find((o) => o.value === VANILLA_PICK)!;
    expect(vanillaRow.label).toContain("(vanilla)");
  });

  it("pre-selects the default (first) candidate, even when vanilla", () => {
    const candidates: Candidate[] = [{ kind: "vanilla" }, { kind: "bundle", name: "discovery" }];
    expect(scopedPickerOptions(candidates, []).initialValue).toBe(VANILLA_PICK);
  });

  it("falls back to the bare name when a candidate has no discovered entry", () => {
    const candidates: Candidate[] = [{ kind: "bundle", name: "ghost" }];
    const { options } = scopedPickerOptions(candidates, []);
    expect(options).toEqual([{ label: "ghost", value: "ghost" }]);
  });
});

describe("pickers use the filterable autocomplete primitive", () => {
  afterEach(() => vi.mocked(autocomplete).mockClear());

  it("pickBundle calls autocomplete with a row per valid bundle", async () => {
    const entries = [
      entry({ name: "web", scope: "user" }),
      entry({ name: "api", scope: "project" }),
    ];
    const chosen = await pickBundle({ entries });
    expect(chosen).toBe("web"); // mock returns options[0]; pickBundle keeps input order
    expect(autocomplete).toHaveBeenCalledOnce();
    const opts = vi.mocked(autocomplete).mock.calls[0]![0] as { options: { value: string }[] };
    expect(opts.options.map((o) => o.value).sort()).toEqual(["api", "web"]);
  });

  it("pickScopedBundle calls autocomplete over exactly the candidate set", async () => {
    const candidates: Candidate[] = [
      { kind: "bundle", name: "web" },
      { kind: "bundle", name: "api" },
    ];
    await pickScopedBundle({ candidates, entries: [] });
    expect(autocomplete).toHaveBeenCalledOnce();
    const opts = vi.mocked(autocomplete).mock.calls[0]![0] as { options: { value: string }[] };
    expect(opts.options.map((o) => o.value)).toEqual(["web", "api"]);
  });
});
