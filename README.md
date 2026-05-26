# umbel

Compose Claude Code sessions from named bundles of skills, subagents, hooks,
MCP servers, and settings. Switch bundles per `claude` process; your real
`~/.claude/` is never touched.

[![ci](https://github.com/vessux/umbel/actions/workflows/ci.yml/badge.svg)](https://github.com/vessux/umbel/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@vessux/umbel.svg)](https://www.npmjs.com/package/@vessux/umbel)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> **Status:** v0.1.0, beta. Solo-maintained, best-effort. Breaking changes
> possible while pre-1.0. Issues welcome.

## Install

```bash
npm i -g @vessux/umbel        # global install — gives you the `umbel` binary
# or
npx -y @vessux/umbel --help   # one-shot via npx
```

Requires Node ≥ 18.17. Unix only (symlinks).

> Note: the npm package is scoped (`@vessux/umbel`) due to npm's
> name-similarity filter. The CLI binary is plain `umbel`, so the rest of
> these docs use that.

## Quickstart

Author a bundle at `~/.config/umbel/bundles/data-science.md`:

```yaml
---
name: data-science
description: Tools for data science work
skills: [pandas-cheatsheet, plotnine]
agents: [data-scientist]
mcps: [local/duckdb]
settings:
  model: claude-opus-4-7
---
```

Launch Claude Code with that bundle:

```bash
umbel run data-science -- claude
```

Pin a bundle to a project so plain `umbel run` uses it:

```bash
umbel apply data-science
```

## Why

Claude Code reads from one `~/.claude/` per user. Editing it to swap skill /
subagent / MCP setups between projects is friction. umbel lets you keep many
named bundles and pick one per `claude` process via `--plugin-dir`,
`--settings`, and `--mcp-config`. The bundle is compiled to a Claude Code
plugin layout in a cache dir on demand; your real `~/.claude/` stays untouched.

See [`docs/bundles-spec.md`](docs/bundles-spec.md) for the full design.

## Verbs

```bash
umbel list                              # scope-grouped bundle table
umbel show [name]                       # resolved manifest + sources + MCP diff
umbel build [name] [--no-cache]         # warm cache, print path
umbel apply [name]                      # pin <project>/.umbel-bundle
umbel unpin                             # remove the pin
umbel run [name] [-- ...claude args]    # launch claude with bundle flags
umbel init                              # multi-step authoring wizard
umbel gc                                # prune cache (keep newest 3 per name)
umbel skills [options]                  # low-level skill installer (v0 picker)
```

When invoked without `[name]` on a TTY, `run` / `apply` / `show` / `build`
open a single-select picker. Pinned bundle is pre-selected.

## Pin file

`<project>/.umbel-bundle` is plain text, one line, the bundle name.
`umbel apply` writes it; `umbel unpin` removes it. Commit it to share a
default with your team, or `.gitignore` it for per-developer setup.

## Bundle resolution order for `run`

1. Explicit `<name>` arg
2. `UMBEL_BUNDLE` env var
3. `<project>/.umbel-bundle` pin file
4. Picker on TTY, otherwise error.

## Skills picker (low-level, v0)

The original v0 entry point. Symlinks handpicked skills from
`$UMBEL_ARTIFACTS_DIR/skills/` into a project's `.claude/skills/`. Useful for
sandbox image builds and CI idempotency checks. Mostly subsumed by bundles —
keep using it if it fits your workflow.

```bash
# Interactive, from a Claude Code project root
umbel skills

# Deterministic install for a sandbox image build
umbel skills --target ./skills --skills tdd,grill-me,review

# CI-safe idempotency check
umbel skills --target .claude/skills --skills tdd,review --dry-run

# Replace a stray real dir left over from a manual copy
umbel skills --target .claude/skills --skills tdd --force
```

### Picker flags

| Flag                | Meaning                                                |
|---------------------|--------------------------------------------------------|
| `--target <path>`   | Exact parent dir for skill symlinks                    |
| `--source <path>`   | Override source root (default `$UMBEL_ARTIFACTS_DIR/skills`) |
| `--skills <csv>`    | Non-interactive selection; implies no prompts          |
| `--force`           | Back up conflicting real dirs/files and replace        |
| `--dry-run`         | Print plan, exit 0, no writes                          |
| `-h`, `--help`      | Usage                                                  |
| `-v`, `--version`   | Version                                                |

### Picker row states

Rows start checked iff currently installed correctly.

| Icon | Meaning                            | Default-checked | Toggleable              |
|------|------------------------------------|-----------------|-------------------------|
| (none) | Not installed                    | no              | yes                     |
| (none) | Installed (correct symlink)      | yes             | yes (uncheck = remove)  |
| `⚠`  | Symlink → different source         | yes             | yes (leave = relink)    |
| `✖`  | Real dir/file, not a symlink       | no              | no (need `--force`)     |
| `?`  | Malformed SKILL.md                 | no              | yes                     |

## Env vars

| Var                   | Effect                                                                  |
|-----------------------|-------------------------------------------------------------------------|
| `UMBEL_ARTIFACTS_DIR` | Override artifact root (default: `$XDG_CONFIG_HOME/umbel`).             |
| `UMBEL_CACHE_DIR`     | Override compiled-bundle cache root (default: `$XDG_CACHE_HOME/umbel`). |
| `UMBEL_BUNDLE`        | Used by `run` resolution (arg > env > pin).                             |
| `NO_COLOR`            | Disable ANSI color (icons retained).                                    |

## Exit codes

| Code | Meaning                                                         |
|------|-----------------------------------------------------------------|
| 0    | Success (or dry-run completed)                                  |
| 1    | Apply / runtime failure                                         |
| 2    | Usage error (bad flag, validation error, picker on non-TTY)     |
| 3    | Source / bundle / parent not found                              |
| 4    | Conflict without `--force` (skills picker)                      |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Solo passive maintenance — PRs and
issues welcome, response is best-effort.

## License

MIT — see [LICENSE](LICENSE).
