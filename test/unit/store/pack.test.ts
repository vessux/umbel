import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConflictError } from "../../../src/errors.ts";
import { runPack } from "../../../src/store/pack.ts";
import { cleanup, makeTmpDir, writeFile } from "../../helpers/tmp.ts";

describe("runPack", () => {
  let root: string;
  let env: NodeJS.ProcessEnv;
  let cwd: string;

  beforeEach(() => {
    root = makeTmpDir();
    writeFile(join(root, "config/skills/src/greet/SKILL.md"), "---\nname: greet\n---\nhello\n");
    writeFile(join(root, "config/agents/src/helper/AGENT.md"), "---\nname: helper\n---\nagent\n");
    writeFile(
      join(root, "config/hooks/src/logit/HOOK.md"),
      "---\nname: logit\nevent: PreToolUse\nmatcher: Bash\ncommand: ./run.sh\n---\n",
    );
    writeFile(join(root, "config/hooks/src/logit/run.sh"), "#!/bin/sh\necho hi\n");
    writeFile(join(root, "config/mcps/src/db/MCP.md"), "---\nname: db\ncommand: ./serve\n---\n");
    writeFile(join(root, "config/mcps/src/db/serve"), "#!/bin/sh\n");
    writeFile(
      join(root, "config/bundles/dev.md"),
      "---\nname: dev\ndescription: my dev bundle\nskills:\n  - src/greet\nagents:\n  - src/helper\nhooks:\n  - src/logit\nmcps:\n  - src/db\n---\n",
    );
    cwd = join(root, "proj");
    mkdirSync(cwd, { recursive: true });
    env = {
      NO_TTY: "1",
      UMBEL_ARTIFACTS_DIR: join(root, "config"),
      UMBEL_DATA_DIR: join(root, "data"),
      UMBEL_CACHE_DIR: join(root, "cache"),
    };
  });
  afterEach(() => cleanup(root));

  it("emits a plugin dir with copied (not symlinked) skills/agents", async () => {
    const out = join(root, "out");
    const code = await runPack(["dev", "--out", out], env, cwd);
    expect(code).toBe(0);
    expect(JSON.parse(readFileSync(join(out, ".claude-plugin/plugin.json"), "utf8")).name).toBe(
      "dev",
    );
    const skill = join(out, "skills/greet");
    expect(lstatSync(skill).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(skill, "SKILL.md"), "utf8")).toContain("hello");
    expect(lstatSync(join(out, "agents/helper")).isSymbolicLink()).toBe(false);
  });

  it("rewrites MCP commands to ${CLAUDE_PLUGIN_ROOT} (plugin-native)", async () => {
    const out = join(root, "out");
    await runPack(["dev", "--out", out], env, cwd);
    const mcp = JSON.parse(readFileSync(join(out, ".mcp.json"), "utf8"));
    expect(mcp.mcpServers.db.command).toBe("${CLAUDE_PLUGIN_ROOT}/mcps/db/serve");
  });

  it("emits plugin hooks.json with ${CLAUDE_PLUGIN_ROOT} and no settings.json", async () => {
    const out = join(root, "out");
    await runPack(["dev", "--out", out], env, cwd);
    const hooks = JSON.parse(readFileSync(join(out, "hooks/hooks.json"), "utf8"));
    expect(hooks.hooks.PreToolUse[0].hooks[0].command).toBe(
      "${CLAUDE_PLUGIN_ROOT}/hooks/logit/run.sh",
    );
    expect(existsSync(join(out, "settings.json"))).toBe(false);
  });

  it("defaults --out to the bundle name under cwd", async () => {
    const code = await runPack(["dev"], env, cwd);
    expect(code).toBe(0);
    expect(existsSync(join(cwd, "dev/.claude-plugin/plugin.json"))).toBe(true);
  });

  it("errors when the output dir already exists", async () => {
    const out = join(root, "out");
    mkdirSync(out, { recursive: true });
    await expect(runPack(["dev", "--out", out], env, cwd)).rejects.toThrow(ConflictError);
  });
});
