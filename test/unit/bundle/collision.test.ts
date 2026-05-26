import { describe, expect, it } from "vitest";
import { resolveCollisions } from "../../../src/bundle/collision.ts";

describe("resolveCollisions", () => {
  it("no collisions: finalName === canonical, collides=false", () => {
    const items = [
      { source: "pocock", canonical: "tdd" },
      { source: "pocock", canonical: "caveman" },
    ];
    const out = resolveCollisions(items);
    expect(out.map((r) => r.finalName)).toEqual(["tdd", "caveman"]);
    expect(out.every((r) => r.collides === false)).toBe(true);
  });

  it("collision: every group member gets <source>-<canonical> + collides=true", () => {
    const items = [
      { source: "pocock", canonical: "tdd" },
      { source: "superpowers", canonical: "tdd" },
      { source: "pocock", canonical: "review" },
    ];
    const out = resolveCollisions(items);
    expect(out[0]).toMatchObject({ finalName: "pocock-tdd", collides: true });
    expect(out[1]).toMatchObject({ finalName: "superpowers-tdd", collides: true });
    expect(out[2]).toMatchObject({ finalName: "review", collides: false });
  });

  it("returns item reference unchanged so callers can carry context", () => {
    const a = { source: "pocock", canonical: "tdd", extra: 1 };
    const b = { source: "superpowers", canonical: "tdd", extra: 2 };
    const out = resolveCollisions([a, b]);
    expect(out[0]!.item).toBe(a);
    expect(out[1]!.item).toBe(b);
  });

  it("empty input → empty output", () => {
    expect(resolveCollisions([])).toEqual([]);
  });
});
