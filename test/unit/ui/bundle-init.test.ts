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
import {
  addDependencyInteractive,
  listAvailableArtifacts,
  renderInitManifest,
} from "../../../src/ui/bundle-init.ts";
import { makeGitFixture } from "../../helpers/git.ts";
import { buildSourceTree, cleanup, makeTmpDir } from "../../helpers/tmp.ts";

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
