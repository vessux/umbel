import { existsSync, mkdirSync, readFileSync, symlinkSync } from "node:fs";
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

  it("replays conversion warnings on a cache hit", () => {
    writeFile(join(checkout, ".claude-plugin/plugin.json"), JSON.stringify({ name: "kit" }));
    writeFile(join(checkout, "commands/do.md"), "---\nname: do\n---\n");
    const r1 = ensureNormalized(checkout, store);
    expect(r1.warnings.join(" ")).toMatch(/command/i);
    const r2 = ensureNormalized(checkout, store);
    expect(r2.dir).toBe(r1.dir);
    expect(r2.warnings).toEqual(r1.warnings);
    expect(r2.warnings.length).toBeGreaterThan(0);
  });
});

describe("normalizeRepo — hooks.json conversion (branches)", () => {
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

  it("disambiguates two hooks under one event+matcher (both kept)", () => {
    writeFile(join(src, ".claude-plugin/plugin.json"), JSON.stringify({ name: "kit" }));
    writeFile(
      join(src, "hooks/hooks.json"),
      JSON.stringify({
        hooks: {
          Stop: [
            {
              matcher: "",
              hooks: [
                { type: "command", command: "echo a" },
                { type: "command", command: "echo b" },
              ],
            },
          ],
        },
      }),
    );
    const { artifacts } = normalizeRepo(src, dest);
    const hooks = artifacts.filter((a) => a.kind === "hooks");
    expect(hooks).toHaveLength(2);
    expect(new Set(hooks.map((h) => h.leaf)).size).toBe(2);
    for (const h of hooks) expect(existsSync(join(h.dir, "HOOK.md"))).toBe(true);
  });

  it("honors a custom plugin.hooks dir path", () => {
    writeFile(
      join(src, ".claude-plugin/plugin.json"),
      JSON.stringify({ name: "kit", hooks: "cfg" }),
    );
    writeFile(
      join(src, "cfg/hooks.json"),
      JSON.stringify({
        hooks: { Stop: [{ matcher: "", hooks: [{ type: "command", command: "echo x" }] }] },
      }),
    );
    const { artifacts } = normalizeRepo(src, dest);
    expect(artifacts.filter((a) => a.kind === "hooks")).toHaveLength(1);
  });

  it("warns honestly when a literal-led command carries a plugin-root arg", () => {
    writeFile(join(src, ".claude-plugin/plugin.json"), JSON.stringify({ name: "kit" }));
    writeFile(
      join(src, "hooks/hooks.json"),
      JSON.stringify({
        hooks: {
          Stop: [
            {
              matcher: "",
              hooks: [{ type: "command", command: "bash ${CLAUDE_PLUGIN_ROOT}/x.sh" }],
            },
          ],
        },
      }),
    );
    const { warnings } = normalizeRepo(src, dest);
    expect(warnings.join(" ")).toMatch(/does not start with it/);
  });
});

describe("normalizeRepo — path containment", () => {
  let outer: string;
  let checkout: string;
  let dest: string;
  beforeEach(() => {
    outer = makeTmpDir("umbel-outer-");
    checkout = join(outer, "repo");
    dest = makeTmpDir("umbel-dest-");
  });
  afterEach(() => {
    cleanup(outer);
    cleanup(dest);
  });

  it("refuses a ${CLAUDE_PLUGIN_ROOT}/../ traversal in a hook command", () => {
    writeFile(join(outer, "escape.sh"), "#!/bin/sh\necho pwned\n");
    writeFile(join(checkout, ".claude-plugin/plugin.json"), JSON.stringify({ name: "kit" }));
    writeFile(
      join(checkout, "hooks/hooks.json"),
      JSON.stringify({
        hooks: {
          Stop: [
            {
              matcher: "",
              hooks: [{ type: "command", command: "${CLAUDE_PLUGIN_ROOT}/../escape.sh" }],
            },
          ],
        },
      }),
    );
    const { artifacts, warnings } = normalizeRepo(checkout, dest);
    const hook = artifacts.find((a) => a.kind === "hooks")!;
    const md = readFileSync(join(hook.dir, "HOOK.md"), "utf8");
    expect(md).toContain("${CLAUDE_PLUGIN_ROOT}");
    expect(existsSync(join(hook.dir, "escape.sh"))).toBe(false);
    expect(existsSync(join(dest, "hooks/escape.sh"))).toBe(false);
    expect(warnings.join(" ")).toMatch(/escapes/);
  });

  it("refuses a plugin.agents path that escapes the repo", () => {
    writeFile(join(outer, "evil/secret.md"), "---\nname: secret\n---\n");
    writeFile(
      join(checkout, ".claude-plugin/plugin.json"),
      JSON.stringify({ name: "kit", agents: "../evil" }),
    );
    const { artifacts, warnings } = normalizeRepo(checkout, dest);
    expect(artifacts.some((a) => a.kind === "agents")).toBe(false);
    expect(warnings.join(" ")).toMatch(/escapes/);
  });
});

describe("normalizeRepo — symlink containment", () => {
  let outer: string;
  let checkout: string;
  let dest: string;
  beforeEach(() => {
    outer = makeTmpDir("umbel-outer-");
    checkout = join(outer, "repo");
    dest = makeTmpDir("umbel-dest-");
  });
  afterEach(() => {
    cleanup(outer);
    cleanup(dest);
  });

  it("refuses a hook script that is a symlink escaping the checkout", () => {
    const secret = join(outer, "secret.txt");
    writeFile(secret, "TOP-SECRET-BYTES\n");
    writeFile(join(checkout, ".claude-plugin/plugin.json"), JSON.stringify({ name: "kit" }));
    writeFile(
      join(checkout, "hooks/hooks.json"),
      JSON.stringify({
        hooks: {
          Stop: [
            {
              matcher: "",
              hooks: [{ type: "command", command: "${CLAUDE_PLUGIN_ROOT}/scripts/log.sh" }],
            },
          ],
        },
      }),
    );
    // scripts/log.sh is a symlink pointing at the outer secret file.
    mkdirSync(join(checkout, "scripts"), { recursive: true });
    symlinkSync(secret, join(checkout, "scripts/log.sh"));

    const { artifacts, warnings } = normalizeRepo(checkout, dest);
    const hook = artifacts.find((a) => a.kind === "hooks")!;
    const md = readFileSync(join(hook.dir, "HOOK.md"), "utf8");
    expect(md).toContain("${CLAUDE_PLUGIN_ROOT}"); // left unconverted
    expect(existsSync(join(hook.dir, "scripts/log.sh"))).toBe(false);
    expect(warnings.join(" ")).toMatch(/escapes/);
  });

  it("refuses an agents dir that is a symlink escaping the checkout", () => {
    writeFile(join(outer, "elsewhere/rev.md"), "---\nname: rev\n---\n");
    writeFile(join(checkout, ".claude-plugin/plugin.json"), JSON.stringify({ name: "kit" }));
    symlinkSync(join(outer, "elsewhere"), join(checkout, "agents"));

    const { artifacts, warnings } = normalizeRepo(checkout, dest);
    expect(artifacts.some((a) => a.kind === "agents")).toBe(false);
    expect(warnings.join(" ")).toMatch(/escapes/);
  });

  it("copies an in-checkout symlink sidecar without warning (no false positive)", () => {
    writeFile(join(checkout, "skills/s/SKILL.md"), "---\nname: s\n---\n");
    writeFile(join(checkout, "skills/s/real.txt"), "REAL\n");
    symlinkSync(join(checkout, "skills/s/real.txt"), join(checkout, "skills/s/link.txt"));

    const { artifacts, warnings } = normalizeRepo(checkout, dest);
    const skill = artifacts.find((a) => a.kind === "skills" && a.leaf === "s")!;
    expect(readFileSync(join(skill.dir, "link.txt"), "utf8")).toBe("REAL\n");
    expect(warnings.join(" ")).not.toMatch(/escapes/);
  });
});

describe("normalizeRepo — symlink containment (config reads)", () => {
  let outer: string;
  let checkout: string;
  let dest: string;
  beforeEach(() => {
    outer = makeTmpDir("umbel-outer-");
    checkout = join(outer, "repo");
    dest = makeTmpDir("umbel-dest-");
  });
  afterEach(() => {
    cleanup(outer);
    cleanup(dest);
  });

  it("refuses a lone SKILL.md that is a symlink escaping the checkout", () => {
    const secret = join(outer, "secret.md");
    writeFile(secret, "---\nname: pwned\n---\nleak\n");
    mkdirSync(checkout, { recursive: true });
    symlinkSync(secret, join(checkout, "SKILL.md"));

    const { artifacts, warnings } = normalizeRepo(checkout, dest);
    expect(artifacts.some((a) => a.kind === "skills")).toBe(false);
    expect(warnings.join(" ")).toMatch(/escapes/);
  });

  it("refuses a .claude-plugin/plugin.json that is a symlink escaping the checkout", () => {
    const secret = join(outer, "plugin.json");
    writeFile(secret, JSON.stringify({ name: "kit" }));
    mkdirSync(join(checkout, ".claude-plugin"), { recursive: true });
    symlinkSync(secret, join(checkout, ".claude-plugin/plugin.json"));
    writeFile(join(checkout, "agents/reviewer.md"), "---\nname: reviewer\n---\n");

    const { artifacts, warnings } = normalizeRepo(checkout, dest);
    expect(artifacts.some((a) => a.kind === "agents")).toBe(false);
    expect(warnings.join(" ")).toMatch(/escapes/);
  });

  it("refuses a hooks.json that is a symlink escaping the checkout", () => {
    const secret = join(outer, "hooks.json");
    writeFile(
      secret,
      JSON.stringify({
        hooks: { Stop: [{ matcher: "", hooks: [{ type: "command", command: "echo pwned" }] }] },
      }),
    );
    writeFile(join(checkout, ".claude-plugin/plugin.json"), JSON.stringify({ name: "kit" }));
    mkdirSync(join(checkout, "hooks"), { recursive: true });
    symlinkSync(secret, join(checkout, "hooks/hooks.json"));

    const { artifacts, warnings } = normalizeRepo(checkout, dest);
    expect(artifacts.some((a) => a.kind === "hooks")).toBe(false);
    expect(warnings.join(" ")).toMatch(/escapes/);
  });

  it("refuses a root .mcp.json that is a symlink escaping the checkout", () => {
    const secret = join(outer, "mcp.json");
    writeFile(secret, JSON.stringify({ mcpServers: { srv: { command: "echo pwned" } } }));
    writeFile(join(checkout, ".claude-plugin/plugin.json"), JSON.stringify({ name: "kit" }));
    symlinkSync(secret, join(checkout, ".mcp.json"));

    const { artifacts, warnings } = normalizeRepo(checkout, dest);
    expect(artifacts.some((a) => a.kind === "mcps")).toBe(false);
    expect(warnings.join(" ")).toMatch(/escapes/);
  });

  it("refuses a .claude-plugin dir that is a symlink escaping the checkout", () => {
    writeFile(join(outer, "plugindir/plugin.json"), JSON.stringify({ name: "kit" }));
    mkdirSync(checkout, { recursive: true });
    symlinkSync(join(outer, "plugindir"), join(checkout, ".claude-plugin"));
    writeFile(join(checkout, "agents/reviewer.md"), "---\nname: reviewer\n---\n");

    const { artifacts, warnings } = normalizeRepo(checkout, dest);
    expect(artifacts.some((a) => a.kind === "agents")).toBe(false);
    expect(warnings.join(" ")).toMatch(/escapes/);
  });

  it("refuses a custom plugin.hooks dir that is a symlink escaping the checkout", () => {
    writeFile(
      join(outer, "cfg/hooks.json"),
      JSON.stringify({
        hooks: { Stop: [{ matcher: "", hooks: [{ type: "command", command: "echo pwned" }] }] },
      }),
    );
    writeFile(
      join(checkout, ".claude-plugin/plugin.json"),
      JSON.stringify({ name: "kit", hooks: "cfg" }),
    );
    symlinkSync(join(outer, "cfg"), join(checkout, "cfg"));

    const { artifacts, warnings } = normalizeRepo(checkout, dest);
    expect(artifacts.some((a) => a.kind === "hooks")).toBe(false);
    expect(warnings.join(" ")).toMatch(/escapes/);
  });
});
