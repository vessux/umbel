import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { normalizeRepo } from "../../../src/store/normalize.ts";
import { cleanup, makeTmpDir, writeFile } from "../../helpers/tmp.ts";

describe("normalizeRepo — skills", () => {
  let src: string;
  let dest: string;
  beforeEach(() => {
    src = makeTmpDir("umbel-src-");
    dest = makeTmpDir("umbel-dest-");
  });
  afterEach(() => {
    cleanup(src);
    cleanup(dest);
  });

  it("detects a skills/ tree", () => {
    writeFile(join(src, "skills/greet/SKILL.md"), "---\nname: greet\n---\nhi\n");
    writeFile(join(src, "skills/greet/run.sh"), "echo hi\n");
    const { artifacts } = normalizeRepo(src, dest);
    expect(artifacts).toEqual([{ kind: "skills", leaf: "greet", dir: join(dest, "skills/greet") }]);
    expect(readFileSync(join(dest, "skills/greet/SKILL.md"), "utf8")).toContain("greet");
    expect(existsSync(join(dest, "skills/greet/run.sh"))).toBe(true);
  });

  it("detects a repo-of-dirs (<leaf>/SKILL.md at root)", () => {
    writeFile(join(src, "greet/SKILL.md"), "---\nname: greet\n---\nhi\n");
    const { artifacts } = normalizeRepo(src, dest);
    expect(artifacts).toEqual([{ kind: "skills", leaf: "greet", dir: join(dest, "skills/greet") }]);
  });

  it("detects a lone SKILL.md at the repo root (leaf = frontmatter name)", () => {
    writeFile(join(src, "SKILL.md"), "---\nname: solo\n---\nhi\n");
    const { artifacts } = normalizeRepo(src, dest);
    expect(artifacts.map((a) => [a.kind, a.leaf])).toEqual([["skills", "solo"]]);
    expect(existsSync(join(dest, "skills/solo/SKILL.md"))).toBe(true);
  });

  it("returns no artifacts for an empty repo", () => {
    const { artifacts } = normalizeRepo(src, dest);
    expect(artifacts).toEqual([]);
  });
});

describe("normalizeRepo — all kinds + framework", () => {
  let src: string;
  let dest: string;
  beforeEach(() => {
    src = makeTmpDir("umbel-src-");
    dest = makeTmpDir("umbel-dest-");
  });
  afterEach(() => {
    cleanup(src);
    cleanup(dest);
  });

  it("indexes agents/, hooks/, mcps/ trees alongside skills/", () => {
    writeFile(join(src, "skills/s/SKILL.md"), "---\nname: s\n---\n");
    writeFile(join(src, "agents/a/AGENT.md"), "---\nname: a\n---\n");
    writeFile(
      join(src, "hooks/h/HOOK.md"),
      '---\nname: h\nevent: Stop\nmatcher: ""\ncommand: ./x.sh\n---\n',
    );
    writeFile(join(src, "hooks/h/x.sh"), "echo\n");
    writeFile(join(src, "mcps/m/MCP.md"), "---\nname: m\ncommand: ./srv\n---\n");
    const { artifacts } = normalizeRepo(src, dest);
    expect(artifacts.map((a) => `${a.kind}/${a.leaf}`).sort()).toEqual([
      "agents/a",
      "hooks/h",
      "mcps/m",
      "skills/s",
    ]);
    expect(existsSync(join(dest, "hooks/h/x.sh"))).toBe(true);
  });
});

describe("normalizeRepo — .claude-plugin layout", () => {
  let src: string;
  let dest: string;
  beforeEach(() => {
    src = makeTmpDir("umbel-src-");
    dest = makeTmpDir("umbel-dest-");
  });
  afterEach(() => {
    cleanup(src);
    cleanup(dest);
  });

  it("wraps a CC agent .md file into agents/<name>/AGENT.md", () => {
    writeFile(join(src, ".claude-plugin/plugin.json"), JSON.stringify({ name: "kit" }));
    writeFile(join(src, "skills/s/SKILL.md"), "---\nname: s\n---\n");
    writeFile(join(src, "agents/reviewer.md"), "---\nname: reviewer\ndescription: r\n---\nbody\n");
    const { artifacts } = normalizeRepo(src, dest);
    expect(artifacts.map((a) => `${a.kind}/${a.leaf}`).sort()).toEqual([
      "agents/reviewer",
      "skills/s",
    ]);
    expect(readFileSync(join(dest, "agents/reviewer/AGENT.md"), "utf8")).toContain("reviewer");
  });

  it("skips commands/*.md with a warning", () => {
    writeFile(join(src, ".claude-plugin/plugin.json"), JSON.stringify({ name: "kit" }));
    writeFile(join(src, "commands/do.md"), "---\nname: do\n---\n");
    const { artifacts, warnings } = normalizeRepo(src, dest);
    expect(artifacts).toEqual([]);
    expect(warnings.join(" ")).toMatch(/command/i);
  });

  it("honors a custom plugin.agents path", () => {
    writeFile(
      join(src, ".claude-plugin/plugin.json"),
      JSON.stringify({ name: "kit", agents: "assistants" }),
    );
    writeFile(join(src, "assistants/rev.md"), "---\nname: rev\n---\n");
    const { artifacts } = normalizeRepo(src, dest);
    expect(artifacts.map((a) => `${a.kind}/${a.leaf}`)).toEqual(["agents/rev"]);
    expect(existsSync(join(dest, "agents/rev/AGENT.md"))).toBe(true);
  });

  it("warns and skips the plugin layout when plugin.json is malformed", () => {
    writeFile(join(src, ".claude-plugin/plugin.json"), "{ not json");
    writeFile(join(src, "agents/reviewer.md"), "---\nname: reviewer\n---\n");
    const { artifacts, warnings } = normalizeRepo(src, dest);
    expect(artifacts).toEqual([]);
    expect(warnings.join(" ")).toMatch(/malformed/i);
  });
});

describe("normalizeRepo — edge branches", () => {
  let src: string;
  let dest: string;
  beforeEach(() => {
    src = makeTmpDir("umbel-src-");
    dest = makeTmpDir("umbel-dest-");
  });
  afterEach(() => {
    cleanup(src);
    cleanup(dest);
  });

  it("dedups a skills/ tree entry against a root repo-of-dirs of the same leaf", () => {
    writeFile(join(src, "skills/greet/SKILL.md"), "---\nname: greet\n---\ntree\n");
    writeFile(join(src, "greet/SKILL.md"), "---\nname: greet\n---\nroot\n");
    const { artifacts, warnings } = normalizeRepo(src, dest);
    expect(artifacts.map((a) => `${a.kind}/${a.leaf}`)).toEqual(["skills/greet"]);
    expect(warnings.join(" ")).toMatch(/duplicate/);
  });

  it("falls back to the repo basename for a lone SKILL.md with no name field", () => {
    const repo = join(src, "myrepo");
    writeFile(join(repo, "SKILL.md"), "---\ndescription: d\n---\nx\n");
    const { artifacts } = normalizeRepo(repo, dest);
    expect(artifacts.map((a) => `${a.kind}/${a.leaf}`)).toEqual(["skills/myrepo"]);
  });
});
