---
status: accepted
date: 2026-05-29
---

# Per-project bundle routing via a PATH shim, not project-local glue

A global PATH shim (`umbel shim install` → `$XDG_DATA_HOME/umbel/bin/claude`) routes plain
`claude` invocations through `umbel run`, so a project carrying a `.umbel-bundle` pin
auto-applies its bundle with **zero project-local glue**. The pin file has three states:

- a **bundle name** → run under that bundle;
- the **`__vanilla__` sentinel** → run plain `claude`, no picker;
- **absent** → interactive picker, or (non-TTY) silently fall through to vanilla.

> The pin model is extended by [ADR-0007](0007-multi-candidate-pins.md): the pin is now an
> ordered list of candidates, and a "bundle name" is the one-candidate case. The shim routing
> described here is unchanged.
>
> Generalised by [ADR-0010](0010-harness-selected-by-invoked-binary.md) for multi-harness:
> the shim grows to one binary per harness (`bin/opencode`, `bin/pi`, …), and **the invoked
> binary selects the harness**. The pin still names only the bundle.

A recursion guard, `UMBEL_RESOLVED=1` (exported when umbel exec's `claude`), makes the shim
strip its own directory from PATH and exec the real binary — so in-session shellouts to
`claude` don't re-enter the picker. The picker is **ephemeral**: only `umbel apply` writes a
pin; selecting from `umbel run` never persists one.

## Considered options

- **direnv activation (per-project `.envrc` → `PATH_add`)** — rejected: still needs a
  project-local glue file, contradicting the zero-project-files goal.
- **`CLAUDE_CONFIG_DIR` redirection** — rejected: isolates oauth/history/plugins per bundle,
  breaking the "never mutate `~/.claude/`" goal
  ([ADR-0001](0001-bundle-build-is-a-content-addressed-cache.md)).
- **Empty pin file = vanilla** — rejected: too easy to create by accident, and an empty file
  was already the "no pin" state. The `__vanilla__` sentinel is explicit and survives
  whitespace.
- **Reserve the literal bundle name `vanilla`** — rejected: would block a future bundle
  actually named `vanilla` for no benefit.
- **Prompt "save as pin? [y/N]" after every picker selection** — rejected: doubles the
  keypress cost on every fresh project visit.
- **Per-project shim binary in `.direnv/bin/claude`** — rejected: moves glue from `.envrc`
  to a binary file — no improvement.

## Consequences

- The only project-local file is the existing `.umbel-bundle` pin; routing logic is global
  and lives in one shim.
- Non-TTY `umbel run` with no resolved name silently runs vanilla; `apply`/`show`/`build`
  keep their non-TTY error because they have no sensible silent default.
- This repo's own pin is intentionally git-ignored — the bundle a maintainer routes through
  is a personal choice, not a contributor-facing artifact.
