---
status: accepted
date: 2026-06-10
---

# Harness isolation is graded; config injection is a per-harness launch spec

[ADR-0001](0001-bundle-build-is-a-content-addressed-cache.md) promised that umbel injects a
bundle purely through `claude`'s CLI flags (`--plugin-dir`, `--settings`, `--mcp-config`,
`--strict-mcp-config`) and never writes into the project or the user's global config. A
grounding spike across **OpenCode, Pi, and GitHub Copilot CLI** showed that the pure-flag,
fully-strict shape is **specific to Claude Code** — it is the outlier, not the template. The
other harnesses inject by **relocating a config directory via an environment variable**
(`OPENCODE_CONFIG_DIR`, `PI_CODING_AGENT_DIR`, `COPILOT_HOME`), with by-path flags layered
on, and most offer no "ignore everything else" switch.

Two properties that ADR-0001 conflated must be separated:

- **Non-mutation** — umbel never writes into the repo or the real global config. This
  survives on **every** surveyed harness: CC via flags; OpenCode and Pi via an external
  config dir set through an env var plus by-path flags; Copilot via `COPILOT_HOME`. It stays
  an absolute promise.
- **Suppression** (strictness) — ambient project/global config is *ignored* so that only the
  bundle is active. This is **graded**, because not every harness can suppress its own
  discovery:
  - **strict** — Claude Code (`--strict-mcp-config` + the plugin model fully shadow ambient config).
  - **scoped** — Copilot CLI (composable to strict: relocated `COPILOT_HOME` + `--disable-builtin-mcps` + `--additional-mcp-config`).
  - **best-effort** — OpenCode (injected config *merges* over a project's own `.opencode/` and even `~/.claude/CLAUDE.md`; no strict mode) and Pi (global layer relocatable, but the project `.pi/settings.json` is pinned to the launch cwd and cannot be overridden).

Each adapter therefore **declares its suppression grade**, and umbel surfaces it honestly in
the support matrix (see the harness-support doc) rather than implying uniform isolation.

The launch contract generalises with it. ADR-0001's "feature → flag" mapping
(`computeClaudeArgs() → string[]`) becomes a per-harness **launch spec — `{ binary, args, env }`**.
Because each harness wants a different on-disk layout, the **compiled cache becomes
per-harness** and the cache hash keys on the harness id: one bundle compiles to one cache
per harness it targets.

## Considered options

- **Keep isolation a hard requirement; support only strict-isolable harnesses** — rejected:
  that is Claude-Code-only forever, and would exclude OpenCode, the harness that actually
  motivated the work.
- **Claim uniform isolation and silently degrade** — rejected: dishonest. A user under
  OpenCode would assume their project's `.opencode/` is suppressed when it is merged in;
  session-bleed would be invisible. Graded-and-surfaced is the price of honesty.
- **Keep the launch contract a flag list (`string[]`)** — rejected: three of four surveyed
  harnesses inject via environment variables, not flags. `{ binary, args, env }` is the
  smallest contract that covers all of them.
- **One shared cache layout for every harness** — rejected: the layouts are genuinely
  different (CC `.claude-plugin/` + `skills/`/`agents/`/`hooks.json`/`.mcp.json`; OpenCode
  `agents/`/`commands/`/`skills/`; Copilot `settings.json`/`mcp-config.json`/`instructions/`).
  A per-harness layout keyed into the hash is simpler than a lowest-common-denominator format.

## Consequences

- The Harness interface's launch method returns `{ binary, args, env }`; today's
  `computeClaudeArgs` becomes the Claude Code adapter's implementation of it.
- The cache hash includes the harness id; the same bundle can hold N caches, one per target.
- ADR-0001's **non-mutation** guarantee is unchanged and now stated as the absolute promise
  it always was; what is *new* is that **suppression is graded**, and `best-effort` harnesses
  (OpenCode, Pi) cannot guarantee a project's own config is ignored.
- The public support matrix gains a **suppression-grade column** alongside the
  capability rows.
- This amends — does not supersede — [ADR-0001](0001-bundle-build-is-a-content-addressed-cache.md);
  the content-addressed self-describing cache is retained, now produced per harness.
