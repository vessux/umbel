import { describe, expect, it } from "vitest";
import { bucketByQualifiedName } from "../../../src/ui/picker.ts";

describe("bucketByQualifiedName", () => {
  it("groups items by the prefix before the first '/'", () => {
    const items = [{ name: "pocock/grill-me" }, { name: "local/review" }, { name: "pocock/tdd" }];
    const out = bucketByQualifiedName(items, (i) => i.name);
    expect(out).toEqual({
      pocock: [{ name: "pocock/grill-me" }, { name: "pocock/tdd" }],
      local: [{ name: "local/review" }],
    });
  });

  it("preserves item order within each bucket", () => {
    const items = ["pocock/b", "pocock/a", "pocock/c"].map((n) => ({ name: n }));
    const out = bucketByQualifiedName(items, (i) => i.name);
    expect(out.pocock?.map((i) => i.name)).toEqual(["pocock/b", "pocock/a", "pocock/c"]);
  });

  it("falls back to the whole name when no '/' present", () => {
    const items = [{ name: "bare" }];
    const out = bucketByQualifiedName(items, (i) => i.name);
    expect(out).toEqual({ bare: [{ name: "bare" }] });
  });

  it("returns an empty record for an empty input", () => {
    expect(bucketByQualifiedName([], (i: { name: string }) => i.name)).toEqual({});
  });
});
