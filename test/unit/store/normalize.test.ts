import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashTree } from "../../../src/store/content-hash.ts";
import { ensureNormalized, normalizeRepo } from "../../../src/store/normalize.ts";
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

describe("normalizeRepo — hooks.json conversion", () => {
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

  it("converts a plugin-root script hook, copying the script + rewriting to ./", () => {
    writeFile(join(src, ".claude-plugin/plugin.json"), JSON.stringify({ name: "kit" }));
    writeFile(
      join(src, "hooks/hooks.json"),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [
                { type: "command", command: "${CLAUDE_PLUGIN_ROOT}/scripts/log.sh", timeout: 5 },
              ],
            },
          ],
        },
      }),
    );
    writeFile(join(src, "scripts/log.sh"), "#!/bin/sh\necho hi\n");
    const { artifacts } = normalizeRepo(src, dest);
    const hooks = artifacts.filter((a) => a.kind === "hooks");
    expect(hooks).toHaveLength(1);
    const hookMd = readFileSync(join(hooks[0]!.dir, "HOOK.md"), "utf8");
    expect(hookMd).toMatch(/event: PreToolUse/);
    expect(hookMd).toMatch(/matcher: Bash/);
    // relpath preserved so sibling files resolve; quoting may vary per yaml lib
    expect(hookMd).toMatch(/command:\s*["']?\.\/scripts\/log\.sh/);
    expect(hookMd).toMatch(/timeout: 5/);
    expect(existsSync(join(hooks[0]!.dir, "scripts/log.sh"))).toBe(true);
  });

  it("passes a literal command through verbatim (no sidecar copy)", () => {
    writeFile(join(src, ".claude-plugin/plugin.json"), JSON.stringify({ name: "kit" }));
    writeFile(
      join(src, "hooks/hooks.json"),
      JSON.stringify({
        hooks: { Stop: [{ matcher: "", hooks: [{ type: "command", command: "jq ." }] }] },
      }),
    );
    const { artifacts } = normalizeRepo(src, dest);
    const hook = artifacts.find((a) => a.kind === "hooks")!;
    expect(readFileSync(join(hook.dir, "HOOK.md"), "utf8")).toMatch(/command:\s*["']?jq \./);
  });
});

describe("normalizeRepo — mcpServers conversion", () => {
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

  it("converts inline plugin.json.mcpServers to MCP.md (literal command verbatim)", () => {
    writeFile(
      join(src, ".claude-plugin/plugin.json"),
      JSON.stringify({ name: "kit", mcpServers: { db: { command: "npx", args: ["duckdb-mcp"] } } }),
    );
    const { artifacts } = normalizeRepo(src, dest);
    const mcp = artifacts.find((a) => a.kind === "mcps" && a.leaf === "db")!;
    const md = readFileSync(join(mcp.dir, "MCP.md"), "utf8");
    expect(md).toMatch(/name: db/);
    expect(md).toMatch(/command:\s*["']?npx/);
    expect(md).toMatch(/duckdb-mcp/);
  });

  it("converts a root .mcp.json server with a plugin-root command", () => {
    writeFile(join(src, ".claude-plugin/plugin.json"), JSON.stringify({ name: "kit" }));
    writeFile(
      join(src, ".mcp.json"),
      JSON.stringify({ mcpServers: { srv: { command: "${CLAUDE_PLUGIN_ROOT}/bin/srv" } } }),
    );
    writeFile(join(src, "bin/srv"), "#!/bin/sh\n");
    const { artifacts } = normalizeRepo(src, dest);
    const mcp = artifacts.find((a) => a.kind === "mcps" && a.leaf === "srv")!;
    expect(readFileSync(join(mcp.dir, "MCP.md"), "utf8")).toMatch(/command:\s*["']?\.\/bin\/srv/);
    expect(existsSync(join(mcp.dir, "bin/srv"))).toBe(true);
  });
});

describe("ensureNormalized", () => {
  let checkout: string;
  let store: string;
  beforeEach(() => {
    checkout = makeTmpDir("umbel-co-");
    store = makeTmpDir("umbel-store-");
    writeFile(join(checkout, "skills/s/SKILL.md"), "---\nname: s\n---\n");
  });
  afterEach(() => {
    cleanup(checkout);
    cleanup(store);
  });

  it("materializes into <store>/derived/<contentHash> and reuses it on repeat", () => {
    const ch = hashTree(checkout);
    const r1 = ensureNormalized(checkout, store);
    expect(r1.dir).toBe(join(store, "derived", ch));
    expect(existsSync(join(r1.dir, "skills/s/SKILL.md"))).toBe(true);
    expect(r1.artifacts.map((a) => `${a.kind}/${a.leaf}`)).toEqual(["skills/s"]);
    const r2 = ensureNormalized(checkout, store);
    expect(r2.dir).toBe(r1.dir);
    expect(r2.artifacts.map((a) => `${a.kind}/${a.leaf}`)).toEqual(["skills/s"]);
  });
});
