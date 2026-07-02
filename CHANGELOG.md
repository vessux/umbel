# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
While pre-1.0, minor versions may carry breaking changes.

## [Unreleased]

## [0.2.0] - 2026-07-01

### Added

- Per-project bundle routing: a PATH shim plus a vanilla pin route each project
  to its bundle with zero glue.
- Multi-candidate pins — an ordered candidate list resolved by a scoped picker (#16).
- `UMBEL_RESOLVED_DIR` and `UMBEL_BUNDLE_VERSION` are exported on the bundle run
  path so the running session can locate and identify its resolved bundle (#23).
- Hybrid frontmatter validation with a TTY warning gate on `run` (#34).
- `run` prints a "building bundle" notice on a cache-miss build.

### Changed

- The PATH shim installs under `$XDG_DATA_HOME` instead of the config root.
- Not-found errors are unified to exit code 3 (`NotFoundError`) (#21).

### Fixed

- Resolve `${CLAUDE_PLUGIN_ROOT}` for bundle hooks and MCP server commands.
- `apply` no longer lets a pin escape to `$HOME` via the global `~/.claude` (#19).
- Validate that `skills`, `agents`, and `extends` are lists (#20).
- Surface malformed-bundle errors and unknown-field warnings in the discovery
  loader output (#25).
- A malformed parent in an `extends` chain now exits 2, not 3 (#35).

## [0.1.3] - 2026-05-26

### Fixed

- Auto-retry `npm publish` on a Sigstore transparency-log 409
  (`TLOG_CREATE_ENTRY_ERROR`), which the CLI otherwise surfaced as a hard failure.

## [0.1.2] - 2026-05-26

- Release-tooling maintenance only; no user-facing changes.

## [0.1.1] - 2026-05-26

### Changed

- Publish to npm on GitHub release via a trusted publisher (OIDC) (#4).
- Build before running tests in CI (#3); fix `prepublishOnly` script order.

### Fixed

- Surface frontmatter parse errors as an actionable `UsageError` (#1).

## [0.1.0] - 2026-05-26

- Initial public release.

[Unreleased]: https://github.com/vessux/umbel/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/vessux/umbel/compare/v0.1.3...v0.2.0
[0.1.3]: https://github.com/vessux/umbel/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/vessux/umbel/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/vessux/umbel/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/vessux/umbel/releases/tag/v0.1.0
