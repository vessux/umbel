---
status: accepted
date: 2026-05-29
---

# Hook and MCP path resolution under Claude Code's plugin model

A compiled bundle reaches `claude` as a plugin directory (`--plugin-dir <cache>`) plus,
when declared, `--settings`, `--mcp-config`, `--strict-mcp-config`. Claude Code substitutes
`${CLAUDE_PLUGIN_ROOT}` **only** in configs it treats as plugin-associated — specifically a
plugin's `hooks/hooks.json`, auto-loaded from `--plugin-dir`. It does **not** substitute the
variable in a `--settings` file or a `--mcp-config` file. That asymmetry forces two
different path strategies:

- **Hooks** are emitted to `<cache>/hooks/hooks.json` (the Claude Code plugin-hooks schema,
  under a top-level `hooks` key), *not* folded into `settings.json`. A hook command with a
  relative `./script` keeps `${CLAUDE_PLUGIN_ROOT}/hooks/<name>/…`, which resolves because
  the hook loads from the plugin's `hooks.json`. `settings.json` is emitted only when the
  bundle declares a `settings:` field.
- **MCP** server commands cannot use `${CLAUDE_PLUGIN_ROOT}` — the bundle's `.mcp.json` is
  consumed via `--mcp-config`, where the variable is never substituted. A relative
  `./command` is rewritten to the **absolute** post-rename cache path
  `<finalDir>/mcps/<canonical>/…`.

MCP uses an absolute path rather than plugin-native auto-load because relying on
`--plugin-dir` to auto-load plugin MCP servers is unsafe for umbel's isolation: (1) the docs
don't state whether `--strict-mcp-config` suppresses plugin-provided servers, and (2)
plugin-provided MCP servers sit *below* project/user `.mcp.json` in precedence, so a
same-named project server would shadow the bundle's — defeating the isolation
`--strict-mcp-config` exists to guarantee.

## Considered options

- **Keep hooks in `settings.json` and rely on `--plugin-dir` to associate them** — rejected:
  settings-file hooks are never plugin-associated regardless of `--plugin-dir`, so
  `${CLAUDE_PLUGIN_ROOT}` stays unresolved.
- **Rewrite relative hook commands to an absolute cache path and keep them in
  `settings.json`** — rejected: works without the variable but bakes the hash directory into
  `settings.json` and diverges from Claude Code's plugin-native hook loading.
- **Plugin-native MCP auto-load (drop `--mcp-config`)** — rejected: undocumented strict-vs-
  plugin interaction, and lower precedence than project `.mcp.json` means isolation isn't
  guaranteed.
- **Fork a vendored session-start hook to compute its own root via `$SCRIPT_DIR/../..`** —
  rejected: fragile against upstream changes; `${CLAUDE_PLUGIN_ROOT}` is what Claude Code
  documents for hooks.

## Consequences

- A single `rewriteRelativeCommand(command, base)` handles both kinds: hooks pass
  `${CLAUDE_PLUGIN_ROOT}/hooks/<name>` (resolves), mcps pass the absolute base. Both anchor
  on the post-atomic-rename `finalDir`, never the staging directory.
- This resolution depends on Claude Code's substitution behaviour; a change there is the
  trigger to revisit.
