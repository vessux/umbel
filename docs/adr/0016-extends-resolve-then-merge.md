---
status: accepted
date: 2026-07-12
---

# `extends` resolves per-bundle, then merges by artifact identity

Refines [ADR-0013](0013-umbel-is-a-capability-dependency-manager.md). ADR-0013 declared that
`compose.ts`'s contract changes from "merge ref lists" to "resolve each bundle then merge
artifact sets, child winning on canonical artifact identity" — but left the mechanics, and the
meaning of *canonical artifact identity*, unspecified. Slice #48 therefore guards `deps:`
combined with `extends` with a `UsageError`. This ADR settles the semantics so that guard can
be lifted.

## Decision

**Uniform resolve-then-merge.** Every bundle in the `extends` chain resolves its *own*
composition through its *own* **lock** into a per-layer artifact set; the sets then merge
ancestors-first, the child overriding on **artifact identity**. There is one merge engine, not a
pool path and a deps path: a pool artifact's provenance is `(source-label, leaf)`, so a pool-only
chain resolves to byte-identical output and is merely the degenerate case. Non-artifact fields
(`settings` / `body` / `mergeMcp` / `description` / `deps`) keep merging at the manifest level.

**Artifact identity is provenance, not display name.** Two resolved artifacts are *the same* —
so the child's overrides the parent's — when they share a **kind** and **provenance**: the
upstream coordinate (sans commit) plus subpath/leaf, independent of **alias** or pinned commit.
A child re-declaring the same upstream artifact wins (its commit). Artifacts that merely share a
**canonical name** are *distinct* and **coexist**; that display-name clash is resolved downstream
by the existing collision prefixer, uniformly with same-bundle collisions. This *sharpens*
ADR-0013's ambiguous "canonical artifact identity" — which read as the display name, the opposite
behaviour — to mean provenance. The consequence is that `extends` never silently drops a parent
capability over an accidental name clash between unrelated upstreams; a child that wants to
*replace* rather than *add* uses `remove` / `fork`.

**An `extends` parent is consumed at its locked state.** A child operation never rewrites an
ancestor's lock. Resolving a child reads each ancestor's sibling lock as-is (**multi-lock**) and
composes the ancestor's *pinned* artifacts:

- `run` / `apply` / `build` materialize missing checkouts across the *whole chain*;
- `install <child>` reconciles only the child's manifest↔lock, but materializes the chain;
- an ancestor that declares `deps:` but has no lock is a hard error naming the ancestor with an
  install hint (a pool-only ancestor needs no lock);
- an ancestor whose manifest has drifted from its lock is consumed *at the lock* (the lock is
  truth); its un-installed edits do not leak into the child.

This keeps each lock owned and mutated only by operating on *that* bundle — no action-at-a-distance
where installing a child silently re-pins a parent that is shared and committed separately. It
also makes explicit that `extends` is **local-only** composition: a thin-shared child that extends
a local parent is reproducible only if the recipient also has the parent (remote bundle-`extends`
stays deferred, per ADR-0013).

**Collision disambiguation escalates.** The prefix `<alias>-<canonical-name>` is no longer
globally unique, because aliases are **bundle-private** — a parent and child can both bind alias
`foo` to different upstreams. When two survivors would otherwise produce the same final name, the
tiebreak escalates to include the origin bundle name (`<bundle>-<alias>-<canonical-name>`). In the
pool world sources are globally unique, so the escalation never fires and existing output is
unchanged.

## Considered options

- **Identity = canonical (display) name** — rejected: a child selecting a different-source
  artifact that happens to share a name would silently drop the parent's, and it retires the
  collision prefixer's coexist behaviour (a regression for the pool world, where two same-named
  skills from different sources legitimately coexist).
- **Bifurcate the merge** (ref-string merge for pool-only chains, resolve-then-merge only when
  `deps` appear) — rejected: two merge engines that can drift, which is exactly the hazard the
  `deps:` + `extends` guard was holding shut.
- **Cascade reconcile ancestors** (operating on a child re-resolves and rewrites the whole chain's
  locks) — rejected: it silently mutates other bundles' locks, which may be shared and committed
  independently, and contradicts ADR-0013's per-bundle lock model.
- **Error on a cross-layer alias+name collision** (make the user rename an alias) — rejected: the
  colliding aliases live in *different* bundles, so the child's author cannot easily rename the
  parent's; escalating the prefix is deterministic and needs no intervention.

## Consequences

- Lifts the `'deps:' combined with 'extends'` guard in `exec.ts`.
- `compose.ts` splits: manifest-level merge for scalars/settings, resolved-set merge for the four
  artifact kinds. `resolve.ts` becomes MRO-aware and reads each layer's lock (multi-lock).
  `collision.ts` gains the origin-bundle escalation.
- The pool-only golden fixtures and the "same lock → same bundle" determinism tests become the
  regression net proving the uniform path preserved behaviour; new fixtures cover deps×extends
  across all kinds.
- **Depends on** lifting `resolveViaStore` to all artifact kinds (`umbel-az5`): the slice's
  acceptance is multi-kind×extends end-to-end, which a non-skill store dep cannot satisfy while
  `resolveViaStore` throws for non-skills. This is a **hard** prerequisite.
- A follow-up (captured separately) may add an advisory when an `extends` parent has uninstalled
  manifest changes; this ADR keeps that case silent.
