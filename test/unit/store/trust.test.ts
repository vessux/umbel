import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decideTrust, listExecArtifacts } from "../../../src/store/trust.ts";
import { cleanup, makeTmpDir, writeFile } from "../../helpers/tmp.ts";

describe("listExecArtifacts", () => {
  let root: string;
  beforeEach(() => {
    root = makeTmpDir();
  });
  afterEach(() => cleanup(root));

  it("finds hooks and mcps under kind subdirs and at the root, ignoring skills/agents", () => {
    writeFile(join(root, "skills/greet/SKILL.md"), "---\nname: greet\n---\nhi\n");
    writeFile(join(root, "agents/pair/AGENT.md"), "---\nname: pair\n---\nhi\n");
    writeFile(join(root, "hooks/fmt/HOOK.md"), "---\nevent: PostToolUse\ncommand: ./run.sh\n---\n");
    writeFile(join(root, "hooks/fmt/run.sh"), "#!/bin/sh\necho fmt\n");
    writeFile(join(root, "mcps/db/MCP.md"), "---\ncommand: ./serve.sh\n---\n");
    writeFile(join(root, "lonehook/HOOK.md"), "---\nevent: Stop\ncommand: ./x.sh\n---\n");

    const arts = listExecArtifacts(root);
    const refs = arts.map((a) => a.ref).sort();
    expect(refs).toEqual(["hooks/fmt", "hooks/lonehook", "mcps/db"]);
    for (const a of arts) expect(a.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns [] for a skill-only checkout", () => {
    writeFile(join(root, "skills/greet/SKILL.md"), "---\nname: greet\n---\nhi\n");
    expect(listExecArtifacts(root)).toEqual([]);
  });

  it("returns [] for a nonexistent checkout dir", () => {
    expect(listExecArtifacts(join(root, "nope"))).toEqual([]);
  });

  it("hash changes when a sidecar script body changes but the command string does not", () => {
    writeFile(join(root, "hooks/fmt/HOOK.md"), "---\nevent: Stop\ncommand: ./run.sh\n---\n");
    writeFile(join(root, "hooks/fmt/run.sh"), "#!/bin/sh\necho A\n");
    const before = listExecArtifacts(root).find((a) => a.ref === "hooks/fmt")!.contentHash;
    writeFileSync(join(root, "hooks/fmt/run.sh"), "#!/bin/sh\necho B\n");
    const after = listExecArtifacts(root).find((a) => a.ref === "hooks/fmt")!.contentHash;
    expect(after).not.toBe(before);
  });

  it("prefers the kind subdir over a same-named root entry", () => {
    // Both root/dup/HOOK.md and hooks/dup/HOOK.md exist; the kind subdir wins.
    writeFile(join(root, "dup/HOOK.md"), "---\nevent: Stop\ncommand: ./r.sh\n---\nROOT\n");
    writeFile(join(root, "hooks/dup/HOOK.md"), "---\nevent: Stop\ncommand: ./r.sh\n---\nKIND\n");
    const art = listExecArtifacts(root).find((a) => a.ref === "hooks/dup")!;
    expect(art.dir).toBe(join(root, "hooks", "dup"));
  });
});

describe("decideTrust", () => {
  it("flags artifacts absent from or differing from the trusted baseline", () => {
    const after = [
      { kind: "hooks" as const, leaf: "a", ref: "hooks/a", dir: "/x/a", contentHash: "aa" },
      { kind: "hooks" as const, leaf: "b", ref: "hooks/b", dir: "/x/b", contentHash: "bb" },
      { kind: "mcps" as const, leaf: "c", ref: "mcps/c", dir: "/x/c", contentHash: "cc" },
    ];
    const before = new Map([
      ["hooks/a", "aa"], // unchanged
      ["hooks/b", "OLD"], // changed
    ]);
    expect(decideTrust(before, after).map((a) => a.ref).sort()).toEqual(["hooks/b", "mcps/c"]);
  });

  it("flags nothing when every artifact matches the baseline", () => {
    const after = [
      { kind: "hooks" as const, leaf: "a", ref: "hooks/a", dir: "/x/a", contentHash: "aa" },
    ];
    expect(decideTrust(new Map([["hooks/a", "aa"]]), after)).toEqual([]);
  });
});
