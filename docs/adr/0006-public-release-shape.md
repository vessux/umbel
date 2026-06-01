---
status: accepted
date: 2026-05-26
---

# Public release shape: name, scoped package, version reset, manual publish

umbel ships as **`@vessux/umbel`** on npm (scoped to a personal account), with a bare
`umbel` bin, MIT-licensed, from a public repo. The public history starts at **v0.1.0** — a
deliberate reset rather than the honest internal version the private spec had already
reached — with git history squashed to a single initial-release commit. Publishing is
**manual from a laptop**, gated only by `prepublishOnly: typecheck && test && build`; there
is no CI publish workflow.

The name `umbel` — a radial flower cluster, one stem with many flowers fanning from a single
node — maps to a bundle's shape: one manifest, many composed artifacts radiating out.

## Considered options

- **Name alternatives** — `graft` (npm name taken), `pleach` (verb-on-verb CLI friction,
  spell-ambiguous), composition metaphors like quilt/mosaic/weave (break the botanical brand
  carried from the project's origin). `umbel` won on CLI namespace ergonomics —
  `umbel <verb> <object>` parses cleanly as the program name becomes a passive namespace —
  and the cluster metaphor.
- **Bare unscoped `umbel` package** — rejected: accepts npm name-similarity collision risk.
  A scoped package resolves it deterministically while the bin stays bare for daily UX.
- **Publish the honest internal version** — rejected: signals false stability and surfaces
  hidden prehistory. `v0.1.0` honestly signals "new public project, unstable," which fits a
  solo passive-maintenance posture.
- **A new GitHub org** — rejected: premature governance for a one-author project.
- **CI publish-on-tag with an `NPM_TOKEN` secret** — rejected: adds token rotation and is
  harder to abort mid-flow; manual publish plus a local gate is cheaper at this volume.
- **Keep full git history / keep the worklog + backlog checked in as a transparency
  signal** — rejected: would leak rejected-alternative archaeology into the public repo. The
  private worklog carried the prehistory instead — and that worklog is now itself distilled
  into these ADRs.

## Consequences

- The public repo has a clean origin point; the pre-v0.1.0 evolution survives only in the
  (now-distilled) private worklog.
- No compatibility shims were kept across the rename — there was a near-zero prior install
  base. `SECURITY.md` routes reports to the maintainer.
- Pre-1.0, breaking changes are acceptable with a note at publish time (see the shim
  relocation in [ADR-0003](0003-xdg-path-layout.md)).
