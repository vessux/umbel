import { existsSync } from "node:fs";
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
  runInitWizard,
  runReview,
} from "../../../src/ui/bundle-init.ts";
import { makeGitFixture } from "../../helpers/git.ts";
import { buildSourceTree, cleanup, makeTmpDir } from "../../helpers/tmp.ts";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("runInitWizard", () => {
  it("builds a bundle via the dep loop and writes manifest+lock only at the end", async () => {
    const root = makeTmpDir();
    const gh = join(root, "gh", "acme", "tools");
    makeGitFixture(gh, { "skills/greet/SKILL.md": "---\nname: greet\n---\n" }, "v1");
    const userDir = join(root, "config", "bundles");
    const env = {
      UMBEL_GITHUB_BASE: `file://${join(root, "gh")}`,
      UMBEL_DATA_DIR: join(root, "data"),
    } as unknown as NodeJS.ProcessEnv;

    vi.mocked(clack.text).mockResolvedValueOnce("demo"); // name
    vi.mocked(clack.text).mockResolvedValueOnce("A demo"); // description
    vi.mocked(clack.select).mockResolvedValueOnce("dep"); // Review: add dep
    vi.mocked(clack.text).mockResolvedValueOnce("github:acme/tools@v1"); // coordinate
    vi.mocked(clack.text).mockResolvedValueOnce("tools"); // alias
    vi.mocked(clack.groupMultiselect).mockResolvedValueOnce(["greet"]); // dep skills
    vi.mocked(clack.select).mockResolvedValueOnce("write"); // Review: write

    const rc = await runInitWizard({
      userBundlesDir: userDir,
      projectBundlesDir: join(root, "proj", ".claude", "bundles"),
      cwd: root,
      home: root,
      artifactRoots: { skills: join(root, "skills"), agents: join(root, "agents") },
      env,
    });
    expect(rc).toBe(0);
    const path = join(userDir, "demo.md");
    expect(existsSync(path)).toBe(true);
    expect(loadManifest(path).manifest.skills).toEqual(["tools/greet"]);
    expect(existsSync(join(userDir, "demo.lock"))).toBe(true);
    cleanup(root);
  });

  it("aborting the Review leaves no manifest on disk", async () => {
    const root = makeTmpDir();
    const userDir = join(root, "config", "bundles");
    const env = { UMBEL_DATA_DIR: join(root, "data") } as unknown as NodeJS.ProcessEnv;
    vi.mocked(clack.text).mockResolvedValueOnce("demo"); // name
    vi.mocked(clack.text).mockResolvedValueOnce(""); // description
    vi.mocked(clack.select).mockResolvedValueOnce("cancel"); // Review: cancel

    await expect(
      runInitWizard({
        userBundlesDir: userDir,
        projectBundlesDir: join(root, "proj", ".claude", "bundles"),
        cwd: root,
        home: root,
        artifactRoots: { skills: join(root, "skills"), agents: join(root, "agents") },
        env,
      }),
    ).rejects.toBeTruthy();
    expect(existsSync(join(userDir, "demo.md"))).toBe(false);
    cleanup(root);
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
