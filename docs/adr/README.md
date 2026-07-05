# Architecture Decision Records

Lightweight ADRs for umbel — one file per architecturally significant decision, recording
the choice, the alternatives that were weighed, and the consequences. They exist so a
contributor can see *why* the code is shaped the way it is without reverse-engineering it
from the diff.

## Convention

- One decision per file, named `NNNN-short-slug.md`, numbered in decision order.
- Frontmatter carries `status` (`accepted` | `superseded` | `deprecated`) and the decision
  `date`. A superseded ADR stays in place and links forward to the one that replaced it.
- Sections: a context paragraph, **Considered options** (the rejected alternatives and
  why), and **Consequences**.
- **When a PR makes an architecturally significant decision, add or update an ADR in the
  same PR** and link it from the PR description.

## Index

| ADR | Decision |
|-----|----------|
| [0001](0001-bundle-build-is-a-content-addressed-cache.md) | Bundle build output is a content-addressed cache, never the user's `~/.claude/` |
| [0002](0002-bundle-artifact-model.md) | Artifact model: four named roots, qualified references, one shape per kind |
| [0003](0003-xdg-path-layout.md) | XDG-conformant path layout: config / cache / data split by role |
| [0004](0004-claude-code-plugin-path-resolution.md) | Hook and MCP path resolution under Claude Code's plugin model |
| [0005](0005-per-project-routing-path-shim.md) | Per-project bundle routing via a PATH shim, not project-local glue |
| [0006](0006-public-release-shape.md) | Public release shape: name, scoped package, version reset, manual publish |
| [0007](0007-multi-candidate-pins.md) | Multi-candidate pins: the pin is an ordered list, resolved by a scoped picker |
| [0008](0008-graded-harness-isolation.md) | Harness isolation is graded; config injection is a per-harness launch spec |
| [0009](0009-capability-axes-are-the-artifact-kinds.md) | The capability axes are the existing artifact kinds — no abstract layer, no rename |
| [0010](0010-harness-selected-by-invoked-binary.md) | The harness is selected by the invoked binary, not declared by the bundle |
| [0011](0011-bundle-md-carries-hash-not-version.md) | bundle.md carries the content hash, not the CC version string |
| [0012](0012-unknown-frontmatter-field-validation.md) | Unknown frontmatter fields: fail-fast on typos, warn on genuine unknowns |
| [0013](0013-umbel-is-a-capability-dependency-manager.md) | umbel is a dependency-manager for capabilities; the plugin is boundary I/O |
| [0014](0014-artifact-trust-gate.md) | Trust: gate auto-run artifacts by content hash; skills execute at the harness's discretion |
| [0015](0015-bundle-authoring-model.md) | Bundle authoring: manifest is the source of truth; interleaved wizard, comment-preserving verbs |
