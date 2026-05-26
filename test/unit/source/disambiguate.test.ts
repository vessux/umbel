import { describe, expect, it } from "vitest";
import { disambiguateSkills } from "../../../src/source/disambiguate.ts";
import type { Skill } from "../../../src/types.ts";

function skill(name: string, installName: string): Skill {
  const [source = ""] = name.split("/");
  return {
    name,
    source,
    installName,
    sourcePath: `/src/${name}`,
    description: null,
    malformed: false,
  };
}

describe("disambiguateSkills", () => {
  it("no collision: installName unchanged", () => {
    const out = disambiguateSkills([
      skill("pocock/tdd", "tdd"),
      skill("pocock/caveman", "caveman"),
    ]);
    expect(out.map((s) => s.installName)).toEqual(["tdd", "caveman"]);
  });

  it("cross-source collision: every group member gets <source>-<canonical>", () => {
    const out = disambiguateSkills([
      skill("pocock/tdd", "tdd"),
      skill("superpowers/tdd", "tdd"),
      skill("pocock/review", "review"),
    ]);
    expect(out.map((s) => s.installName)).toEqual(["pocock-tdd", "superpowers-tdd", "review"]);
  });

  it("preserves name, sourcePath, description, malformed", () => {
    const a: Skill = {
      name: "pocock/tdd",
      source: "pocock",
      installName: "tdd",
      sourcePath: "/realpath/pocock/tdd",
      description: "pocock desc",
      malformed: false,
    };
    const b: Skill = {
      name: "superpowers/tdd",
      source: "superpowers",
      installName: "tdd",
      sourcePath: "/realpath/superpowers/tdd",
      description: "sp desc",
      malformed: false,
    };
    const out = disambiguateSkills([a, b]);
    expect(out[0]).toMatchObject({
      name: "pocock/tdd",
      installName: "pocock-tdd",
      sourcePath: "/realpath/pocock/tdd",
      description: "pocock desc",
    });
    expect(out[1]).toMatchObject({
      name: "superpowers/tdd",
      installName: "superpowers-tdd",
      sourcePath: "/realpath/superpowers/tdd",
      description: "sp desc",
    });
  });

  it("empty input → empty output", () => {
    expect(disambiguateSkills([])).toEqual([]);
  });
});
