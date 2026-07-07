import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BundleEntry } from "../../../src/bundle/discover.ts";
import type { BundleIndex } from "../../../src/bundle/exec.ts";
import { UsageError } from "../../../src/errors.ts";
import { resolveTarget, resolveTargetOrPick } from "../../../src/store/target.ts";
import { cleanup, makeTmpDir } from "../../helpers/tmp.ts";

const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const d of dirs.splice(0)) cleanup(d);
});

function entry(p: Partial<BundleEntry> & { name: string }): BundleEntry {
  return {
    scope: "user",
    path: "/x",
    malformed: false,
    shadowed: false,
    manifest: { name: p.name, sourcePath: "/x", body: "" },
    ...p,
  };
}

function index(entries: BundleEntry[]): BundleIndex {
  return { userDir: "/u", projectDir: "/p", entries };
}

/** Write a .umbel-bundle pin under a fresh project dir; return that dir as cwd (== home). */
function pinnedCwd(lines: string[]): { cwd: string; home: string } {
  const dir = makeTmpDir();
  dirs.push(dir);
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(join(dir, ".umbel-bundle"), lines.join("\n"));
  return { cwd: dir, home: dir };
}

describe("resolveTarget", () => {
  it("--bundle flag wins", () => {
    const res = resolveTarget(index([entry({ name: "web" })]), "web", "/nowhere", "/home");
    expect(res).toMatchObject({ kind: "resolved", via: "flag" });
  });

  it("single-candidate pin resolves that bundle", () => {
    const { cwd, home } = pinnedCwd(["web"]);
    const res = resolveTarget(index([entry({ name: "web" })]), undefined, cwd, home);
    expect(res).toMatchObject({ kind: "resolved", via: "pin" });
  });

  it("multi-candidate pin → multiple", () => {
    const { cwd, home } = pinnedCwd(["web", "api"]);
    const res = resolveTarget(
      index([entry({ name: "web" }), entry({ name: "api" })]),
      undefined,
      cwd,
      home,
    );
    expect(res.kind).toBe("multiple");
  });

  it("vanilla single pin → vanilla", () => {
    const { cwd, home } = pinnedCwd(["__vanilla__"]);
    expect(resolveTarget(index([]), undefined, cwd, home).kind).toBe("vanilla");
  });

  it("no pin → absent", () => {
    expect(resolveTarget(index([]), undefined, "/nowhere", "/home").kind).toBe("absent");
  });

  it("throws UsageError when --bundle names a missing bundle", () => {
    expect(() => resolveTarget(index([]), "ghost", "/n", "/h")).toThrow(UsageError);
  });
});

describe("resolveTargetOrPick", () => {
  const ctx = (interactive: boolean, entries: BundleEntry[]) => ({
    index: index(entries),
    env: {} as NodeJS.ProcessEnv,
    verb: "remove",
    interactive,
    stderr: vi.fn(),
  });

  it("returns the resolved entry and heads-up on user scope", async () => {
    const c = ctx(false, [entry({ name: "web", scope: "user" })]);
    const e = await resolveTargetOrPick(
      { kind: "resolved", entry: c.index.entries[0]!, via: "flag" },
      c,
    );
    expect(e.name).toBe("web");
    expect(c.stderr).toHaveBeenCalled();
  });

  it("no heads-up on project scope", async () => {
    const c = ctx(false, [entry({ name: "web", scope: "project" })]);
    await resolveTargetOrPick({ kind: "resolved", entry: c.index.entries[0]!, via: "flag" }, c);
    expect(c.stderr).not.toHaveBeenCalled();
  });

  it("multiple + non-interactive throws", async () => {
    const c = ctx(false, []);
    await expect(
      resolveTargetOrPick(
        {
          kind: "multiple",
          candidates: [
            { kind: "bundle", name: "a" },
            { kind: "bundle", name: "b" },
          ],
        },
        c,
      ),
    ).rejects.toThrow(UsageError);
  });

  it("absent throws with a hint", async () => {
    const c = ctx(false, []);
    await expect(resolveTargetOrPick({ kind: "absent" }, c)).rejects.toThrow(UsageError);
  });
});
