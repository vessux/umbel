import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compile } from "../../../src/bundle/compile.ts";
import { loadBundleIndex, resolveBundle } from "../../../src/bundle/exec.ts";
import { runImport } from "../../../src/store/import.ts";
import { runPack } from "../../../src/store/pack.ts";
import { cleanup, makeTmpDir, writeFile } from "../../helpers/tmp.ts";

/** For a compiled cache dir, map each kind's canonical name → its main .md bytes. */
function compiledArtifacts(cacheDir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const kinds: Record<string, string> = {
    skills: "SKILL.md",
    agents: "AGENT.md",
    hooks: "HOOK.md",
    mcps: "MCP.md",
  };
  for (const [kind, md] of Object.entries(kinds)) {
    let names: string[];
    try {
      names = readdirSync(join(cacheDir, kind));
    } catch {
      continue;
    }
    for (const n of names.sort()) {
      try {
        out[`${kind}/${n}`] = readFileSync(join(cacheDir, kind, n, md), "utf8");
      } catch {}
    }
  }
  return out;
}

function buildOnce(env: NodeJS.ProcessEnv, cwd: string, name: string): string {
  const index = loadBundleIndex(env, cwd);
  const { resolved, sources } = resolveBundle(name, index, env, { materialize: true });
  return compile(resolved, sources, { cacheRoot: env.UMBEL_CACHE_DIR! }).cacheDir;
}

describe("pack → import round-trip", () => {
  let root: string;
  let cwd: string;

  beforeEach(() => {
    root = makeTmpDir();
    cwd = join(root, "proj");
    mkdirSync(cwd, { recursive: true });
    writeFile(join(root, "a/skills/src/greet/SKILL.md"), "---\nname: greet\n---\nhello\n");
    writeFile(join(root, "a/agents/src/helper/AGENT.md"), "---\nname: helper\n---\nagent body\n");
    writeFile(
      join(root, "a/bundles/dev.md"),
      "---\nname: dev\ndescription: d\nskills:\n  - src/greet\nagents:\n  - src/helper\n---\n",
    );
  });
  afterEach(() => cleanup(root));

  it("yields an equivalent resolved bundle (same artifact bytes)", async () => {
    const envA = {
      NO_TTY: "1",
      UMBEL_ARTIFACTS_DIR: join(root, "a"),
      UMBEL_DATA_DIR: join(root, "a-data"),
      UMBEL_CACHE_DIR: join(root, "a-cache"),
    };
    const original = compiledArtifacts(buildOnce(envA, cwd, "dev"));

    const out = join(root, "packed");
    await runPack(["dev", "--out", out], envA, cwd);

    const envB = {
      NO_TTY: "1",
      UMBEL_ARTIFACTS_DIR: join(root, "b"),
      UMBEL_DATA_DIR: join(root, "b-data"),
      UMBEL_CACHE_DIR: join(root, "b-cache"),
    };
    await runImport([out, "dev"], envB, cwd);
    const reimported = compiledArtifacts(buildOnce(envB, cwd, "dev"));

    expect(reimported).toEqual(original);
  });

  it("imports a plain (non-umbel) plugin dir into a usable bundle (AC4)", async () => {
    const dir = join(root, "plain");
    writeFile(join(dir, ".claude-plugin/plugin.json"), JSON.stringify({ name: "thirdparty" }));
    writeFile(join(dir, "skills/tool/SKILL.md"), "---\nname: tool\n---\nwork\n");
    const envB = {
      NO_TTY: "1",
      UMBEL_ARTIFACTS_DIR: join(root, "b"),
      UMBEL_DATA_DIR: join(root, "b-data"),
      UMBEL_CACHE_DIR: join(root, "b-cache"),
    };
    await runImport([dir], envB, cwd);
    const compiled = compiledArtifacts(buildOnce(envB, cwd, "thirdparty"));
    expect(compiled["skills/tool"]).toContain("work");
  });
});
