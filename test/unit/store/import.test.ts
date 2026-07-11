import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConflictError, TrustError, UsageError } from "../../../src/errors.ts";
import { runImport } from "../../../src/store/import.ts";
import { cleanup, makeTmpDir, writeFile } from "../../helpers/tmp.ts";

/** A minimal umbel-shaped plugin dir with skills + agents (no exec content). */
function makePluginDir(dir: string): void {
  writeFile(
    join(dir, ".claude-plugin/plugin.json"),
    JSON.stringify({ name: "dev", description: "d" }),
  );
  writeFile(join(dir, "skills/greet/SKILL.md"), "---\nname: greet\n---\nhello\n");
  writeFile(join(dir, "agents/helper/AGENT.md"), "---\nname: helper\n---\nagent\n");
}

describe("runImport", () => {
  let root: string;
  let env: NodeJS.ProcessEnv;
  let cwd: string;

  beforeEach(() => {
    root = makeTmpDir();
    cwd = join(root, "proj");
    mkdirSync(cwd, { recursive: true });
    env = { NO_TTY: "1", UMBEL_ARTIFACTS_DIR: join(root, "config") };
  });
  afterEach(() => cleanup(root));

  it("mints a user-scope bundle with bare pool refs and materializes artifacts", async () => {
    const dir = join(root, "plugin");
    makePluginDir(dir);
    const code = await runImport([dir], env, cwd);
    expect(code).toBe(0);

    const md = readFileSync(join(root, "config/bundles/dev.md"), "utf8");
    expect(md).toMatch(/name: dev/);
    expect(md).toMatch(/- dev\/greet/);
    expect(md).toMatch(/- dev\/helper/);
    expect(md).not.toMatch(/deps:/);
    expect(existsSync(join(root, "config/bundles/dev.lock"))).toBe(false);

    expect(readFileSync(join(root, "config/skills/dev/greet/SKILL.md"), "utf8")).toContain("hello");
    expect(existsSync(join(root, "config/agents/dev/helper/AGENT.md"))).toBe(true);
  });

  it("takes the name from a positional arg over plugin.json", async () => {
    const dir = join(root, "plugin");
    makePluginDir(dir);
    await runImport([dir, "mine"], env, cwd);
    expect(existsSync(join(root, "config/bundles/mine.md"))).toBe(true);
    expect(readFileSync(join(root, "config/skills/mine/greet/SKILL.md"), "utf8")).toContain(
      "hello",
    );
  });

  it("errors when the bundle name is already taken", async () => {
    const dir = join(root, "plugin");
    makePluginDir(dir);
    writeFile(join(root, "config/bundles/dev.md"), "---\nname: dev\n---\n");
    await expect(runImport([dir], env, cwd)).rejects.toThrow(ConflictError);
  });

  it("errors when the dir is not a plugin (no .claude-plugin/plugin.json)", async () => {
    const dir = join(root, "notplugin");
    writeFile(join(dir, "readme.md"), "x");
    await expect(runImport([dir], env, cwd)).rejects.toThrow(UsageError);
  });

  it("errors when the dir does not exist", async () => {
    await expect(runImport([join(root, "nope")], env, cwd)).rejects.toThrow();
  });

  it("carries name/description/settings from .umbel/bundle.md when present", async () => {
    const dir = join(root, "plugin");
    makePluginDir(dir);
    writeFile(
      join(dir, ".umbel/bundle.md"),
      "---\nname: packed-name\ndescription: from packed\nsettings:\n  model: claude-opus-4-8\n---\n",
    );
    await runImport([dir], env, cwd); // no positional → name from .umbel
    const md = readFileSync(join(root, "config/bundles/packed-name.md"), "utf8");
    expect(md).toMatch(/name: packed-name/);
    expect(md).toMatch(/description: from packed/);
    expect(md).toMatch(/model: claude-opus-4-8/);
    expect(existsSync(join(root, "config/skills/packed-name/greet/SKILL.md"))).toBe(true);
  });

  it("indexes hooks and mcps (multi-kind) into pool refs", async () => {
    const dir = join(root, "plugin");
    makePluginDir(dir);
    writeFile(
      join(dir, "hooks/logit/HOOK.md"),
      "---\nname: logit\nevent: PreToolUse\nmatcher: Bash\ncommand: ./run.sh\n---\n",
    );
    writeFile(join(dir, "hooks/logit/run.sh"), "#!/bin/sh\n");
    writeFile(join(dir, "mcps/db/MCP.md"), "---\nname: db\ncommand: ./serve\n---\n");
    writeFile(join(dir, "mcps/db/serve"), "#!/bin/sh\n");
    await runImport([dir, "--yes"], env, cwd);
    const md = readFileSync(join(root, "config/bundles/dev.md"), "utf8");
    expect(md).toMatch(/- dev\/logit/);
    expect(md).toMatch(/- dev\/db/);
    expect(existsSync(join(root, "config/hooks/dev/logit/HOOK.md"))).toBe(true);
    expect(existsSync(join(root, "config/mcps/dev/db/serve"))).toBe(true);
  });

  it("fails closed (exit 5 / TrustError) on a non-TTY when the plugin ships hook/MCP content", async () => {
    const dir = join(root, "plugin");
    makePluginDir(dir);
    writeFile(
      join(dir, "hooks/logit/HOOK.md"),
      "---\nname: logit\nevent: PreToolUse\nmatcher: Bash\ncommand: ./run.sh\n---\n",
    );
    writeFile(join(dir, "hooks/logit/run.sh"), "#!/bin/sh\necho hi\n");
    // env is NO_TTY → gate fails closed; nothing should be written.
    await expect(runImport([dir], env, cwd)).rejects.toThrow(TrustError);
    expect(existsSync(join(root, "config/bundles/dev.md"))).toBe(false);
    expect(existsSync(join(root, "config/hooks/dev/logit"))).toBe(false);
  });

  it("--yes trusts hook/MCP content on a non-TTY", async () => {
    const dir = join(root, "plugin");
    makePluginDir(dir);
    writeFile(
      join(dir, "hooks/logit/HOOK.md"),
      "---\nname: logit\nevent: PreToolUse\nmatcher: Bash\ncommand: ./run.sh\n---\n",
    );
    writeFile(join(dir, "hooks/logit/run.sh"), "#!/bin/sh\necho hi\n");
    const code = await runImport([dir, "--yes"], env, cwd);
    expect(code).toBe(0);
    expect(existsSync(join(root, "config/hooks/dev/logit/HOOK.md"))).toBe(true);
    expect(readFileSync(join(root, "config/bundles/dev.md"), "utf8")).toMatch(/- dev\/logit/);
  });

  it("errors on a present but corrupt .umbel/bundle.md", async () => {
    const dir = join(root, "plugin");
    makePluginDir(dir);
    writeFile(
      join(dir, ".umbel/bundle.md"),
      "---\nname: {unterminated\ndescription: [also-bad\n---\n",
    );
    await expect(runImport([dir], env, cwd)).rejects.toThrow();
  });
});
