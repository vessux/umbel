import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BundleManifest } from "../../../src/bundle/manifest.ts";
import { loadManifest } from "../../../src/bundle/manifest.ts";
import { lockPathFor } from "../../../src/store/lock.ts";
import {
  type Draft,
  draftFromManifest,
  lockFromDraft,
  manifestEditsForDraft,
  renderManifest,
  writeDraft,
} from "../../../src/ui/authoring.ts";
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

describe("draftFromManifest", () => {
  it("splits dep refs from pool refs by the deps map keys", () => {
    const m = {
      name: "b",
      description: "d",
      extends: ["base"],
      deps: { tools: "github:acme/tools@v1" },
      skills: ["tools/greet", "tools/wave", "local/review"],
      agents: ["local/scout"],
    } as unknown as BundleManifest;
    const d = draftFromManifest("b", m, "project", { skills: ["base/tdd"], agents: [] });
    expect(d.deps).toHaveLength(1);
    expect(d.deps[0]?.alias).toBe("tools");
    expect(d.deps[0]?.selectedSkills).toEqual(["greet", "wave"]);
    expect(d.poolSkills).toEqual(["local/review"]);
    expect(d.poolAgents).toEqual(["local/scout"]);
    expect(d.inheritedSkills).toEqual(["base/tdd"]);
    expect(d.extendsList).toEqual(["base"]);
    expect(d.scope).toBe("project");
  });
});

describe("lockFromDraft", () => {
  it("pins every github dep by commit + contentHash", () => {
    const d = draft({
      deps: [
        {
          alias: "tools",
          coordinate: "github:acme/tools@v1",
          commit: "a".repeat(40),
          contentHash: "b".repeat(64),
          dir: "/x",
          availableSkills: ["g"],
          selectedSkills: ["g"],
        },
      ],
    });
    const lock = lockFromDraft(d);
    expect(lock.version).toBe(1);
    expect(lock.deps.tools).toEqual({
      coordinate: "github:acme/tools@v1",
      commit: "a".repeat(40),
      contentHash: "b".repeat(64),
    });
  });

  it("yields an empty deps map when there are no deps", () => {
    expect(lockFromDraft(draft({})).deps).toEqual({});
  });

  it("excludes link:/local deps — they never enter the lock", () => {
    const d = draft({
      deps: [
        {
          alias: "loc",
          coordinate: "local",
          commit: "",
          contentHash: "",
          dir: "/x",
          availableSkills: [],
          selectedSkills: [],
        },
        {
          alias: "mylink",
          coordinate: "link:${HOME}/x",
          commit: "",
          contentHash: "",
          dir: "/y",
          availableSkills: [],
          selectedSkills: [],
        },
      ],
    });
    expect(lockFromDraft(d).deps).toEqual({});
  });

  it("excludes an un-pinned github dep (empty commit) rather than writing a corrupt entry", () => {
    const d = draft({
      deps: [
        {
          alias: "tools",
          coordinate: "github:acme/tools@v1",
          commit: "",
          contentHash: "",
          dir: "/x",
          availableSkills: ["g"],
          selectedSkills: ["g"],
        },
      ],
    });
    expect(lockFromDraft(d).deps).toEqual({});
  });
});

describe("manifestEditsForDraft", () => {
  it("adds a new dep + its refs and drops a removed pool ref, preserving comments", () => {
    const raw = "---\nname: b\n# hand comment\nskills: [local/review, local/old]\n---\nprose\n";
    const original = {
      name: "b",
      skills: ["local/review", "local/old"],
    } as unknown as BundleManifest;
    const d = draft({
      poolSkills: ["local/review"],
      deps: [
        {
          alias: "tools",
          coordinate: "github:acme/tools@v1",
          commit: "a".repeat(40),
          contentHash: "b".repeat(64),
          dir: "/x",
          availableSkills: ["greet"],
          selectedSkills: ["greet"],
        },
      ],
    });
    const out = manifestEditsForDraft(raw, original, d);
    expect(out).toContain("# hand comment");
    expect(out).toContain("prose");
    expect(out).toMatch(/tools: github:acme\/tools@v1/);
    expect(out).toMatch(/tools\/greet/);
    expect(out).toMatch(/local\/review/);
    expect(out).not.toMatch(/local\/old/);
  });

  it("dropping a skill ref does not collaterally delete a same-named hook/mcp ref", () => {
    const raw = "---\nname: b\nskills:\n  - a/x\n  - a/y\nhooks:\n  - a/x\n---\n";
    const original = {
      name: "b",
      skills: ["a/x", "a/y"],
      hooks: ["a/x"],
    } as unknown as BundleManifest;
    const out = manifestEditsForDraft(raw, original, draft({ poolSkills: ["a/y"] }));
    expect(out).toMatch(/hooks:\n\s+- a\/x/); // hook preserved
    expect(out).toMatch(/skills:\n\s+- a\/y/); // skills kept a/y
    expect(out.match(/- a\/x/g)?.length).toBe(1); // a/x survives ONLY as the hook
  });

  it("removes a dependency that is gone from the Draft", () => {
    const raw = "---\nname: b\ndeps:\n  tools: github:acme/tools@v1\nskills: [tools/greet]\n---\n";
    const original = {
      name: "b",
      deps: { tools: "github:acme/tools@v1" },
      skills: ["tools/greet"],
    } as unknown as BundleManifest;
    const out = manifestEditsForDraft(raw, original, draft({}));
    expect(out).not.toMatch(/tools/);
  });
});

describe("writeDraft", () => {
  let dir: string;
  beforeEach(() => {
    dir = makeTmpDir();
  });
  afterEach(() => {
    cleanup(dir);
  });

  it("create: writes manifest + lock for a github dep", () => {
    const outDir = join(dir, "bundles");
    mkdirSync(outDir, { recursive: true });
    const d = draft({
      deps: [
        {
          alias: "tools",
          coordinate: "github:acme/tools@v1",
          commit: "a".repeat(40),
          contentHash: "b".repeat(64),
          dir: "/x",
          availableSkills: ["g"],
          selectedSkills: ["g"],
        },
      ],
    });
    const path = join(outDir, "demo.md");
    writeDraft(d, { mode: "create", path });
    expect(readFileSync(path, "utf8")).toMatch(/tools\/g/);
    expect(existsSync(lockPathFor(path))).toBe(true);
  });

  it("create: writes no lock when there are no deps", () => {
    const path = join(dir, "demo.md");
    writeDraft(draft({ poolSkills: ["local/x"] }), { mode: "create", path });
    expect(existsSync(lockPathFor(path))).toBe(false);
  });
});
