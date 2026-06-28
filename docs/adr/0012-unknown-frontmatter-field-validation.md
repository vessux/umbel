---
status: accepted
date: 2026-06-28
---

# Unknown frontmatter fields: fail-fast on typos, warn on genuine unknowns

A bundle's frontmatter validation had an asymmetry: a non-whitelisted
`settings.*` key was a hard error (`manifest.ts`), but an unknown **top-level**
field was a soft warning that let the build proceed at exit 0
(`bundles-spec.md` Validation section). The footgun: a typo'd `skils:` (for
`skills:`) is silently dropped, so the bundle "builds successfully" missing the
artifacts the author intended.

Aggravating factor (verified): on the `umbel run` path the warning is written to
stderr microseconds before the harness TUI repaints the screen
(`run.ts`: `emitWarnings` then `spawnSync(..., {stdio:"inherit"})`), so the
warning is **erased before it can be read**. The warn channel is effectively
dead on the most common path — for every warning, not just typos.

Decision — **hybrid validation, by forward-compat value**:

- An unknown field within **edit-distance ≤ 1 of a known field** is a **hard
  error** (`UsageError`, exit 2). A typo carries no forward-compatibility value,
  so failing it costs nothing and kills the footgun at build time.
- A **genuinely-unknown** field stays a **warning**. This keeps the bundle file
  format forward-compatible: an older umbel can still read a bundle authored for
  a newer umbel that added a field, rather than every new field becoming a
  breaking change.
- **Self-constraint:** umbel will not introduce a frontmatter field within
  edit-distance-1 of an existing field name, so the near-miss rule can never
  false-positive a legitimate future field (e.g. an `agent`/`agents` clash).
- **Visibility (Axis B):** the `run` path gains a TTY-only acknowledgment gate —
  if warnings exist and stdout is a TTY, print them and wait for Enter before
  exec'ing the harness; non-TTY prints to stderr as before (no TUI erases it
  there, so it stays visible in logs). With typos now failing at build, the
  surviving warnings are low-frequency, so no warning-severity model is needed
  for v1.

## Considered options

- **Pure fail-fast (hard error on any unknown field)** — rejected: with no format
  version and no migration story today, it makes *every* future field a breaking
  change for older umbels reading newer bundles. A one-way door we are not ready
  to walk through.
- **Pure warn-and-ignore (status quo)** — rejected: the typo footgun survives,
  and (until Axis B) the warning is erased by the harness TUI on `run`.
- **A full verbosity-level system** that modulates print-vs-gate (quieter output
  escalating important warnings into gates) — deferred: a genuinely good model,
  but net-new cross-cutting CLI surface (umbel has no `--quiet`/`--verbose` today)
  that deserves its own design. It would later subsume the plain gate. Tracked
  separately.

## Consequences

- New edit-distance check in `loadManifest`, plus a "did you mean '<field>'?"
  hint on the hard error.
- A small naming-discipline rule on umbel's own evolution (the self-constraint).
- A TTY acknowledgment gate added to the `run` path; the validation policy and
  the gate ship together under one change.
- The bundle format remains forward-compatible for additive fields; a future
  versioning/migration story can revisit this without being boxed in.
