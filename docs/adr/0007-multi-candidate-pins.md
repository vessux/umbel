---
status: accepted
date: 2026-06-07
---

# Multi-candidate pins: the pin is an ordered list, resolved by a scoped picker

The `.umbel-bundle` pin generalises from a single value to an **ordered list of
candidates** — one bundle name per line. A pin with one candidate resolves directly (exactly
the prior behaviour); a pin with multiple candidates opens a **scoped picker** restricted to
just those candidates. This extends the three-state pin model of
[ADR-0005](0005-per-project-routing-path-shim.md) (the PATH-shim routing itself is unchanged).

> Implementation tracked in [vessux/umbel#15](https://github.com/vessux/umbel/issues/15)
> (delivery). `accepted` here means the decision is made, not that the code ships it yet.

The file stays plain, line-based, and back-compatible: a one-line pin is byte-identical to
before. Lines are trimmed, blank lines skipped, duplicates deduped preserving first
occurrence. Full-line and inline `#` comments are supported — safe because a bundle name can
never contain `#` (`/^[a-z][a-z0-9-]{1,40}$/`, optionally `source/`-qualified). The
`__vanilla__` sentinel becomes a legal **candidate** rather than only a whole-file value, so
a pin can offer "plain claude" as an explicit choice alongside bundles.

Two semantics make order meaningful: **the first candidate is the default** — pre-selected in
the scoped picker, and resolved automatically in non-interactive shells where no human can
pick. Resolution precedence is unchanged (`arg > UMBEL_BUNDLE > pin`); arg and env still
bypass the picker and are not constrained to the candidate list.

Multi-candidate pins are **hand-authored**. `umbel apply` stays the single-candidate /
vanilla tool it already is (write + build one bundle) and gains a guard: it refuses to
overwrite an existing multi-candidate pin (exit 2, hinting `umbel unpin` first) so it cannot
silently clobber an annotated file. Candidates are **not** pre-built — each builds lazily on
first scoped-pick or non-interactive resolution, surfaced by the existing
`building bundle 'X'…` notice. The scoped picker stays **ephemeral** (ADR-0005): a selection
resolves the launch only and never rewrites the pin, so the other candidates survive.

## Considered options

- **Single-line delimited list (`discovery,delivery`)** — rejected: a per-line format is more
  diff-friendly, back-compatible with existing one-line pins, and the natural home for
  comments.
- **Implicit `(vanilla)` row in every scoped picker** — rejected: the picker should show
  *exactly* the listed candidates. Authors who want a vanilla escape hatch list `__vanilla__`
  explicitly; a focused pin shows only its bundles.
- **Non-TTY falls through to vanilla (as the no-pin case does)** — rejected: a multi-candidate
  pin is recorded intent; discarding it for vanilla is surprising. Resolving to the first
  candidate honours the pin and keeps plain `claude` working in scripts.
- **Non-TTY errors ("multiple candidates, can't pick")** — rejected: breaks non-interactive
  `claude` use (CI, `claude -p`) in any project with a multi-candidate pin.
- **`umbel apply` manages the list (multi-arg + multi-select picker)** — rejected: programmatic
  writes cannot preserve comments, and the comment requirement signals hand-authoring. Keeping
  `apply` single and dumb avoids a destructive rewrite path over an annotated file.
- **`apply --force` to overwrite a multi-candidate pin** — rejected: `umbel unpin` already
  clears the file; a new flag adds surface for no gain.
- **Pre-build all candidates on pin** — rejected: potentially slow and surprising; lazy build
  with the existing cache-miss notice keeps the first pick correct and the common path fast.

## Consequences

- Plain `claude` in a project with a multi-candidate pin now opens an (ephemeral) picker every
  launch instead of launching directly — the intended behaviour, but a visible shift from the
  single-pin "just launch" path.
- Candidate **order is semantic** (first = default), so reordering the file changes non-TTY
  resolution and the picker's initial selection.
- `umbel list` marks every candidate in the `PINNED` column, with the default distinguished
  (`yes*`); this also fixes the column never marking at all.
- A pin whose candidates are all commented out parses to zero candidates and behaves as an
  absent pin (full picker / vanilla) — never an error.
- `umbel show` / `umbel build` keep the full picker and merely pre-select the default
  candidate; they gain no "build all" mode.
