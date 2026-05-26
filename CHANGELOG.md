# Changelog

All notable changes to this project will be documented here. Format roughly
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning
follows [SemVer](https://semver.org/spec/v2.0.0.html).

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
