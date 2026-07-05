---
status: accepted
date: 2026-07-04
---

# Bundle authoring: the manifest is the source of truth; an interleaved wizard, comment-preserving verbs

Refines [ADR-0013](0013-umbel-is-a-capability-dependency-manager.md). A bundle now has two
layers to author — its **dependencies** (`deps:`) and its **composition** — and two audiences:
maintainers who hand-edit, and newcomers who need discover-and-pick. This ADR defines the
authoring surface. (Which *bundle* a verb targets is defined in ADR-0013's verb section — the
uniform picker-everywhere rule — and is not repeated here.)

## Decision

**Hybrid, with `bundle.md` as the source of truth.** The manifest is hand-editable — it *must*
be, since a thin-share ships that exact file and it has to stay legible and diffable. Three
paths converge on the same file:

1. **Hand-edit** — open `bundle.md` in `$EDITOR`; it's just YAML.
2. **CLI verbs** — `add`/`remove`/`fork` perform surgical, **comment-preserving** edits.
3. **Interactive TUI** — `init`/`edit` for discover-and-pick (newcomers won't know artifact
   names to type).

**`init` is an interleaved wizard** — build forward, adjust at the end:

```
add a dependency  (paste URL / pick from store / local)
  → fetch + trust-gate + name the alias
  → pick THAT dependency's artifacts   (freshly-added deps default all-checked)
↺ "add another dependency?"
→ unified Review screen  (all deps + active artifacts + extends-inherited, locked)
→ write bundle.md + lock
```

The interleaved shape matches the real intent ("I'm adding this source *because* I want its
tdd skill"). The reviewer's concern — no cross-dependency view — is answered by the **Review
screen**, which is the unified view, and by `edit <name>` landing **directly on that Review
view** (add / re-pick / remove). So the unified view exists; it just lives at the end and in
`edit`, not during the add-loop.

**Fetch is inline; the write is transactional.** Adding a dependency in the wizard fetches it
into the store immediately (harmless — it's just data) and runs the trust gate
([ADR-0014](0014-artifact-trust-gate.md)) then and there. But `bundle.md` + lock are written
**only** at the final "write" step; aborting the wizard leaves no manifest, just some warm
store.

**Small calls:** freshly-added dependencies default all-checked (you added them on purpose);
`settings` (`model`/`env`/`permissions`) stay out of the wizard — hand-edited afterward, as the
current wizard already expects.

## Considered options

- **TUI/verb-primary, manifest as an implementation detail** (never hand-edit) — rejected:
  undercuts thin-share (the shared artifact must stay a legible, editable file) and weakens
  scripting and power-use.
- **File-only + minimal verbs** (only `init` scaffolds; everything else hand-edited) —
  rejected: newcomers must already know artifact names, which cuts against the "easy for end
  users" goal that drove the acquisition design.
- **Two-phase wizard** (assemble all dependencies, *then* one grouped compose picker) —
  rejected in favor of interleaved: two-phase is cleaner on paper but forces you to commit to
  dependencies before seeing their artifacts. Interleaved keeps "fetch → see what's inside →
  pick" together; the unified view is recovered at Review.
- **Compose-first** (start in an artifact picker over everything already installed, add-URL
  inline) — rejected as the *primary* flow: it's an empty screen for a fresh install. It
  remains a fine future affordance inside `edit`.

## Consequences

- A new **comment-preserving manifest writer** is the one genuinely new authoring module. The
  hazard is smaller than first assumed: the `yaml` package's Document API preserves comments, so
  the real work is splicing frontmatter in/out of the Markdown body without disturbing prose.
- `init`/`edit` **reuse the existing grouped multi-select picker** (`ui/picker.ts`) and
  generalize `ui/bundle-init.ts`; they are not a new UI stack.
- The **Review view must render `extends`-inherited artifacts** (pre-checked and locked), which
  requires resolving parent bundles first — i.e. the resolve-then-merge contract from ADR-0013.
- `edit` and `init` share one surface (Review), so there is no second editor to build or keep
  consistent.
