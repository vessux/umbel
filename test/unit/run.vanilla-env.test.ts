import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Capture the env handed to the spawned `claude` without launching it. Mocking
// node:child_process is scoped to this file, so it does not affect the
// real-spawn run tests in run.bundle-run.test.ts.
const { spawnSyncMock } = vi.hoisted(() => ({
  spawnSyncMock: vi.fn((..._args: unknown[]) => ({ status: 0 })),
}));
vi.mock("node:child_process", () => ({ spawnSync: spawnSyncMock }));

import { run } from "../../src/run.ts";
import { cleanup, makeTmpDir } from "../helpers/tmp.ts";

describe("run() vanilla path spawn env", () => {
  let agentsDir: string;
  let cacheDir: string;
  let cwd: string;

  beforeEach(() => {
    agentsDir = makeTmpDir("agents-");
    cacheDir = makeTmpDir("cache-");
    cwd = makeTmpDir("cwd-");
    mkdirSync(join(agentsDir, "bundles"), { recursive: true });
    spawnSyncMock.mockClear();
  });
  afterEach(() => {
    cleanup(agentsDir);
    cleanup(cacheDir);
    cleanup(cwd);
  });

  function envWith(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    return { UMBEL_ARTIFACTS_DIR: agentsDir, UMBEL_CACHE_DIR: cacheDir, ...extra };
  }

  function spawnEnv(): NodeJS.ProcessEnv {
    expect(spawnSyncMock).toHaveBeenCalledTimes(1);
    const opts = spawnSyncMock.mock.calls[0]![2] as { env: NodeJS.ProcessEnv };
    return opts.env;
  }

  it("sets UMBEL_RESOLVED but neither UMBEL_RESOLVED_DIR nor UMBEL_BUNDLE_VERSION", async () => {
    await run(["run"], envWith({ NO_TTY: "1", UMBEL_BUNDLE: "__vanilla__" }), cwd);
    const e = spawnEnv();
    expect(e.UMBEL_RESOLVED).toBe("1");
    expect(e.UMBEL_RESOLVED_DIR).toBeUndefined();
    expect(e.UMBEL_BUNDLE_VERSION).toBeUndefined();
  });
});
