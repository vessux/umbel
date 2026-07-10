import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadManifest } from "../../../src/bundle/manifest.ts";
import { type Draft, renderManifest } from "../../../src/ui/authoring.ts";
import { cleanup, makeTmpDir } from "../../helpers/tmp.ts";

function draft(over: Partial<Draft>): Draft {
  return {
    name: "demo",
    description: "",
    scope: "user",
    extendsList: [],
    deps: [],
    poolSkills: [],
    poolAgents: [],
    inheritedSkills: [],
    inheritedAgents: [],
    ...over,
  };
}

describe("renderManifest", () => {
  let dir: string;
  beforeEach(() => {
    dir = makeTmpDir();
  });
  afterEach(() => {
    cleanup(dir);
  });

  function writeAndLoad(name: string, content: string) {
    const path = join(dir, `${name}.md`);
    writeFileSync(path, content);
    return loadManifest(path);
  }

  it("renders name + description and round-trips through the parser without warnings", () => {
    const out = renderManifest(draft({ description: "Demo bundle" }));
    const { manifest, warnings } = writeAndLoad("demo", out);
    expect(warnings).toEqual([]);
    expect(manifest.name).toBe("demo");
    expect(manifest.description).toBe("Demo bundle");
  });

  it("renders deps as a map and dep skill refs as <alias>/<leaf>", () => {
    const out = renderManifest(
      draft({
        deps: [
          {
            alias: "tools",
            coordinate: "github:acme/tools@v1",
            commit: "a".repeat(40),
            contentHash: "b".repeat(64),
            dir: "/x",
            availableSkills: ["greet", "wave"],
            selectedSkills: ["greet"],
          },
        ],
      }),
    );
    const { manifest } = writeAndLoad("demo", out);
    expect(manifest.deps).toEqual({ tools: "github:acme/tools@v1" });
    expect(manifest.skills).toEqual(["tools/greet"]);
  });

  it("merges pool refs with dep refs and excludes inherited from the written lists", () => {
    const out = renderManifest(
      draft({
        poolSkills: ["local/review"],
        poolAgents: ["local/scout"],
        inheritedSkills: ["base/tdd"],
        inheritedAgents: ["base/planner"],
      }),
    );
    const { manifest } = writeAndLoad("demo", out);
    expect(manifest.skills).toEqual(["local/review"]);
    expect(manifest.agents).toEqual(["local/scout"]);
  });

  it("omits empty deps/skills/agents and keeps the runtime-field comment block", () => {
    const out = renderManifest(draft({}));
    expect(out).not.toMatch(/^deps:/m);
    expect(out).not.toMatch(/^skills:/m);
    expect(out).not.toMatch(/^agents:/m);
    expect(out).toMatch(/mcps/);
    expect(out).toMatch(/hooks/);
    expect(out).toMatch(/spec/i);
  });

  it("emits extends when parents are present", () => {
    const out = renderManifest(draft({ extendsList: ["base"] }));
    const { manifest } = writeAndLoad("demo", out);
    expect(manifest.extends).toEqual(["base"]);
  });
});
