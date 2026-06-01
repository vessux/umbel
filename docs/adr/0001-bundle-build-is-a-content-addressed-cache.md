---
status: accepted
date: 2026-05-14
---

# Bundle build output is a content-addressed cache, never the user's `~/.claude/`

Building a bundle produces a **content-addressed cache directory** (hashed over the
resolved manifest plus the source bytes). `umbel run` then launches `claude` against
that cache via CLI flags — `--plugin-dir`, and, when the bundle declares them,
`--settings`, `--mcp-config`, `--strict-mcp-config`. umbel never writes into the user's
`~/.claude/` or the project's `.claude/`. The cache is self-describing: it carries a
resolved `bundle.md` recording the manifest and the recommended invocation, so the cache
— not the umbel binary — is the contract a consumer reads.

This generalised an earlier design that emitted configuration for one specific external
sandbox launcher. Owning a single consumer's config surface would have coupled the two
projects and pushed umbel toward being a plugin-authoring tool for that one sandbox.
A content-addressed cache plus a self-describing `bundle.md` is sandbox-agnostic: the
feature→flag mapping lives in one place, regenerated at build time, so no consumer has to
reimplement it.

## Considered options

- **Compile directly into `<project>/.claude/`** — rejected: loses the content-addressed
  cache, doubles disk, and collides with hand-authored project skills. It also breaks the
  isolation invariant below.
- **Own a launcher's config surface (e.g. a `bundle <launcher>` subcommand emitting its
  YAML)** — rejected: couples umbel to that consumer. The cache + `bundle.md` is a contract
  any consumer can read without umbel present.
- **A CLI "what argv would you use" inspector subcommand** — rejected: a build artifact
  (the self-describing `bundle.md`) is better — self-documenting and it survives without
  the umbel binary.

## Consequences

- **Isolation guarantee.** A bundle session never mutates `~/.claude/`, so concurrent
  `claude` sessions under different bundles in the same project don't interfere — the goal
  the whole tool exists to serve.
- The cache is regenerable; stale entries are pruned by `umbel gc` (newest few kept per
  name).
- Because the contract is the cache and not the binary, other consumers (devcontainers,
  shell wrappers) could read it. umbel's own `run` is the only consumer today — see
  [ADR-0005](0005-per-project-routing-path-shim.md) for how plain `claude` reaches it.
- How artifact paths inside the cache resolve under Claude Code's plugin model is its own
  decision — see [ADR-0004](0004-claude-code-plugin-path-resolution.md).
