# Changelog

All notable changes to this project will be documented here. Format roughly
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning
follows [SemVer](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Fixed

- `compile` now wraps frontmatter parse errors as `UsageError` with the
  artifact ref and a `description: >-` hint, instead of leaking raw
  `YAMLException` from gray-matter when a SKILL/AGENT/HOOK/MCP description
  contains unquoted YAML flow syntax (`{...}`, `[...]`, unquoted colons).

### Docs

- README: added "Installing artifacts" section explaining the
  `<source>/<leaf>` artifact layout and a general recipe for importing
  Claude Code plugin repos (with `obra/superpowers` as a concrete example).
- README: added "What's isolated, what leaks" section enumerating which
  surfaces a bundle session sees versus hides.
- README: added "Troubleshooting" entries for the three most common bundle
  resolve errors (`missing source qualifier`, `source not found`,
  `bundle not found`), including a migration snippet for legacy flat
  `~/.config/umbel/skills/<leaf>/` layouts.
- README Quickstart: replaced bare refs (`pandas-cheatsheet`, `plotnine`,
  `data-scientist`, `duckdb`) with `local/`-qualified equivalents so the
  example matches the resolver's `<source>/<leaf>` requirement, and added
  a pointer to `docs/bundles-spec.md` for the full schema (hooks,
  mergeMcp, …).

## [0.1.0] — 2026-05-26

Initial public release.

### Bundles

- `umbel list` / `show` / `build` / `apply` / `unpin` / `run` / `init` / `gc`.
- Bundle manifests at `~/.config/umbel/bundles/<name>.md` (user) or
  `<project>/.claude/bundles/<name>.md` (project, shadows user).
- `extends:` composition with override-by-name semantics.
- Named artifact kinds: `skills`, `agents`, `hooks`, `mcps` — resolved via
  `<source>/<leaf>` qualified refs against `$UMBEL_ARTIFACTS_DIR/{skills,agents,hooks,mcps}/`.
- Compiles to a Claude Code plugin layout cached under
  `$XDG_CACHE_HOME/umbel/bundles/<name>-<hash>/`; launch via `claude
  --plugin-dir / --settings / --mcp-config / --strict-mcp-config`.
- `.umbel-bundle` pin file in project root for per-project default selection.
- `UMBEL_BUNDLE` env var for one-shot override of the pin.
- Whitelisted settings carried through to the compiled `settings.json`.
- `mergeMcp: true` opt-in for additive `.mcp.json` (default is strict mode).
- Self-describing `bundle.md` written to the cache root with the resolved
  manifest + canonical Claude invocation block.

### Skills picker (v0, low-level)

- `umbel skills` symlinks handpicked skills from `$UMBEL_ARTIFACTS_DIR/skills/`
  into a project's `.claude/skills/`.
- Interactive multi-select picker on a TTY; deterministic
  `--target` + `--skills` for sandbox/CI use.
- `--force` to back up + replace conflicting real dirs.
- `--dry-run` for idempotency checks.

[0.1.0]: https://github.com/vessux/umbel/releases/tag/v0.1.0
