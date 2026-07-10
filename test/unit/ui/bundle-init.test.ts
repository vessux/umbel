import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clack/prompts", () => ({
  text: vi.fn(),
  select: vi.fn(),
  multiselect: vi.fn(),
  groupMultiselect: vi.fn(),
  confirm: vi.fn(),
  isCancel: () => false,
  spinner: () => ({ start() {}, stop() {} }),
}));

import * as clack from "@clack/prompts";
import { loadManifest } from "../../../src/bundle/manifest.ts";
import type { Draft } from "../../../src/ui/authoring.ts";
import {
  addDependencyInteractive,
  listAvailableArtifacts,
  renderInitManifest,
  runReview,
} from "../../../src/ui/bundle-init.ts";
import { makeGitFixture } from "../../helpers/git.ts";
import { buildSourceTree, cleanup, makeTmpDir } from "../../helpers/tmp.ts";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("renderInitManifest", () => {
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

  it("renders a minimal manifest with just a name + description", () => {
    const out = renderInitManifest({
      name: "demo",
      description: "Demo bundle",
      extends: [],
      skills: [],
      agents: [],
    });
    expect(out).toContain("name: demo");
    expect(out).toContain("description: Demo bundle");
  });

  it("output round-trips through slice 1's parser without warnings", () => {
    const out = renderInitManifest({
      name: "demo",
      description: "Demo",
      extends: ["base"],
      skills: ["tdd"],
      agents: ["scout"],
    });
    const { manifest, warnings } = writeAndLoad("demo", out);
    expect(warnings).toEqual([]);
    expect(manifest.name).toBe("demo");
    expect(manifest.extends).toEqual(["base"]);
    expect(manifest.skills).toEqual(["tdd"]);
    expect(manifest.agents).toEqual(["scout"]);
  });

  it("includes empty-placeholder comments pointing to spec for runtime fields", () => {
    const out = renderInitManifest({
      name: "x",
      description: "",
      extends: [],
      skills: [],
      agents: [],
    });
    expect(out).toMatch(/\bmcps\b/);
    expect(out).toMatch(/hooks/);
    expect(out).toMatch(/settings/);
    expect(out).toMatch(/spec/i);
  });

  it("omits 'extends' from frontmatter when no parents selected", () => {
    const out = renderInitManifest({
      name: "x",
      description: "",
      extends: [],
      skills: ["a"],
      agents: [],
    });
    expect(out).not.toMatch(/^extends:/m);
  });

  it("omits empty list fields rather than rendering 'foo: []'", () => {
    const out = renderInitManifest({
      name: "x",
      description: "",
      extends: [],
      skills: [],
      agents: [],
    });
    expect(out).not.toMatch(/^skills:/m);
    expect(out).not.toMatch(/^agents:/m);
  });
});

describe("addDependencyInteractive", () => {
  it("fetches a github dep, gates trust, and returns a DepDraft with all skills pre-selected", async () => {
    const root = makeTmpDir();
    const gh = join(root, "gh", "acme", "tools");
    makeGitFixture(gh, { "skills/greet/SKILL.md": "---\nname: greet\n---\n" }, "v1");
    const env = {
      UMBEL_GITHUB_BASE: `file://${join(root, "gh")}`,
      UMBEL_DATA_DIR: join(root, "data"),
    } as unknown as NodeJS.ProcessEnv;
    vi.mocked(clack.text).mockResolvedValueOnce("github:acme/tools@v1");
    vi.mocked(clack.text).mockResolvedValueOnce("tools");
    vi.mocked(clack.groupMultiselect).mockResolvedValueOnce(["greet"]);
    const dep = await addDependencyInteractive({ env, existingAliases: new Set() });
    expect(dep?.alias).toBe("tools");
    expect(dep?.selectedSkills).toEqual(["greet"]);
    expect(dep?.commit).toMatch(/^[0-9a-f]{40}$/);
    cleanup(root);
  });
});

describe("runReview", () => {
  const NO_ROOTS = { skills: "/nope/skills", agents: "/nope/agents" };

  function reviewDraft(over: Partial<Draft>): Draft {
    return {
      name: "b",
      description: "",
      scope: "user",
      extendsList: ["base"],
      deps: [],
      poolSkills: [],
      poolAgents: [],
      inheritedSkills: ["base/tdd"],
      inheritedAgents: [],
      ...over,
    };
  }

  it("write action returns the draft unchanged", async () => {
    vi.mocked(clack.select).mockResolvedValueOnce("write");
    const out = await runReview(reviewDraft({ poolSkills: ["local/x"] }), {
      env: {} as NodeJS.ProcessEnv,
      artifactRoots: NO_ROOTS,
    });
    expect(out.poolSkills).toEqual(["local/x"]);
  });

  it("re-pick skills applies the new selection and never stores inherited", async () => {
    vi.mocked(clack.select).mockResolvedValueOnce("skills");
    vi.mocked(clack.groupMultiselect).mockResolvedValueOnce(["base/tdd", "local/y"]);
    vi.mocked(clack.select).mockResolvedValueOnce("write");
    const out = await runReview(reviewDraft({ poolSkills: ["local/x"] }), {
      env: {} as NodeJS.ProcessEnv,
      artifactRoots: NO_ROOTS,
    });
    expect(out.poolSkills.sort()).toEqual(["local/y"]);
  });

  it("re-pick routes a dep's leaf back onto that dep, not the pool", async () => {
    const dep = {
      alias: "tools",
      coordinate: "github:acme/tools@v1",
      commit: "a".repeat(40),
      contentHash: "b".repeat(64),
      dir: "/x",
      availableSkills: ["greet", "wave"],
      selectedSkills: ["greet"],
    };
    vi.mocked(clack.select).mockResolvedValueOnce("skills");
    vi.mocked(clack.groupMultiselect).mockResolvedValueOnce(["tools/greet", "tools/wave"]);
    vi.mocked(clack.select).mockResolvedValueOnce("write");
    const out = await runReview(reviewDraft({ deps: [dep] }), {
      env: {} as NodeJS.ProcessEnv,
      artifactRoots: NO_ROOTS,
    });
    expect(out.deps[0]?.selectedSkills).toEqual(["greet", "wave"]);
    expect(out.poolSkills).toEqual([]);
  });

  it("remove-dep drops the dependency from the draft", async () => {
    const dep = {
      alias: "tools",
      coordinate: "github:acme/tools@v1",
      commit: "a".repeat(40),
      contentHash: "b".repeat(64),
      dir: "/x",
      availableSkills: ["greet"],
      selectedSkills: ["greet"],
    };
    vi.mocked(clack.select).mockResolvedValueOnce("rmdep");
    vi.mocked(clack.select).mockResolvedValueOnce("tools");
    vi.mocked(clack.select).mockResolvedValueOnce("write");
    const out = await runReview(reviewDraft({ deps: [dep] }), {
      env: {} as NodeJS.ProcessEnv,
      artifactRoots: NO_ROOTS,
    });
    expect(out.deps).toEqual([]);
  });

  it("cancel aborts", async () => {
    vi.mocked(clack.select).mockResolvedValueOnce("cancel");
    await expect(
      runReview(reviewDraft({}), { env: {} as NodeJS.ProcessEnv, artifactRoots: NO_ROOTS }),
    ).rejects.toBeTruthy();
  });
});

describe("listAvailableArtifacts", () => {
  let root: string;
  beforeEach(() => {
    root = makeTmpDir();
  });
  afterEach(() => {
    cleanup(root);
  });

  it("returns qualified <source>/<leaf> names from a subfoldered skills root", () => {
    buildSourceTree(root, [
      { name: "tdd", source: "pocock" },
      { name: "review", source: "local" },
    ]);
    expect(listAvailableArtifacts(root, "SKILL.md")).toEqual(["local/review", "pocock/tdd"]);
  });

  it("returns [] when the root does not exist", () => {
    expect(listAvailableArtifacts(join(root, "missing"), "SKILL.md")).toEqual([]);
  });
});
