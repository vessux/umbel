import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverBundles } from "../../../src/bundle/discover.ts";
import { cleanup, makeTmpDir } from "../../helpers/tmp.ts";

describe("discoverBundles", () => {
  let root: string;
  let userDir: string;
  let projectDir: string;

  beforeEach(() => {
    root = makeTmpDir();
    userDir = join(root, "user");
    projectDir = join(root, "project");
  });
  afterEach(() => {
    cleanup(root);
  });

  function writeBundleFile(dir: string, name: string, body?: string): void {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${name}.md`), body ?? `---\nname: ${name}\n---\nbody\n`);
  }

  it("returns empty list when both scopes empty", () => {
    expect(discoverBundles({ userDir, projectDir })).toEqual([]);
  });

  it("returns empty list when only userDir is given and dir does not exist", () => {
    expect(discoverBundles({ userDir })).toEqual([]);
  });

  it("lists user-scope bundles when only user dir populated", () => {
    writeBundleFile(userDir, "base");
    writeBundleFile(userDir, "data-science");
    const out = discoverBundles({ userDir, projectDir });
    expect(out.map((e) => ({ name: e.name, scope: e.scope }))).toEqual([
      { name: "base", scope: "user" },
      { name: "data-science", scope: "user" },
    ]);
    expect(out.every((e) => !e.malformed)).toBe(true);
    expect(out.every((e) => !e.shadowed)).toBe(true);
  });

  it("lists project bundles before user bundles when both populated", () => {
    writeBundleFile(userDir, "alpha");
    writeBundleFile(projectDir, "zeta");
    const out = discoverBundles({ userDir, projectDir });
    expect(out.map((e) => e.scope)).toEqual(["project", "user"]);
  });

  it("marks user entry as shadowed when project has same name", () => {
    writeBundleFile(userDir, "data-science");
    writeBundleFile(projectDir, "data-science");
    const out = discoverBundles({ userDir, projectDir });
    const project = out.find((e) => e.scope === "project")!;
    const user = out.find((e) => e.scope === "user")!;
    expect(project.shadowed).toBe(false);
    expect(user.shadowed).toBe(true);
  });

  it("flags malformed manifest but does not abort discovery", () => {
    writeBundleFile(userDir, "broken", "---\nname: 1bad\n---\n");
    writeBundleFile(userDir, "good");
    const out = discoverBundles({ userDir, projectDir });
    const broken = out.find((e) => e.name === "broken");
    const good = out.find((e) => e.name === "good");
    expect(broken?.malformed).toBe(true);
    expect(broken?.manifest).toBeUndefined();
    expect(good?.malformed).toBe(false);
  });

  it("ignores non-.md files in scope dirs", () => {
    writeBundleFile(userDir, "ok");
    writeFileSync(join(userDir, "README.txt"), "hi");
    writeFileSync(join(userDir, ".DS_Store"), "");
    const out = discoverBundles({ userDir, projectDir });
    expect(out.map((e) => e.name)).toEqual(["ok"]);
  });

  it("preserves the validation error on a malformed entry", () => {
    mkdirSync(userDir, { recursive: true });
    writeFileSync(join(userDir, "bad.md"), "---\nname: bad\nsettings:\n  notAllowed: 1\n---\n");
    const out = discoverBundles({ userDir, projectDir });
    const bad = out.find((e) => e.name === "bad");
    expect(bad?.malformed).toBe(true);
    expect(bad?.error).toMatch(/not in the whitelist/);
    expect(bad?.manifest).toBeUndefined();
  });

  it("preserves unknown-field warnings on a healthy entry", () => {
    mkdirSync(userDir, { recursive: true });
    writeFileSync(join(userDir, "warn.md"), "---\nname: warn\nbogusKey: 1\n---\nbody\n");
    const out = discoverBundles({ userDir, projectDir });
    const warn = out.find((e) => e.name === "warn");
    expect(warn?.malformed).toBe(false);
    expect(warn?.warnings?.some((w) => w.includes("bogusKey"))).toBe(true);
  });

  it("a clean entry has neither error nor warnings", () => {
    writeBundleFile(userDir, "clean");
    const clean = discoverBundles({ userDir, projectDir }).find((e) => e.name === "clean");
    expect(clean?.error).toBeUndefined();
    expect(clean?.warnings).toBeUndefined();
  });
});
