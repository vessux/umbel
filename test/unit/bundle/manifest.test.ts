import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadManifest } from "../../../src/bundle/manifest.ts";
import { UsageError } from "../../../src/errors.ts";
import { cleanup, makeTmpDir } from "../../helpers/tmp.ts";

describe("loadManifest", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir();
  });
  afterEach(() => {
    cleanup(dir);
  });

  function writeBundle(name: string, body: string): string {
    const path = join(dir, `${name}.md`);
    writeFileSync(path, body);
    return path;
  }

  it("parses a minimal valid manifest with just a name", () => {
    const path = writeBundle(
      "minimal",
      `---
name: minimal
---

body text
`,
    );
    const result = loadManifest(path);
    expect(result.manifest.name).toBe("minimal");
    expect(result.warnings).toEqual([]);
  });

  it("rejects manifest with no name field", () => {
    const path = writeBundle("nameless", "---\ndescription: x\n---\n");
    expect(() => loadManifest(path)).toThrow(/name/i);
  });

  it.each([
    ["UPPER", "uppercase"],
    ["1leading-digit", "leading digit"],
    ["-leading-hyphen", "leading hyphen"],
    ["has space", "space"],
    ["a", "too short (min 2 chars)"],
    ["a".repeat(42), "too long (max 41 chars)"],
    ["bad_underscore", "underscore"],
    ["dot.invalid", "dot"],
  ])("rejects malformed name '%s' (%s)", (name) => {
    const path = writeBundle("malformed", `---\nname: ${name}\n---\n`);
    expect(() => loadManifest(path)).toThrow(/name/i);
  });

  it.each(["ab", "data-science", "lang-py", "a-b-c-d", "x123"])(
    "accepts valid name '%s'",
    (name) => {
      const path = writeBundle("valid", `---\nname: ${name}\n---\n`);
      expect(loadManifest(path).manifest.name).toBe(name);
    },
  );

  it("parses all spec fields into a typed manifest", () => {
    const path = writeBundle(
      "full",
      `---
name: data-science
description: Tools for data science work
extends: [base, lang-py]
skills: [pandas-cheatsheet, plotnine]
agents: [data-scientist]
hooks: [base/log-bash]
mcps: [local/duckdb]
mergeMcp: false
settings:
  model: claude-opus-4-7
  env:
    DUCKDB_PATH: /var/data/db.duckdb
  outputStyle: concise
---

Bundle for ad-hoc analysis.
`,
    );
    const { manifest, warnings } = loadManifest(path);
    expect(manifest.name).toBe("data-science");
    expect(manifest.description).toBe("Tools for data science work");
    expect(manifest.extends).toEqual(["base", "lang-py"]);
    expect(manifest.skills).toEqual(["pandas-cheatsheet", "plotnine"]);
    expect(manifest.agents).toEqual(["data-scientist"]);
    expect(manifest.hooks).toEqual(["base/log-bash"]);
    expect(manifest.mcps).toEqual(["local/duckdb"]);
    expect(manifest.mergeMcp).toBe(false);
    expect(manifest.settings).toEqual({
      model: "claude-opus-4-7",
      env: { DUCKDB_PATH: "/var/data/db.duckdb" },
      outputStyle: "concise",
    });
    expect(manifest.body).toContain("Bundle for ad-hoc analysis.");
    expect(warnings).toEqual([]);
  });

  it("rejects settings keys outside the whitelist", () => {
    const path = writeBundle(
      "bad-settings",
      `---
name: bad-settings
settings:
  model: claude-opus-4-7
  enabledPlugins: { foo: true }
---
`,
    );
    expect(() => loadManifest(path)).toThrow(/settings.*enabledPlugins/i);
  });

  it("accepts every whitelisted settings key", () => {
    const path = writeBundle(
      "all-settings",
      `---
name: all-settings
settings:
  model: claude-opus-4-7
  env:
    FOO: bar
  statusLine:
    command: ./status.sh
  permissions:
    allow: [Bash]
  outputStyle: concise
---
`,
    );
    const { manifest } = loadManifest(path);
    expect(manifest.settings?.model).toBe("claude-opus-4-7");
    expect(manifest.settings?.env).toEqual({ FOO: "bar" });
    expect(manifest.settings?.statusLine).toEqual({ command: "./status.sh" });
    expect(manifest.settings?.permissions).toEqual({ allow: ["Bash"] });
    expect(manifest.settings?.outputStyle).toBe("concise");
  });

  it("rejects hooks shape that is not a list of qualified ref strings", () => {
    const path = writeBundle(
      "bad-hooks-shape",
      `---
name: bad-hooks-shape
hooks:
  PreToolUse:
    - matcher: Bash
---
`,
    );
    // Inline object shape no longer accepted — must be list of <source>/<name> strings.
    expect(() => loadManifest(path)).toThrow(/hooks.*list.*qualified/i);
  });

  it("rejects mcps shape that is not a list of qualified ref strings", () => {
    const path = writeBundle(
      "bad-mcps-shape",
      `---
name: bad-mcps-shape
mcps:
  duckdb:
    command: duckdb-mcp
---
`,
    );
    // Inline map shape no longer accepted — must be list of <source>/<name> strings.
    expect(() => loadManifest(path)).toThrow(/mcps.*list.*qualified/i);
  });

  it.each([
    ["extends", "good"],
    ["skills", "local/demo"],
    ["agents", "data-scientist"],
  ])("rejects scalar %s where a list is required", (field, value) => {
    const path = writeBundle(
      `scalar-${field}`,
      `---\nname: scalar-${field}\n${field}: ${value}\n---\n`,
    );
    expect(() => loadManifest(path)).toThrow(new RegExp(`${field}.*list`, "i"));
  });

  it.each(["extends", "skills", "agents"])(
    "rejects %s list containing a non-string element",
    (field) => {
      const path = writeBundle(
        `nonstring-${field}`,
        `---\nname: nonstring-${field}\n${field}: [123]\n---\n`,
      );
      expect(() => loadManifest(path)).toThrow(new RegExp(`${field}.*list`, "i"));
    },
  );

  it("warns on unknown frontmatter field but does not error", () => {
    const path = writeBundle(
      "with-unknown",
      `---
name: with-unknown
totallyMadeUp: true
plugins: [foo]
---
`,
    );
    const { manifest, warnings } = loadManifest(path);
    expect(manifest.name).toBe("with-unknown");
    expect(warnings).toHaveLength(2);
    expect(warnings.join("\n")).toMatch(/totallyMadeUp/);
    expect(warnings.join("\n")).toMatch(/plugins/);
  });

  it("wraps a frontmatter parse error as an actionable UsageError, not a raw YAMLException", () => {
    const path = writeBundle("broken", "---\nname: ok\ndescription: this: breaks\n---\nbody\n");
    let caught: unknown;
    try {
      loadManifest(path);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(UsageError);
    expect((caught as Error).message).toMatch(/description: >-|block scalar/);
  });
});
