---
status: accepted
date: 2026-06-27
---

# bundle.md carries the content hash, not the CC version string

`bundle.md` is the **harness-agnostic resolved manifest** — the resolved bundle
(after `extends:` composition) plus its recommended invocation, written so the
cache stands alone for any consumer. Its frontmatter therefore carries the
bundle's identity as a bare content **hash** (`hash: <12-hex>`), the same hash
that names the cache dir.

A bundle has no authored semantic version today; the only "version" in play is
`0.0.0+<hash>`, a string shaped to satisfy **Claude Code's plugin.json schema**,
which wants a semver-looking field. That string is computed from the same hash
(`compile.ts`: a single `version` const feeds both plugin.json and the
`UMBEL_BUNDLE_VERSION` env var, so they can't drift), and it is emitted **only**
on Claude-Code surfaces — `plugin.json` and the env var. It is not umbel data;
it is one harness's presentation of the hash.

Decision: **`hash` is the cross-harness identity in `bundle.md`; the
`0.0.0+<hash>` version string stays out of it**, confined to the CC plugin
artifacts. Same identity, two representations on two surfaces. This keeps a
Claude-Code-schema artifact out of the manifest that other adapters
([ADR-0009](0009-capability-axes-are-the-artifact-kinds.md),
[ADR-0010](0010-harness-selected-by-invoked-binary.md)) will consume.

## Considered options

- **Add `version: 0.0.0+<hash>` to `bundle.md` frontmatter** so the
  self-describing file matches `UMBEL_BUNDLE_VERSION` literally — rejected: it
  duplicates the hash in two formats within one file, touches the spec'd
  frontmatter key-order contract, and leaks the CC `0.0.0+` shape into the
  harness-agnostic manifest. This alternative has been proposed twice (gh#17's
  acceptance wording assumed the field existed; bead `umbel-8y4` re-raised it),
  which is why it is recorded here rather than left implicit.

## Consequences

- gh#17's acceptance text ("equals the `version` field in the compiled
  `bundle.md`") was inaccurate — the value it shipped is plugin.json's `version`,
  which is correct. The wording is corrected; the code is not.
- When real semantic versioning lands, a bundle gains an *authored* version
  distinct from its content hash; at that point a `version` field in `bundle.md`
  may be warranted on its own merits — but as a manifest field the author sets,
  not as a mirror of the CC plugin string.
