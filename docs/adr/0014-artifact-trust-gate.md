---
status: accepted
date: 2026-07-04
---

# Trust: gate auto-run artifacts by content hash; skills execute at the harness's discretion

Refines [ADR-0013](0013-umbel-is-a-capability-dependency-manager.md). Once umbel fetches
third-party **dependencies**, it is running third-party code. This ADR defines what umbel can
*meaningfully* gate, and how.

## Decision

**Integrity is always on.** Each bundle's lock pins a **content hash** of every dependency's
resolved tree, so drift, force-pushes, and rewritten tags are detectable independent of the
gate below.

**The trust gate covers what umbel wires to auto-run — hooks and MCP servers.** Those execute
with no further mediation: a hook fires on tool events, an MCP server spawns at launch. On
`add`/`update`/`adopt` — and on any `install` reconcile or `try` that pulls new or changed
executable content — umbel requires confirmation.

- **The confirmation unit is the content hash of the whole artifact directory**, not the
  command string. A malicious update keeps `command: ./run.sh` byte-identical and rewrites the
  script body; a command-string diff shows nothing. The gate therefore hashes the full artifact
  dir and the diff **drills into the changed files**, with the command string as the summary
  line.
- **Already-trusted, locked content materializes silently.** The gate fires only on content
  new to (or changed from) the lock. So `run`/`apply` against a committed, already-trusted lock
  never prompt.
- **Non-TTY fails closed.** New/changed executable content on a non-interactive run errors
  (with `--yes` to override); a committed already-trusted lock, having nothing new, proceeds
  without a prompt. CI is expected to run against a committed lock.

**Skills and agents are outside the gate.** A `SKILL.md` can itself instruct the agent to run
a script, so there is no "safe subset" of artifact kinds to carve out — gating hooks/MCPs while
waving skills through would be false assurance. Skill/agent-triggered execution is mediated by
the *harness's own* permission system, not umbel's. This is a deliberate scope line, not an
oversight.

**`try` runs untrusted code by design.** It composes *everything* in an unvetted repo and
launches. `try` still shows the gate when the repo ships hooks/MCPs (they are new executable
content), so a skill-only repo launches prompt-free while an executable-carrying one prompts —
but approving that diff does **not** make `try` safe: a `SKILL.md` can instruct the agent to
run code the gate never sees. The prompt is consistency, not protection. umbel does not pretend
otherwise: the docs state plainly that `try <url>` executes untrusted third-party code and that
**sandboxing an untrusted `try` is the user's responsibility** (a container, a throwaway VM,
restricted credentials). The value `try` adds over a global `/plugin install` is that it leaves
no persistent state to clean up — not that it is safe.

## Considered options

- **Integrity-only trust** (the npm/pip norm — pin hashes, no execution gate) — rejected: it
  catches tampering in transit but not a malicious *upstream update*, which is the threat that
  matters once you track a branch.
- **Diff the command string** (cheap, readable) — rejected: it is security theatre. The
  idiomatic hook/MCP command is a relative `./script`; the payload is the script's *body*,
  which a command-string diff never shows.
- **`try` safe-by-default** (compose only skills/agents, require `--unsafe` for hooks/MCPs) —
  rejected: a skill can prescribe running a script, so a skills-only subset is not actually
  safe. Faking a safe default is worse than an honest "this runs untrusted code."
- **Fail-open on non-TTY** (auto-trust when there's no one to prompt) — rejected: it defeats
  the gate exactly where it is least observed (CI, `claude -p`). Committed locks make
  fail-closed non-disruptive.
- **Gate skills/agents too** — deferred: prompt-injection via a fetched `SKILL.md` is real but
  is a harness-permission-system concern, and content-hashing prose gives little signal. Out of
  scope for v1; revisit if the harness exposes a skill-execution hook.

## Consequences

- A new **trust module**: whole-artifact-dir content hashing plus a file-level diff renderer
  for hook/MCP directories, wired into `add`/`update`/reconcile.
- **Skill/agent prompt-injection is an explicit non-goal for v1.** The docs and `try`'s help
  text must say so.
- **CI must run against a committed lock**, or fail closed on first fetch — which is the
  correct, safe default, but needs to be documented alongside `install --frozen`.
- The gate reinforces the lock's integrity hash rather than duplicating it: the lock detects
  *that* content changed; the gate makes a human *approve* the change to executable content.
