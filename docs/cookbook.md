# umbel cookbook — bundles that carry behavior

A bundle is more than a list of skills. Because it compiles to a Claude Code plugin
(skills + agents + hooks + MCP servers + settings) and umbel owns the `claude`
invocation, a bundle can **shape a whole session** — inject standing rules, adapt to the
repo it runs in, and compose a stable contract with swappable implementations.

This is the *how-to-build-well* companion to [`bundles-spec.md`](./bundles-spec.md) (the
mechanics) and the README (install/usage). The patterns below are abstracted from real
bundles; snippets are minimal on purpose.

---

## 1. Inject standing rules at session start

**Problem:** you want a repo's operating rules in front of the agent every session, but
you don't want to write a file into the project tree (and a launch-time
`--append-system-prompt` is a one-shot — its survival across context compaction is
undocumented).

**Pattern:** ship a `SessionStart` hook that prints the rules as `additionalContext`.
This is the same channel `CLAUDE.md` uses (conversation context, not the system prompt),
and the hook **re-fires on `compact`**, so the rules are re-asserted after a compaction —
mirroring how project-root `CLAUDE.md` is re-read. Nothing is written into the repo.

`hooks/local/house-rules/HOOK.md`:

```yaml
---
name: house-rules
description: Inject the project's working conventions at session start.
event: SessionStart
matcher: "startup|clear|compact"   # NOT resume — a resumed session keeps the original injection
command: ./inject                  # ./ is rewritten to ${CLAUDE_PLUGIN_ROOT}/hooks/house-rules/inject
async: false
---
```

`hooks/local/house-rules/inject` (a sidecar; umbel preserves its exec bit and co-locates
it with the hook):

```bash
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

emit() {  # raw text -> Claude Code additionalContext JSON (also escape \r and \t in real use)
  local s="$1"; s="${s//\\/\\\\}"; s="${s//\"/\\\"}"; s="${s//$'\n'/\\n}"
  printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$s"
}

emit "$(cat "$SCRIPT_DIR/rules.md")"
```

Verify it actually injects in your target mode — both interactive and `claude -p` deliver
SessionStart `additionalContext`, but confirm with a sentinel rather than assume.

---

## 2. Adapt per-repo from a committed marker

**Problem:** the rules differ per repo (a library vs an app, public vs internal, …) and
the bundle is global — it can't hardcode which variant to inject.

**Pattern:** read a small **committed** marker file at the repo root and pick the variant.
Resolve the repo root with `git rev-parse --show-toplevel`, so it works **offline / in a
sandbox** (no network, no `gh`). If the marker is absent, inject a recipe to create it —
**don't guess** the variant.

```bash
root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
profile="$( [ -n "$root" ] && tr -d '[:space:]' < "$root/.stack" 2>/dev/null || true )"

seed="$SCRIPT_DIR/rules.$profile.md"
if [ -r "$seed" ]; then
  emit "$(cat "$seed")"
else
  emit "No .stack marker. Create a one-line .stack at the repo root (e.g. node|python) and commit it."
fi
```

**Commit the marker** (don't gitignore it): a one-line, non-sensitive selector that
travels into every clone and sandbox, where detection tooling may be unavailable. Resolve
it **once at setup**, not per-session, so offline sessions just read it.

---

## 3. A stable base + swappable methods

**Problem:** you want to experiment with several implementations of the same job without
rebuilding the parts that never change.

**Pattern:** split into an invariant **base** bundle (the contract + tooling shared by
every variant) and **method** bundles that `extends` it. The base injects the contract; a
method adds its own injected procedure **only if** its skills don't already carry it.

```yaml
# review-base.md — invariant contract + shared tooling, injected once
name: review-base
skills: [vendor/annotate, vendor/lint-report]
hooks:  [local/review-base-ruleset]      # injects "what gets reviewed, and the merge gate"

# review-strict.md — one swappable method
name: review-strict
extends: [review-base, strict-skillset]  # inherits the contract + tooling for free
```

Swapping methods = swap the method bundle; the base is untouched. A new method authors
only its own procedure. (`extends` merges skills/agents/hooks/MCP across the chain, so the
base's inject hook comes along automatically.)

---

## 4. Extend cohesive systems; cherry-pick loose collections

Not every upstream is composed the same way:

- A **cohesive system** (a meta-skill + a session hook + skills that cross-reference each
  other, designed to be taken whole) → `extends:` it. Cherry-picking breaks the web and
  drops its hook.
- A **loose collection** (independent skills, you use a handful) → list the few you use as
  qualified `skills:` refs.

Mixing both in one bundle is normal: `extends: [the-cohesive-one]` plus
`skills: [loose/used-skill-a, loose/used-skill-b]`.

---

## 5. Write injected rules as one coherent procedure

Injected text competes for the agent's compliance. A few things that help it land as
*rules to follow* rather than *ideas to consider*:

- **One self-contained procedure per variant**, not a shared "common" block + per-variant
  "deltas" concatenated at runtime. A concatenated kit reads as optional and the agent
  drifts; a single coherent procedure (even if it duplicates some prose across variants)
  gets followed. Favor coherence over DRY here.
- **An authoritative wrapper + a user-override valve.** Frame the block as binding, but
  state that explicit user instructions and the repo's `CLAUDE.md` win — so the agent
  isn't obstinate when you override it.
- **Targeted anti-rationalization** on the 1–3 rules that actually get skipped: name the
  excuse and counter it inline (e.g. *"don't skip the test gate because 'it's a tiny
  change' — run it"*).

```
<operating-rules>
These are the rules for this repo. Follow them as a procedure, not optional suggestions.
They take precedence over your defaults, BUT explicit user instructions and this repo's
CLAUDE.md override them — the user is in control.

<your one coherent procedure here>
</operating-rules>
```

---

## Gotchas

- **`": "` (colon-space) in `description:`** breaks the YAML plain scalar, and the bundle
  is silently dropped from the index (`umbel list` shows it blank; `build`/`show` say "not
  found"). Reword (`—` instead of `:`) or quote the value.
- **Hook commands**: a leading `./rel` is rewritten to `${CLAUDE_PLUGIN_ROOT}/hooks/<name>/rel`,
  which resolves *because* the hook loads from the plugin's `hooks/hooks.json`. The same
  variable is **not** substituted in a `--mcp-config` file — MCP commands are anchored to
  an absolute cache path instead.
- **Sidecars** (scripts, seed files) live in the hook/MCP artifact dir and are copied with
  the exec bit preserved; read them relative to the script's own dir (`$SCRIPT_DIR`), not
  a hardcoded canonical name.
- **`SessionStart` matchers**: use `startup|clear|compact`; omit `resume` (a resumed
  session already carries the original injection — re-injecting duplicates it).

---

## Minimal end-to-end example

A bundle that injects stack-specific conventions, selected by a committed `.stack` marker:

```
~/.config/umbel/
  bundles/house-rules.md         # name: house-rules; hooks: [local/house-rules]
  hooks/local/house-rules/
    HOOK.md                      # event: SessionStart; matcher: startup|clear|compact; command: ./inject
    inject                       # reads <repo>/.stack, cats rules.<stack>.md, emits additionalContext
    rules.node.md                # the coherent procedure for node repos
    rules.python.md              # …and for python repos
```

`umbel build house-rules`, then launch through umbel from a repo containing a committed
`.stack`: the matching conventions are injected at every session start and re-asserted
after compaction — with nothing written into the project tree.
