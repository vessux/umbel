---
status: accepted
date: 2026-06-10
---

# The harness is selected by the invoked binary, not declared by the bundle

Multi-harness support needs a way to choose which harness a bundle runs under. An early
proposal (bead ji2) put a `harness:` field in bundle frontmatter — making a bundle authored
*for* a harness — plus a `--harness` flag and CWD auto-detection.

That fights two decisions already made: a bundle is a harness-agnostic set of capabilities
([ADR-0009](0009-capability-axes-are-the-artifact-kinds.md)), and its cache is produced
**per harness** ([ADR-0008](0008-graded-harness-isolation.md)). If the contents are agnostic
and the cache is per-harness, then "which harness" is naturally an **invocation-time**
choice, not a property baked into the artifact.

The PATH shim ([ADR-0005](0005-per-project-routing-path-shim.md)) already carries that choice
for free: the user runs `claude`, or `opencode`, or `copilot`, and the intercepting shim
*knows which binary was invoked*. **The invoked binary is the harness signal.** The
`.umbel-bundle` pin names the *bundle*; the binary names the *harness*; the two are
orthogonal, so the pin format ([ADR-0007](0007-multi-candidate-pins.md)) is unchanged — the
same pin resolves under any shimmed binary.

Decision: **harness is an invocation property keyed off the invoked binary.** Bundles stay
harness-agnostic. Resolution precedence: `--harness` flag → invoked-binary identity →
`UMBEL_HARNESS` env → default `claude-code` (back-compat).

## Considered options

- **Frontmatter `harness:` (bundle is harness-specific)** — rejected: contradicts
  capabilities-are-agnostic (ADR-0009) and per-harness compile (ADR-0008); forces a duplicate
  bundle to target a second harness; bakes the harness into the artifact. At most a future
  *optional* "intended/minimum harness" hint for validation — not identity.
- **A `--harness` flag (or `UMBEL_HARNESS`) as the primary selector** — rejected as primary:
  the shim already knows the binary, so a flag would usually just restate it. Kept as the
  top-precedence *override* for direct `umbel run` invocations that don't come through a shim.
- **CWD auto-detection (`.claude/`/`.opencode/`/`.pi/`) as the router** — rejected: ambiguous
  when several harness dirs coexist, and redundant when the invoked binary already names the
  harness. Demoted to a *suggestion* surfaced by `umbel apply` / the init wizard, never a
  routing decision.

## Consequences

- `umbel shim install` grows from a single `bin/claude` to one shim per supported harness
  (`bin/opencode`, `bin/pi`, `bin/copilot`, …), each re-exec'ing its real binary under the
  existing `UMBEL_RESOLVED` recursion guard. This is the bulk of the selection work.
- The pin (`.umbel-bundle`) and its candidate model are untouched; harness is orthogonal to
  the bundle a pin names.
- One bundle is usable across harnesses. At compile, the chosen harness's adapter validates
  the bundle's used kinds against its support levels (ADR-0009): warn on `best-effort`/
  `no-op`, and error when *every* kind a bundle uses is unsupported on that harness (e.g. an
  mcp-only bundle on Pi).
- Builds on the shim of ADR-0005; the recursion guard generalises unchanged (any shimmed
  binary strips the shim dir and re-execs its real target once `UMBEL_RESOLVED` is set).
