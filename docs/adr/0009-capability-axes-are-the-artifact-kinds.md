---
status: accepted
date: 2026-06-10
---

# The capability axes are the existing artifact kinds — no abstract layer, no rename

Multi-harness support raised the question of how a bundle's contents map onto harnesses
other than Claude Code. An early proposal was to introduce an **abstract capability
vocabulary** — `instruction-set`, `tool-server`, `subagent`, `policy` — and to **rename**
the user-facing `skills` axis to `instructions`, on the belief that "skills" was a
Claude-Code-centric term that would collide with other harnesses (notably Pi, whose
"skills" were thought to be TypeScript packages).

A grounding spike across OpenCode, Pi, and GitHub Copilot CLI removed the premise. Pi's
"skills" are markdown `SKILL.md` files following the [Agent Skills standard](https://agentskills.io)
— the same shape umbel already uses; Pi's TS-package concept is called "extensions." More
broadly, the existing kind names are *already* the cross-harness-standard terms: "skill"/
`SKILL.md` is converging into a shared standard (Pi, OpenCode, and Copilot all expose a
`skills/` directory), "agent" is what CC, OpenCode (`mode: subagent`), and Copilot
(`.agent.md`) all call a delegated sub-agent, "hooks" is shared by CC and Copilot, and
"MCP" is an industry standard.

So the abstract vocabulary would only **re-label axes umbel already has** ([ADR-0002](0002-bundle-artifact-model.md)'s
four kinds, plus `settings`), while moving *away* from the converging standard names and
forcing a breaking frontmatter migration for no gain. Decision: **the five existing kinds —
`skills`, `agents`, `hooks`, `mcps`, `settings` — are the harness-agnostic capability
axes.** There is no abstract layer above them and nothing is renamed.

The "capability model" then reduces to two things, both of which an adapter
([ADR-0008](0008-graded-harness-isolation.md)) owns:

1. a **support level per kind** — `supported` / `best-effort` / `no-op+warn` / `unsupported`;
2. the convention that an adapter **maps each kind to the harness's native form, or
   no-op+warns** when it cannot.

The canonical instruction unit is the Agent Skills `SKILL.md` — already umbel's skill shape —
which makes `skills` the most portable axis.

## Considered options

- **An abstract capability layer + rename `skills → instructions`** (the original proposal) —
  rejected: premised on a false collision (Pi skills are markdown, not packages); it
  re-labels axes that already exist, moves away from the converging Agent-Skills/MCP/agents/
  hooks vocabulary, and breaks existing bundle frontmatter for no benefit.
- **Lump `skills` + `agents` into one `instruction-set` axis** — rejected: a context-injected
  instruction and a delegated sub-agent are different things; umbel already separates them,
  and every surveyed harness that has both keeps them distinct.
- **Keep the abstract names as an internal-only spec vocabulary (no frontmatter change)** —
  rejected as needless indirection: a second name for each axis is a standing drift surface;
  the kind names already serve.

## Consequences

- The capability-model work shrinks from "design and implement an abstraction + a breaking
  rename + a migration" to "declare the per-harness support matrix and the map-or-warn rule."
- **No change to bundle frontmatter; no migration.** Bundles authored today stay valid.
- The support level for each `(kind × harness)` pair is the data behind the public
  harness-support matrix.
- `settings` is the one kind whose support is **graded per key**, not per kind: `model`/`env`
  port widely, `permissions` maps to CC / OpenCode / Copilot but not Pi, and
  `statusLine`/`outputStyle` are Claude-Code-only.
- This amends — does not supersede — [ADR-0002](0002-bundle-artifact-model.md): the four
  kinds (plus `settings`) keep their on-disk shape and now double as the capability axes.
