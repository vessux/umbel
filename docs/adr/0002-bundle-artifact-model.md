---
status: accepted
date: 2026-05-20
---

# Bundle artifact model: four named roots, qualified references, one shape per kind

A bundle composes four kinds of artifact — **skills, agents, hooks, mcps**. Each is a
named artifact stored at `$XDG_CONFIG_HOME/umbel/<kind>/<source>/<leaf>/` with a manifest
(`SKILL.md` / `HOOK.md` / `MCP.md`) plus sidecar files. Bundles reference artifacts by
**qualified `<source>/<leaf>` slash refs** (e.g. `skills: [superpowers/tdd]`); bare names
are rejected. There is exactly **one on-disk shape per kind** — no parallel inline form.
Cross-source name collisions are disambiguated **at scan time** to `<source>-<leaf>`, so an
install name is unique before the planner or compiler ever sees it.

Two kinds were deliberately removed and are *not* artifact roots:

- **`commands`** — express a user-invokable command as a skill with
  `disable-model-invocation: true`. Dropping it avoids a root that duplicates a skill mode.
- **`output-styles`** — on the upstream deprecation path. (`settings.outputStyle` still
  references Claude Code's built-in styles; that's orthogonal.)

Inline `hooks:` and `mcpServers:` blocks were likewise removed: hooks and mcps are
**named-only**, the same shape as skills and agents. A bundle still carrying a legacy key
trips the existing "unknown field" warning, which is the migration cue.

## Considered options

- **Keep `commands` as a root for slash-menu discoverability** — rejected for parity with
  user-invokable skills, accepting the discoverability loss.
- **Per-source artifact roots (`skills-superpowers/`, …)** — rejected: multiplies roots.
- **Resolver bare-name fallback (a bare name resolves to a single subfolder match)** —
  rejected: invites drift; qualified-only is explicit.
- **Keep inline `hooks:` / `mcpServers:` alongside named refs** — rejected: a dual shape is
  a standing drift surface. The same "one shape per kind" reasoning settled the
  commands-flat-vs-dir and the named-only cuts.
- **Colon-style refs (`superpowers:tdd`)** — rejected: overloads Claude Code's
  `plugin:command` namespace convention; slash refs sidestep it.
- **Disambiguate collisions in the planner, or re-probe rewritten paths** — rejected: breaks
  planner purity (it does no filesystem I/O) and broke idempotency on re-apply. Scan-time
  disambiguation fixes it in one pass with no extra I/O — install names are a unique
  invariant by the time anything downstream runs.
- **Multi-server-per-MCP-artifact (an `mcpServers:` map inside `MCP.md`)** — rejected: saves
  a few directories but loses the 1:1 collision rule and parity with the other kinds.

## Consequences

- **State-coupled tools aren't bundleable.** Tools that scaffold per-project state their
  skill bodies reference via relative paths (e.g. spec-kit, OpenSpec) can't be toggled per
  session: Claude Code always loads project-local `.claude/skills/` alongside the bundle, so
  the per-session swap that justifies a bundle can't be served. This is the criterion for
  what earns a bundle slot — a user-scope skill set that is swappable per session for the
  same repo.
- Adding a kind, or a new reference syntax, is a deliberate change to this model, not a
  local tweak — weigh it against the drift surface a second shape creates.
