# umbel bundles — spec

Per-process, switchable bundles of Claude Code capabilities (skills, subagents,
hooks, MCP servers, whitelisted settings). Designed so a developer can launch
concurrent `claude` sessions in the same project, each operating under a
different curated capability set, without mutating the user's real
`~/.claude/` state.

This spec is the mechanics. For *how to build well* — session rule injection,
per-repo adaptation via a committed marker, base + swappable methods — see the
[cookbook](./cookbook.md).

## Goals

- Named, version-controlled bundles. Author once, share via `~/.config/umbel/bundles/`
  or check into `<project>/.claude/bundles/`.
- Per-process activation via a wrapper command. Two `claude` processes in the
  same project can run different bundles concurrently.
- Composition. Bundles inherit from other bundles via `extends:` (multi-parent
  mixin).
- No mutation of `~/.claude/` (oauth, history, plugins, projects state).
- No mid-session bundle swap. Bundle is fixed at process launch.

## Non-goals

- Per-`Task()`-tool-call bundle override (would need Anthropic harness change).
- Mid-session swap (`CLAUDE_CONFIG_DIR` is fixed at exec; settings/MCPs load
  once per session).
- Multi-author issue-tracker semantics. Solo + per-project.

## Mechanism overview

A bundle compiles to a Claude Code plugin layout (`.claude-plugin/plugin.json`
plus `skills/`, `agents/`, `hooks/`, `.mcp.json`,
`settings.json` subtrees) into a content-addressed cache directory. The wrapper
invokes:

```
UMBEL_BUNDLE=<name> claude \
  --plugin-dir   <cache>/<name>-<hash> \
  --settings     <cache>/<name>-<hash>/settings.json \
  --mcp-config   <cache>/<name>-<hash>/.mcp.json \
  --strict-mcp-config \
  <forwarded-args>
```

`--plugin-dir`, `--settings`, `--mcp-config`, `--strict-mcp-config` are
per-process Claude Code flags. The user's `~/.claude/` is not touched.
Project `<cwd>/.claude/skills/+agents/` continues to load as a shared baseline
alongside the bundle.

## Bundle definition

A bundle is a `bundle.md` file with YAML frontmatter and an optional Markdown
body documenting intent.

```yaml
---
name: data-science
description: Tools for data science work
extends: [base, lang-py]
skills: [ds/pandas-cheatsheet, ds/plotnine]
agents: [ds/data-scientist]
hooks: [base/log-bash, ci/preflight]
mcps: [local/duckdb, anthropic/playwright]
mergeMcp: false
settings:
  model: claude-opus-4-7
  env:
    DUCKDB_PATH: /var/data/db.duckdb
  outputStyle: concise
---

Bundle for ad-hoc analysis sessions. Use when wrangling tabular data
in DuckDB / pandas.
```

### Frontmatter fields

| Field            | Required | Type                | Notes                                                              |
|------------------|----------|---------------------|--------------------------------------------------------------------|
| `name`           | yes      | `^[a-z][a-z0-9-]{1,40}$` | Filesystem-safe, lowercase, hyphenated.                       |
| `description`    | no       | string              | Shown in pickers / `umbel list`.                                  |
| `extends`        | no       | list of names       | Multi-parent mixin. See [Composition](#composition).               |
| `skills`         | no       | list of qualified refs | Each entry is `<source>/<leaf>`. Resolved against `~/.config/umbel/skills/<source>/<leaf>/`. Bare names (no slash) are rejected. |
| `agents`         | no       | list of qualified refs | Same shape, against `~/.config/umbel/agents/<source>/<leaf>/`.        |
| `hooks`          | no       | list of qualified refs | Each entry is `<source>/<leaf>`. Resolved against `~/.config/umbel/hooks/<source>/<leaf>/HOOK.md` + sidecars. |
| `mcps`           | no       | list of qualified refs | Each entry is `<source>/<leaf>`. Resolved against `~/.config/umbel/mcps/<source>/<leaf>/MCP.md` + sidecars. |
| `mergeMcp`       | no       | bool, default false | When true, omit `--strict-mcp-config`; bundle MCPs add to project. |
| `settings`       | no       | object              | Whitelisted keys only (see [Settings whitelist](#settings-whitelist)). |

Unknown fields → build warning, ignored.

## Storage and lookup

Two scopes:

- User: `~/.config/umbel/bundles/<name>.md`
- Project: `<project>/.claude/bundles/<name>.md`

When a name resolves, project shadows user (project wins on collision). `bundle
list` shows both with a scope tag.

## Source resolution

| Artifact      | Root                                        | Lookup                                      |
|---------------|---------------------------------------------|---------------------------------------------|
| Skills        | `~/.config/umbel/skills/<source>/<leaf>/`         | Directory with `SKILL.md` + sidecars. Bundle ref form: `<source>/<leaf>`. |
| Subagents     | `~/.config/umbel/agents/<source>/<leaf>/`         | Same shape.                                 |
| Hooks         | `~/.config/umbel/hooks/<source>/<leaf>/HOOK.md`   | Directory with `HOOK.md` (frontmatter declaring event/matcher/command) + optional sidecar scripts. |
| MCPs          | `~/.config/umbel/mcps/<source>/<leaf>/MCP.md`     | Directory with `MCP.md` (frontmatter declaring command + optional args/env/transport) + optional sidecar scripts. |
| Bundles       | `~/.config/umbel/bundles/`, `<proj>/.claude/bundles/` | For `extends:` resolution.              |

The `<source>` subfolder is an attribution layer that lets multiple upstreams
coexist on disk without flat-name collisions (e.g. `pocock/tdd` alongside
`superpowers/tdd`). It is an arbitrary lowercase identifier chosen by the
operator — typical values: a tool name (`plannotator`), an upstream-org name
(`superpowers`), or `local/` for hand-authored content.

**Canonical name** of a skill/agent is the frontmatter `name:` field of
`SKILL.md`/`AGENT.md`. The source-side leaf is an organizational alias and
may differ from the canonical name (e.g. source leaf `annotate` but
frontmatter `name: plannotator-annotate`). The canonical name is propagated
to the cache dir name and to the `<project>/.claude/skills/<canonical>/`
install path so CC's plugin loader can identify the skill by its declared
identity.

**Bare refs** (a name without a `/`) are rejected at resolve time —
no flat-namespace fallback, no automatic search of subfolders. Each ref
must spell out its source.

## Composition

`extends: [a, b, c]` declares a chain of parents. Resolution:

1. Build linear MRO via depth-first, last-occurrence-wins (Python-style C3
   simplification).
2. Visit parents left-to-right, each fully resolved before merge.
3. For each field in child:
   - **Lists** (`skills`, `agents`, `hooks`, `mcps`):
     concat parent's then child's, dedupe by ref with **child winning**.
   - **Maps** (`settings`): deep-merge with child keys overriding.
   - **Scalars** (`description`, `mergeMcp`): child overrides parent.
4. `extends:` itself is not inherited (each bundle declares its own parents).

Missing parent name → build error.

## Validation

Hard errors that abort the build:

- `name` malformed.
- `extends` parent not found.
- Skill / agent / hook / mcp name not found in source root.
- Settings key not in whitelist.
- Hooks schema invalid against CC's known shape.
- MCP artifact `MCP.md` missing required `command`.
- Unknown frontmatter field within **edit-distance ≤ 1 of a known field** —
  treated as a typo (e.g. `skils:`), with a `did you mean 'skills'?` hint. See
  [ADR-0012](adr/0012-unknown-frontmatter-field-validation.md).

Soft warnings (stderr, build proceeds):

- Genuinely-unknown frontmatter field (distance > 1 from every known field) —
  ignored, but the format stays forward-compatible for real future fields.
- Bundle skill name collides with `<project>/.claude/skills/<name>/`. Project
  wins at runtime.
- Bundle declares MCPs and `mergeMcp: false` while `<project>/.mcp.json` exists.

On `umbel run`, warnings are gated on an explicit acknowledgment before the
harness launches when stdout is a TTY (the TUI would otherwise repaint over
them); on a non-TTY the warnings print to stderr and the run proceeds (they
survive in logs there). Other paths (`build`, `apply`) print warnings without
gating.

## Compilation

Cache root: `~/.cache/umbel/bundles/`.

Cache key (`<short-hash>`):

```
hash = sha256(
  resolved-manifest-canonical-yaml
  || transitive-bundle-source-bytes
  || mtimes(skills/agents source dirs referenced)
)[:12]
```

Cache dir: `~/.cache/umbel/bundles/<name>-<hash>/`.

Layout:

```
<name>-<hash>/
├── .claude-plugin/
│   └── plugin.json          # name, version "0.0.0+<short-hash>", description
├── skills/
│   └── <canonical>/         # symlink → ~/.config/umbel/skills/<source>/<leaf>/  (canonical = frontmatter `name:`)
├── agents/
│   └── <canonical>/         # symlink → ~/.config/umbel/agents/<source>/<leaf>/
├── hooks/                   # copy of hook artifact dirs (sidecars + HOOK.md)
├── mcps/                    # copy of mcp artifact dirs (sidecars + MCP.md)
├── .mcp.json                # generated from `mcps` artifacts
├── settings.json            # generated from `settings` + `hooks` overlay
└── bundle.md                # self-describing manifest + invocation (see below)
```

Cache dir names use the **canonical name** (frontmatter `name:`) so CC's
plugin loader can identify the skill by its declared identity. The source-side
`<source>/<leaf>` subfolder layout is invisible in the cache.

Symlinks are absolute (resolve source via `realpath` once), matching v0.
Exception: on canonical-name collision (see below), colliding entries are
**copied** (not symlinked) so their frontmatter `name:` can be rewritten.

### Canonical-name collisions

If two skills/agents in a single resolved bundle have the same canonical name
(frontmatter `name:`), the cache cannot give both the bare dir name. Compile
detects this and prefixes **all** colliding entries with their source: cache
dirs become `<source>-<canonical>/` for every entry in the collision group,
and the frontmatter `name:` in each cached SKILL.md/AGENT.md is rewritten to
match. Non-colliding entries are unaffected.

Prefix-all (rather than prefix-all-but-first) makes the build deterministic:
the same input set produces the same cache shape regardless of manifest order.
Frontmatter rewrite forces a *copy* of the source dir instead of a symlink,
since we need to modify the SKILL.md/AGENT.md content. Sidecar files are
copied alongside.

### Self-describing `bundle.md`

The cache root contains a `bundle.md` written at build time. It is the
**resolved** manifest (after `extends:` composition and defaulting) plus the
recommended claude invocation. Purpose: the cache stands alone — a consumer
holding only the directory needs no other tool to know how to launch it.

Shape:

```markdown
---
name: data-science
hash: 9f3c1a2b7e04
description: Tools for data-science work
skills:
  - claude/base-skill
  - cc-plugin-superpowers/pandas-cheatsheet
agents:
  - claude/data-scientist
hooks:
  - base/preflight
mcps:
  - local/duckdb
settings:
  model: claude-opus-4-8
  env:
    PYTHONHASHSEED: "0"
---

[verbatim markdown body from the source bundle.md, if any]

## Invocation

\`\`\`bash
claude \
  --plugin-dir /home/you/.cache/umbel/bundles/data-science-9f3c1a2b7e04 \
  --settings /home/you/.cache/umbel/bundles/data-science-9f3c1a2b7e04/settings.json \
  --mcp-config /home/you/.cache/umbel/bundles/data-science-9f3c1a2b7e04/.mcp.json \
  --strict-mcp-config
\`\`\`
```

This block is **verbatim `umbel build` output**: `yaml` serializes lists
block-style (one `-` per line), and the frontmatter key order is fixed by the
emitter:

- **Key order:** `name`, `hash`, `description`, then any non-empty `skills`,
  `agents`, `hooks`, `mcps` lists, then `mergeMcp` (only when the bundle sets
  it), then `settings` (only when non-empty). Unset fields and empty lists are
  omitted; the `extends:` field is composed away and never appears.
- **Refs stay qualified** (`<source>/<leaf>`), exactly as written in the
  manifest — never canonicalized to bare names. (The on-disk cache *directories*
  use the canonical frontmatter `name:` — see above — but the `bundle.md` refs
  do not.)

Rules for the `## Invocation` block:

- One flag per line, backslash-continued, so consumers can grep flag-by-flag.
- Absolute paths to the actual cache dir (host paths). Sandbox consumers
  search-and-replace the cache path with their in-container target.
- `--settings` line present only when `settings.json` was emitted (i.e. the
  bundle declares a `settings:` field; hooks do **not** emit `settings.json` —
  they load from the plugin's `hooks/hooks.json` via `--plugin-dir`).
- `--mcp-config` line present only when `.mcp.json` was emitted.
- `--strict-mcp-config` line present only when previous AND `mergeMcp` is
  not `true`.
- Future bundle frontmatter fields that map to claude flags add new lines
  here. This is the **single source of truth** for the bundle-features →
  claude-flags mapping; consumers do not reimplement it.

This file is plain Markdown so a human inspecting the cache (`cat
.../bundle.md`) gets a readable summary. Machine consumers parse the
fenced bash block.

### Concurrency

Content-addressed dirs are lock-free:

- Two parallel `umbel run X` invocations compute the same hash.
- `mkdir <name>-<hash>` is the atomic stake; loser sees `EEXIST` and reuses.
- Build writes to a sibling `<name>-<hash>.partial/`, atomically `rename`d on
  success. Stale `.partial/` on next run → delete, rebuild.

### Stable-name symlink

Alongside the content-addressed dirs, the cache root maintains a
`by-name/` subdirectory of symlinks from bundle name to most-recently-built
hash dir:

```
~/.cache/umbel/bundles/
├── data-science-abc123/
├── data-science-def456/
├── lang-py-9f9f9f/
└── by-name/
    ├── data-science → ../data-science-def456
    └── lang-py      → ../lang-py-9f9f9f
```

Written / updated atomically (via `symlink` to a temp name + `rename`) on
every successful `umbel build` or `umbel apply` for the bundle in
question. The symlink is **per name**, not per name+hash; rebuilding the
same bundle updates the same symlink.

Purpose: stable address for external consumers (sandbox tools, devcontainer
scripts, host shell wrappers). Consumers refer to
`~/.cache/umbel/bundles/by-name/<name>/` and the path stays valid
across bundle edits. Without this, every consumer's config would embed a
content hash and bit-rot on the next rebuild.

GC (below) only operates on `<name>-<hash>/` directories. The symlink and
the dir it points at are always preserved.

### GC

On any `umbel build` / `umbel run`: list `<name>-*/` under the cache,
sort by access mtime descending, keep newest 3 per name, remove the rest.
The hash dir currently targeted by `by-name/<name>` is always kept
regardless of mtime rank. Removal uses `rm -rf` on the dir (symlinks not
followed).

`umbel gc` is a no-op convenience that runs the same routine
across all bundle names.

## Wrapper invocation

```
umbel run [<name>] [--no-cache] [-- ...claude args]
```

Resolution order for `<name>`:

1. Explicit positional arg.
2. `UMBEL_BUNDLE` env var (literal `__vanilla__` resolves to vanilla; see below).
3. Pin file `<project>/.umbel-bundle` (ordered candidate list):
   - One candidate → run that bundle directly (no picker).
   - `__vanilla__` sentinel (as the single candidate) → run plain claude, no flags, no picker.
   - Multiple candidates → on TTY, open the scoped picker (restricted to those candidates, default pre-selected); on non-TTY, resolve to the default candidate (first listed).
   - Absent / all-commented → unresolved (continue to step 4).
4. No resolved candidate: on TTY, open the full picker with a `(vanilla)` row prepended
   to the bundle list. On non-TTY, silently fall through to vanilla.

`--no-cache` forces a rebuild even if the hash matches.

After resolution:

- **Named bundle**: wrapper resolves manifest (project shadows user),
  applies `extends:`, validates, computes hash, reuses or builds the
  cache dir, then spawns claude with the four flags above plus the
  user's forwarded args.
- **Vanilla**: wrapper spawns claude with no flags and no
  `UMBEL_BUNDLE` in the inherited env. Used when the pin / env / picker
  selected vanilla, or when no name resolved in a non-interactive shell.

In both cases, the wrapper exports `UMBEL_RESOLVED=1` into the spawned
claude's environment. This is a recursion guard: when claude (or any
subprocess of it) re-invokes `claude` via the PATH shim, the shim sees
`UMBEL_RESOLVED=1` and exec's the real claude binary directly, skipping
the picker. The wrapper also strips its shim directory from `$PATH`
before spawning so the spawned `claude` resolves to the real binary
without a wasted bash hop.

The wrapper is the only umbel path that runs claude. There is no
`umbel apply --activate` / global-pin-and-relaunch mode.

## Pin file

```
<project>/.umbel-bundle
```

Plain text, one **candidate** per line. Example:

```text
discovery        # primary: the bundle I use most here
delivery         # also relevant on this repo
# __vanilla__    # parked: uncomment to offer plain claude too
```

**File grammar:**

- Lines are trimmed; blank lines and full-line `# …` comments are skipped.
- Inline trailing `name # …` comments are stripped (bundle names cannot
  contain `#`, so this is unambiguous).
- Duplicates are deduped; first occurrence wins.
- A pin whose candidates are all commented out (or the file is empty/absent)
  is equivalent to no pin — never an error.

**Candidates and resolution:**

| Pin content                      | Meaning                                                                         |
|----------------------------------|---------------------------------------------------------------------------------|
| One `<bundle>` line              | Resolves directly; no picker. Backward-compatible with existing single-line pins.     |
| `__vanilla__` (as single line)   | Run plain claude with no bundle, no picker.                                     |
| Multiple lines                   | Scoped picker on TTY (candidates only, default pre-selected); default candidate on non-TTY. |
| Absent / all-commented           | No pin → full picker on TTY, silent vanilla on non-TTY.                         |

**Default candidate:** the first listed candidate. It is pre-selected in the
scoped picker and resolved automatically in non-interactive shells.

**`__vanilla__` as a candidate in a multi-line pin:** renders a `(vanilla)` row
in the scoped picker. There is no implicit vanilla row in the scoped picker —
it only appears if `__vanilla__` is listed.

**Candidates are not pre-built.** Each builds lazily on first pick or
non-interactive resolution (the existing `building bundle 'X'…` notice).

`umbel apply <name>` writes a single-candidate bundle pin. It also builds the
bundle as a side effect — warming the cache and updating the `by-name/<name>`
symlink (printing a `built <path>` line) — so a subsequent plain `umbel run`
launches without a rebuild. `umbel apply --vanilla`
writes the `__vanilla__` sentinel. `umbel unpin` removes the file entirely.
`umbel apply` refuses (exit 2, hint to run `umbel unpin` first) to overwrite an
existing multi-candidate pin — multi-candidate pins are hand-authored. The
bundle-name regex (`^[a-z][a-z0-9-]{1,40}$`) rejects underscores so the
sentinel cannot collide with a real bundle.

VCS treatment: not auto-managed. README documents the recommendation —
**commit it** if the team wants a shared default; ignore it for per-developer
setups. umbel makes no edits to `.gitignore` and does not stage the file.

## Pickers

Pickers fire when a no-arg subcommand is invoked on a TTY. There are two
picker variants: the **full picker** and the **scoped picker**.

Behavior on non-TTY varies by verb:

- `run` falls through to vanilla (no pin) or the default candidate (multi-candidate pin) — silent, no prompt.
- `apply` / `show` / `build` error with a hint to pass `<name>` or pin.

### Full picker

Used by `run` when nothing resolves (no pin, no arg, no `UMBEL_BUNDLE` env),
and by `apply`, `show`, and `build` when invoked without an arg on a TTY. Shows every
discovered bundle. For `run` and `apply`, a `(vanilla)` row is prepended. Row
format:

```
  (vanilla)         Run claude with no bundle
  data-science      Tools for data science work     [user] [pinned]
  base              Universal baseline              [user]
  ds-no-mcp         DS without DuckDB MCP           [project] [shadowed]
```

The current pin (or vanilla pin) is pre-selected. `show` and `build` use the
full picker but pre-select the default candidate when a pin is present.

### Scoped picker

Used by `run` on a TTY when the pin has **more than one candidate**. Restricted
to exactly the pin's candidates — no other bundles are shown. Row format mirrors
the full picker; the default candidate (first listed in the pin) is pre-selected.
A `(vanilla)` row appears only if `__vanilla__` is listed as a candidate in the
pin.

The scoped picker is purely **ephemeral** — selecting a candidate resolves the
launch only and does **not** rewrite the pin. To persist a default, run
`umbel apply` (which uses the full picker and writes a single-candidate pin on
selection, after confirming any existing multi-candidate pin is removed).

### `umbel list` and multi-candidate pins

`umbel list` marks every candidate in the PINNED column (`yes`),
distinguishing the default candidate (`yes*`) with a footnote.

### `unpin`

`unpin` removes the pin file immediately with no confirmation prompt. On success it
prints `unpinned`; when no pin file exists it prints `no pin to remove` and exits 0
(no-op).

## PATH shim

`umbel shim install [--force]` writes a bash script to
`${UMBEL_DATA_DIR:-$XDG_DATA_HOME/umbel}/bin/claude`. The user
adds this directory to their shell rc:

```
export PATH="$HOME/.local/share/umbel/bin:$PATH"
```

The shim's behavior:

1. If `UMBEL_RESOLVED=1` is set in the environment, the shim strips its
   own dir from `$PATH` and exec's the real `claude` binary with the
   forwarded args. This is the recursion-guard path used when umbel has
   already resolved the launch (named bundle or vanilla) and is
   spawning claude downstream, or when a subprocess inside claude
   shells out to `claude` again.
2. Otherwise, the shim exec's `umbel run -- "$@"`, which runs the
   resolution flow above (arg → env → pin → picker / silent vanilla).

`umbel shim uninstall` removes the file. `umbel shim path` prints the
absolute path. The shim is self-contained bash; the install command
just stamps it out.

Opt-out for a single invocation: call claude by absolute path
(`/usr/local/bin/claude ...`), or run with `UMBEL_RESOLVED=1` prefixed
to the command.

### `init` wizard

Sequential prompts:

1. **Name** — text input, validated against the regex.
2. **Description** — text input, optional.
3. **Save destination** — `~/.config/umbel/bundles/` (user, default) or
   `<project>/.claude/bundles/` (project, only offered when CWD is inside a
   project).
4. **Extends** — multi-select of existing bundles (user + project).
5. **Skills** — multi-select from `~/.config/umbel/skills/`. Items inherited from any
   selected parent appear pre-checked, **locked**, and tagged `[inherited]`.
   User picks only additional skills.
6. **Agents** — same as skills.

Wizard does not author `mcps` / `hooks` / `settings`. User edits the
generated `bundle.md` to add those.

## Introspection

Three signals to identify the active bundle inside a session:

- `UMBEL_BUNDLE` env var (always exported by the wrapper).
- Optional bundle-supplied statusline script — bundle declares
  `settings.statusLine.command`, the script reads `$UMBEL_BUNDLE`.
- `/which-bundle` slash command — installable as a skill in any bundle, prints
  `$UMBEL_BUNDLE` to chat.

## Settings whitelist

Bundles may declare only these `settings` keys. Anything else → validation
error.

| Key            | Why allowed                                                   |
|----------------|---------------------------------------------------------------|
| `model`        | Per-bundle model preference.                                  |
| `env`          | Path / config env vars a skill needs.                         |
| `statusLine`   | Bundle ships its own statusline.                              |
| `permissions`  | Bundle-specific tool allow/deny lists.                        |
| `outputStyle`  | Default output style for the bundle. Bundle authors reference CC built-in style names (e.g. `explanatory`); umbel no longer ships output-styles as a named artifact. |

`hooks` is **not** declared under `settings`; it is its own top-level field
(see [Bundle definition](#bundle-definition)). The compiler emits hooks into
the plugin's `hooks/hooks.json` (auto-loaded via `--plugin-dir`), **not** into
`settings.json`. Claude Code resolves `${CLAUDE_PLUGIN_ROOT}` only for hooks
that are plugin-associated; a hook loaded from a `--settings` file is rejected
at launch with *"Hook command references ${CLAUDE_PLUGIN_ROOT} but the hook is
not associated with a plugin."*

## Hooks

Hooks are name-resolved artifacts living under `~/.config/umbel/hooks/<source>/<leaf>/`.
Each artifact dir contains a `HOOK.md` (frontmatter manifest) plus any sidecar
scripts the hook invokes. Bundles reference them via qualified refs in the
`hooks: [<source>/<leaf>, ...]` list (named-only; the old inline `hooks:` map
shape is no longer accepted — bk-A3 dropped it).

### HOOK.md frontmatter

```yaml
---
name: log-bash             # canonical identifier (defaults to leaf if absent)
description: Append every Bash invocation to ~/.tool-log.
event: PreToolUse          # CC hook event name
matcher: "Bash"            # CC matcher (regex / tool-name)
command: ./log.sh          # relative to artifact dir, or any literal cmd string
async: false               # optional, pass-through to settings.json
timeout: 30                # optional, pass-through
---

(documentation body — unused by tooling, free for prose)
```

**Unit of naming:** one (event, matcher) tuple per HOOK.md. If you want two
matcher rules under the same event, author two HOOK.md artifacts.

### Compile semantics

For each hook reference resolved into a bundle, the compiler:

1. Copies the entire artifact directory (sidecars + HOOK.md) into
   `<cache>/hooks/<canonical>/`. Canonical name = frontmatter `name:`.
2. Rewrites the `command` field: leading `./<rel>` becomes
   `${CLAUDE_PLUGIN_ROOT}/hooks/<canonical>/<rel>`. Other forms pass through
   verbatim.
3. Aggregates `{event, matcher, command, ...extras}` into the plugin's
   `<cache>/hooks/hooks.json` as
   `{hooks: {<Event>: [{matcher, hooks: [{type:"command", command, ...extras}]}]}}`
   (top-level `hooks` wrapper, per CC's plugin-hooks schema). The cache dir is
   the `--plugin-dir` plugin, so this file loads automatically and
   `${CLAUDE_PLUGIN_ROOT}` resolves to `<cache>`.

Canonical-name collision across sources (same `name:` in two hook artifacts in
one bundle) follows the same prefix-all rule as skills/agents: both become
`<source>-<canonical>`. Hook artifacts are always **copied** (not symlinked) so
the cache `<cache>/hooks/<X>/` directory is a stable plugin root for
`${CLAUDE_PLUGIN_ROOT}` substitution.

## MCPs

MCP servers are name-resolved artifacts living under
`~/.config/umbel/mcps/<source>/<leaf>/`. Each artifact dir contains an `MCP.md`
(frontmatter manifest) plus any sidecar binaries or scripts the server
invokes. Bundles reference them via qualified refs in the
`mcps: [<source>/<leaf>, ...]` list (named-only; the old inline `mcpServers:`
map shape is no longer accepted — bk-A4 dropped it).

### MCP.md frontmatter

```yaml
---
name: duckdb              # canonical identifier (defaults to leaf if absent)
description: DuckDB MCP server for ad-hoc SQL access.
command: ./duckdb-mcp     # relative to artifact dir, or any literal cmd string
args: ["--readonly"]      # optional, pass-through to .mcp.json
env:                      # optional, pass-through
  DUCKDB_PATH: /var/data/db.duckdb
transport: stdio          # optional, pass-through
---

(documentation body — unused by tooling, free for prose: auth steps,
required env vars, vendoring notes)
```

**Unit of naming:** one MCP server per `MCP.md`. To ship two servers
(different commands or transports), author two artifact dirs.

### Compile semantics

For each mcp reference resolved into a bundle, the compiler:

1. Copies the entire artifact directory (sidecars + `MCP.md`) into
   `<cache>/mcps/<canonical>/`. Canonical name = frontmatter `name:` (or
   leaf when absent).
2. Rewrites the `command` field: leading `./<rel>` becomes the **absolute**
   `<cache>/mcps/<canonical>/<rel>`. Other forms pass through verbatim — useful
   for `command: docker`, `command: npx`, etc. (Unlike hooks, MCP commands are
   *not* anchored on `${CLAUDE_PLUGIN_ROOT}`: the `.mcp.json` is consumed via
   `--mcp-config`, where CC does not substitute that variable — it resolves only
   for plugin-associated configs. The absolute path is regenerated per build, so
   it always points at the current cache dir.)
3. Aggregates `{command, args, env, ...extras}` into the generated
   `.mcp.json` under `mcpServers: {<canonical>: {command, args, env, ...}}`.

Canonical-name collision across sources (same `name:` in two MCP artifacts in
one bundle) follows the same prefix-all rule as skills/agents/hooks: both
become `<source>-<canonical>`. MCP artifacts are always **copied** (not
symlinked) so the cache `<cache>/mcps/<X>/` directory is a stable absolute path
for the rewritten `command` to point at.

`mergeMcp: true` retains its semantics — the compiler still emits the bundle
`.mcp.json`, but `--strict-mcp-config` is omitted from the launch argv so the
project's own `.mcp.json` is additive rather than hidden.

## CLI surface

```
umbel run    [<name>] [--no-cache] [-- ...args]   # exec claude
umbel apply  [<name>] [--vanilla]                 # write pin + warm cache (--vanilla = pin "no bundle")
umbel unpin                                       # remove pin
umbel remove <alias> | <alias>/<leaf> [--bundle]  # drop a dependency or one artifact
umbel fork   [<newname>] [--bundle <src>]         # project-scope divergent copy
umbel list                                        # table
umbel show   [<name>]                             # resolved view
umbel init                                        # wizard
umbel build  [<name>] [--no-cache]                # warm cache
umbel gc                                          # prune cache
umbel shim   install [--force] | uninstall | path # PATH-shim for `claude`
umbel                                             # help
```

`umbel` (no subcommand) prints help.

### `umbel list`

Plain text table grouped by scope, columns auto-sized:

```
USER (~/.config/umbel/bundles/)
  NAME           DESCRIPTION                  EXTENDS         PINNED
  base           Universal baseline           —               —
  data-science   Tools for data science work  base, lang-py   —
  lang-py        Python toolchain             —               —

PROJECT (<cwd>/.claude/bundles/)
  NAME           DESCRIPTION                  EXTENDS         PINNED
  ds-no-mcp      DS without DuckDB            data-science    yes
```

### `umbel show`

For a single bundle, prints three sections:

1. **Resolved manifest** — full composed view after `extends:` merge. YAML.
2. **Resolved sources** — each name resolved to its absolute source path. Flags
   missing paths.
3. **MCP diff** — three lists: project-only (will be hidden by
   `--strict-mcp-config`), bundle-only (added), shared (both define; bundle
   wins). Suppressed when `mergeMcp: true`.

### `umbel remove`

Non-interactive, comment-preserving edit of the target bundle's `bundle.md`
(the yaml Document API keeps hand-written comments and body prose). Two forms:

- `umbel remove <alias>` — drops the dependency: removes `deps.<alias>`, every
  `<alias>/<leaf>` composition ref across `skills`/`agents`/`hooks`/`mcps`, and
  the dependency's lock entry. A list (or the `deps:` map) that empties is
  removed entirely.
- `umbel remove <alias>/<leaf>` — drops just that one composed artifact ref; the
  dependency and its lock entry stay (it may back other leaves). When it was the
  alias's last ref, a hint suggests `umbel remove <alias>` to drop the now-unused
  dependency.

`remove` only edits the target bundle's *own* manifest; a ref not present there
is a not-found error (exit 3). When the bundle has an `extends`, the error adds a
"if it's inherited via `extends`, `umbel fork` to diverge" hint — a heuristic
prompt, not a precise inheritance check (true detection would require resolving
the parent chain). Removal never introduces executable content, so no trust gate.

### `umbel fork`

`umbel fork [<newname>] [--bundle <src>]` copies a bundle **into the current
project** (`.claude/bundles/`) to diverge from it — the escape hatch a user-scope
edit heads-up points to. The source is resolved by the uniform target rule
(`--bundle`/pin), or picked from the full list on a TTY when unresolved. The new
name is the sole positional; on a TTY it is prompted when omitted, otherwise it
defaults to the source name — producing a same-name **project-scope shadow** that
takes precedence over the user-scope original. The `bundle.md` is copied with its
`name:` rewritten (comments preserved) and its sibling lock copied verbatim, so
the fork is immediately usable. An existing dest file is a conflict (exit 4).

## Risks acknowledged

- **CC plugin schema evolution**. `plugin.json` shape and per-process flag
  names may change upstream. Compiler is version-pinned to a known CC schema;
  release notes flag major bumps.
- **`--strict-mcp-config` blast radius**. By default the bundle replaces all
  project MCPs. `umbel show` surfaces the diff loudly; `mergeMcp: true` opts
  out per bundle.
- **Project baseline leaks**. `<project>/.claude/skills/+agents/` always loads
  alongside the bundle. Authors who want strict isolation must keep that
  directory empty (or move project skills into a project bundle).
- **Settings whitelist conservatism**. Each new key requires deliberate
  whitelisting. Avoid the temptation to widen reflexively.
- **No rollback if `claude` exits dirty**. Wrapper does not restore prior
  state — there's no prior state to restore. The pin file is the only thing
  that persists across invocations and is user-managed.

## Test strategy

- **Unit**: compose / merge / resolve / validate / hash / GC. High coverage.
- **Golden plugin-dir fixtures**: snapshot a compiled cache dir for known
  bundle inputs; assert byte-equal across rebuilds (deterministic compilation
  is a contract).
- **Smoke test**: spawn `claude --help` with the four flags pointing at a
  golden fixture; assert exit 0 and presence of bundle name in output. Skipped
  if `claude` not on PATH (guarded by env detection).
- No deep integration with a running CC session — too brittle for CI.

## Implementation status

Both cache contracts below are **implemented and verified**.

1. **`bundle.md` emission**. `umbel build` and `umbel apply` write
   `<cache>/bundle.md` per the "Self-describing `bundle.md`" subsection
   (resolved frontmatter, verbatim body, `## Invocation` block). The
   bundle-features → claude-flags mapping is a single code path,
   `computeClaudeArgs` in `src/bundle/claude-args.ts`, shared by the host
   launch (`prepareBundleInvocation`) and the `## Invocation` block, so the
   two can never drift.

2. **`by-name/<name>` stable symlink**. `umbel build` and `umbel apply`
   atomically update `~/.cache/umbel/bundles/by-name/<name>` to point at the
   just-built hash dir (symlink + rename), per the "Stable-name symlink"
   subsection. GC preserves the hash dir a `by-name/` symlink targets
   regardless of its mtime rank.

External consumers (devcontainers, shell wrappers) can rely on both
contracts.

## Examples

### Switch bundle for one session

```
umbel run data-science -- claude
```

### Pin a default for the project, then plain-launch

```
umbel apply data-science
umbel run -- claude        # uses pinned bundle
```

### Two concurrent sessions, different bundles

```
# terminal A
umbel run data-science -- claude

# terminal B
umbel run review-mode -- claude
```

### Author a new bundle interactively

```
umbel init
# wizard prompts for name, description, save dest, extends, then per-artifact
# multi-selects with inherited items pre-checked + locked.
```

### Inspect resolved view before running

```
umbel show data-science
```

### Author a child bundle that drops one parent skill

Composition has no `remove:` operator. To diverge, declare a sibling bundle
that extends the same parents but skips the unwanted skill — re-pick the rest
in the wizard. Forks favored over subtraction; keeps merge semantics simple.

## Dependencies, lock & store (tracer slice)

A bundle may declare versioned upstreams in `deps:` — an operator-chosen **alias**
bound to a **coordinate** (ADR-0013). Composition refs keep the `<alias>/<leaf>`
shape; a ref whose alias appears in `deps:` resolves through the **store**
(`$XDG_DATA_HOME/umbel/store/github/<org>/<repo>/<commit>/`), all other refs
resolve against the artifact pool as before.

Coordinates today: `github:<org>/<repo>@<tag>` (fetched + pinned), `link:<path>`
(a local directory — unlocked, live), and the built-in `local` dependency
(≙ `link:${UMBEL_HOME}/local`, hand-authored artifacts, kind-first under
`${UMBEL_HOME}/local/<kind>/<leaf>/`). `local` needs no `deps:` entry — a bare
`local/<leaf>` ref resolves against it, falling back to the legacy pool when the
leaf isn't present there.

```yaml
---
name: dev
deps:
  tools: github:acme/tools@v1.0.0
skills:
  - tools/greet
---
```

`umbel add github:<org>/<repo>@<tag> [leaf] [--bundle <name>]` fetches the repo
into the store (atomic, content-addressed by commit), records the dep, and
appends the skill ref with a comment-preserving manifest edit. The sibling
`<name>.lock` pins each dependency to its resolved commit + a content hash of
the checkout tree; for store-resolved artifacts the compile hash keys on that
pin (not source mtimes), so the same lock produces the same compiled bundle on
any machine. Re-running the same `add` is a no-op (no re-fetch, no lock churn).

`link:` paths expand `${…}` variables from the environment (`${HOME}`,
`${UMBEL_HOME}`, …); an undefined variable is a hard error, and expansion is
**rejected** in `github:` coordinates (a git coordinate must resolve identically
on every machine). `link:`/`local` deps are **not reproducible** — they never
enter the lock and carry no pin (their skills are compile-hashed by mtime, like
the pool). Flipping a dep's coordinate from `link:` to a git URL is therefore a
one-line change that leaves every `<alias>/<leaf>` ref valid: `install` drops the
stale pin (or mints a new one) without touching the refs. Because git coordinates
are the reproducible subset, `install --frozen` hard-errors on an unresolvable
`link:` path (pass `--allow-missing` to tolerate it).

Slice limits: `github:` and `link:`/`local` only (`git:` and `#subpath` pending);
skills only for store-/link-backed refs (the hook/MCP trust gate is ADR-0014, an
earlier slice, and covers fetched executable content — `local`/`link:` content is
your own and is not gated); `deps:` cannot be combined with `extends:` yet.
