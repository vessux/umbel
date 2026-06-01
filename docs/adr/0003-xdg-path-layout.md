---
status: accepted
date: 2026-05-30
---

# XDG-conformant path layout: config / cache / data split by role

umbel's on-disk state is split across three XDG roots by **semantic role**, each with an
override env var:

| Role | Default | Override | Holds |
|------|---------|----------|-------|
| Config — user-curated | `$XDG_CONFIG_HOME/umbel` (`~/.config/umbel`) | `UMBEL_ARTIFACTS_DIR` | Hand-authored bundle manifests + the skills/agents/hooks/mcps library. Dotfile-able. |
| Cache — regenerable | `$XDG_CACHE_HOME/umbel` (`~/.cache/umbel`) | `UMBEL_CACHE_DIR` | Compiled, content-addressed bundles (see [ADR-0001](0001-bundle-build-is-a-content-addressed-cache.md)). |
| Data — generated, persistent | `$XDG_DATA_HOME/umbel` (`~/.local/share/umbel`) | `UMBEL_DATA_DIR` | The generated PATH shim (`bin/claude`, see [ADR-0005](0005-per-project-routing-path-shim.md)). |

The guiding distinction: **config is hand-authored and version-controlled, cache is
disposable, data is generated but must persist.** The artifact library started under a
generic `~/.agents/`; the public release moved it to a tool-branded XDG layout, and the
shim later moved from config to data once it was clear a generated file doesn't belong in a
tree users keep as dotfiles.

## Considered options

- **Keep a shared, generic artifact root (`~/.agents/`)** — rejected for a tool-branded
  `$XDG_CONFIG_HOME/umbel`: collision safety and discoverability, since no other tool shares
  that layout.
- **Partial XDG (a visible `~/.umbel/` for artifacts)** — rejected for full XDG conformance
  and consistency.
- **Shim under `$XDG_CACHE_HOME/umbel/bin`** — rejected: the cache can be wiped at any time
  while the shell-rc PATH line still points at it, which would break plain `claude`. A
  persistent launcher is *data*, not *cache*.
- **Shim in the shared `~/.local/bin`** — rejected: the shim strips its own directory from
  PATH to re-exec the real `claude`, so its directory must contain only the shim; a shared
  bin dir would hide every other tool there from `claude`.
- **Keep the shim under config for single-root discoverability** — rejected: loses the
  config-vs-generated split and forces a `.gitignore` entry into version-controlled
  dotfiles.

## Consequences

- A user can version-control `$XDG_CONFIG_HOME/umbel` as dotfiles without sweeping in
  generated or disposable files.
- Moving the shim out of config was **breaking** for existing installs (a stale shim plus
  the rc PATH line need a manual update; no migration was shipped) — accepted pre-1.0 with a
  near-zero install base.
