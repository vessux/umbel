# umbel

Compose Claude Code sessions from named bundles of skills, subagents, hooks,
MCP servers, and settings. Switch bundles per `claude` process; your real
`~/.claude/` is never touched.

[![ci](https://github.com/vessux/umbel/actions/workflows/ci.yml/badge.svg)](https://github.com/vessux/umbel/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@vessux/umbel.svg)](https://www.npmjs.com/package/@vessux/umbel)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> **Status:** v0.1.0, beta. Solo-maintained, best-effort. Breaking changes
> possible while pre-1.0. Issues welcome.

## Install

```bash
npm i -g @vessux/umbel        # global install — gives you the `umbel` binary
# or
npx -y @vessux/umbel --help   # one-shot via npx
```

Requires Node ≥ 18.17. Unix only (symlinks).

> Note: the npm package is scoped (`@vessux/umbel`) due to npm's
> name-similarity filter. The CLI binary is plain `umbel`, so the rest of
> these docs use that.

## Quickstart

First, get some artifacts on disk (skills, agents, hooks, MCPs) — see
[Installing artifacts](#installing-artifacts). Then author a bundle at
`~/.config/umbel/bundles/data-science.md`:

```yaml
---
name: data-science
description: Tools for data science work
skills: [local/pandas-cheatsheet, local/plotnine]
agents: [local/data-scientist]
mcps: [local/duckdb]
settings:
  model: claude-opus-4-7
---
```

Every artifact ref is `<source>/<leaf>` — bare names are rejected. Bundles
can also pull in `hooks:`; see
[`docs/bundles-spec.md`](docs/bundles-spec.md) for the full schema, and
[`docs/cookbook.md`](docs/cookbook.md) for authoring patterns (per-session rule
injection, per-repo adaptation, base + swappable methods).

Launch Claude Code with that bundle:

```bash
umbel run data-science -- claude
```

Pin a bundle to a project so plain `umbel run` uses it:

```bash
umbel apply data-science
```

## Installing artifacts

umbel does not fetch artifacts for you — it composes what you already have on
disk. Drop skills, agents, hooks, and MCPs into:

```
~/.config/umbel/skills/<source>/<leaf>/SKILL.md
~/.config/umbel/agents/<source>/<leaf>/AGENT.md
~/.config/umbel/hooks/<source>/<leaf>/HOOK.md
~/.config/umbel/mcps/<source>/<leaf>/MCP.md
```

`<source>` is any lowercase identifier you pick — typically the upstream org
name (`superpowers`, `obra`) or `local` for hand-authored content. It exists
so multiple upstreams with overlapping names can coexist; bundles always
reference artifacts as `<source>/<leaf>`.

Override the root with `UMBEL_ARTIFACTS_DIR` (default
`$XDG_CONFIG_HOME/umbel`, typically `~/.config/umbel`).

### General recipe — import a Claude Code plugin repo

Most community plugins are git repos with a `skills/<leaf>/SKILL.md` layout.
Symlink (or copy) each skill into a source-qualified namespace:

```bash
# Pick a namespace name — usually the upstream owner.
NS=upstream-name
REPO=/tmp/upstream-repo
git clone https://github.com/<owner>/<repo> "$REPO"

mkdir -p ~/.config/umbel/skills/$NS
ln -sf "$REPO"/skills/*/ ~/.config/umbel/skills/$NS/
```

Then reference them in a bundle as `$NS/<leaf>`. Repeat for `agents/`,
`hooks/`, and `mcps/` if the upstream ships them.

> Caveat: umbel's `HOOK.md` / `MCP.md` frontmatter is umbel-specific (see
> [`docs/bundles-spec.md`](docs/bundles-spec.md)). Skills and agents drop in
> as-is; hooks and MCPs from upstreams using a different config shape need a
> small adapter file.

### Example: obra/superpowers

```bash
git clone https://github.com/obra/superpowers /tmp/superpowers
mkdir -p ~/.config/umbel/skills/superpowers
ln -sf /tmp/superpowers/skills/*/ ~/.config/umbel/skills/superpowers/
```

Then in a bundle:

```yaml
skills: [superpowers/brainstorming, superpowers/test-driven-development]
```

## Why

Claude Code reads from one `~/.claude/` per user. Editing it to swap skill /
subagent / MCP setups between projects is friction. umbel lets you keep many
named bundles and pick one per `claude` process via `--plugin-dir`,
`--settings`, and `--mcp-config`. The bundle is compiled to a Claude Code
plugin layout in a cache dir on demand; your real `~/.claude/` stays untouched.

See [`docs/bundles-spec.md`](docs/bundles-spec.md) for the full design.

## What's isolated, what leaks

A bundle session does **not** see your everyday Claude Code skills, agents, or
plugins from `~/.claude/`. Some surfaces still pass through, by design or by
quirk:

| Surface                                       | Visible under a bundle?     | How to control it                                                           |
|-----------------------------------------------|-----------------------------|-----------------------------------------------------------------------------|
| `~/.claude/skills`, `agents`, `plugins`       | **No** — fully isolated     | Nothing to do; `--plugin-dir` + `--settings` replace user-scope sources.    |
| `~/.claude/` oauth, history, projects state   | Yes (shared on purpose)     | Keeps you logged in across bundles. Bundles never write here.               |
| `<project>/.claude/skills`, `agents`          | **Yes — baseline leak**     | Keep the dir empty, or move those skills into a project-scope bundle (see below). |
| `<project>/.mcp.json`                         | No, when bundle defines MCPs| Bundle adds `--strict-mcp-config`. Set [`mergeMcp: true`](docs/bundles-spec.md) to additive-merge. |
| `<project>/.mcp.json`                         | Yes, when bundle has no MCPs| The strict flag is only emitted alongside bundle MCPs.                      |

So if your goal is "don't show me anything other than what this bundle
declares", you have to:

1. Author the bundle (user-scope or project-scope — bundles themselves are
   not the leak).
2. Empty `<project>/.claude/skills/` and `<project>/.claude/agents/`, or move
   their contents into a project-scope bundle that extends the user one. For
   example, put project-specific skills under
   `<project>/.claude/skills/local/<leaf>/` and reference them from
   `<project>/.claude/bundles/<name>.md`:

   ```yaml
   ---
   name: my-project
   extends: [data-science]
   skills: [local/project-specific-skill]
   ---
   ```

   `extends:` composes parent + child via C3 linearization
   (see [`docs/bundles-spec.md`](docs/bundles-spec.md)).
3. Leave `mergeMcp` unset (default `false`) so `<project>/.mcp.json` stays
   hidden when the bundle defines MCPs.

Run `umbel show <name>` before launching to see the resolved manifest plus
the project-vs-bundle MCP diff.

## Verbs

```bash
umbel list                              # scope-grouped bundle table
umbel show [name]                       # resolved manifest + sources + MCP diff
umbel build [name] [--no-cache]         # warm cache, print path
umbel apply [name] [--vanilla]          # pin <project>/.umbel-bundle + warm cache (--vanilla = pin "no bundle")
umbel unpin                             # remove the pin
umbel run [name] [-- ...claude args]    # launch claude (bundle if name/pin, vanilla otherwise)
umbel add <coord> [leaf] [--bundle <name>] [--yes]  # fetch a dependency (github:<org>/<repo>@<tag>), lock it, compose a skill
umbel install [--frozen] [--allow-missing] [--bundle <name>] [--yes]  # reconcile deps ↔ lock + fetch (--frozen: strict; --allow-missing: tolerate an absent link: path)
umbel remove <alias> | <alias>/<leaf> [--bundle <name>]  # drop a dependency (+ its refs & lock) or one composed artifact
umbel fork [newname] [--bundle <src>]   # copy a bundle into the current project to diverge (project scope; same-name shadow by default)
umbel init                              # multi-step authoring wizard
umbel gc                                # prune cache (keep newest 3 per name)
umbel shim install [--force]            # install ~/.local/share/umbel/bin/claude (the PATH shim)
umbel shim uninstall                    # remove the shim
umbel shim path                         # print the shim's absolute path
```

Share a bundle thin by committing `bundle.md` + its sibling `<name>.lock`: a
recipient runs `umbel install --frozen` to fetch exactly the locked commits,
which errors (exit 2) on any manifest/lock drift. Plain `umbel install`
reconciles a hand-edited `deps:` into the lock (resolving new/changed
dependencies, keeping existing pins, dropping removed ones) without ever
bumping a pin — that is `umbel update`'s job. `run` / `apply` / `build`
auto-materialize any missing store checkouts before compiling.

Not every dependency is a fetched git pin. A `link:<path>` coordinate points at
a **local directory** (unlocked, live), and the built-in `local` dependency
(`≙ link:${UMBEL_HOME}/local`) is where hand-authored, not-yet-published
artifacts live — reference them as `local/<leaf>` with no `deps:` entry. `link:`
paths expand `${…}` variables (`${HOME}`, `${UMBEL_HOME}`, …; an undefined one
is an error), whereas a `github:` coordinate must resolve identically everywhere
and rejects expansion. Because an alias is decoupled from its coordinate,
**publishing a local artifact is a one-line coordinate flip** (`link:` → git
URL) that keeps every `<alias>/<leaf>` ref valid. `link:`/`local` deps never
enter the lock (not reproducible), so `install --frozen` errors on an absent
`link:` path — pass `--allow-missing` to tolerate it.

When invoked without `[name]` on a TTY, `run` / `apply` / `show` / `build`
open a picker — **full** or **scoped**, depending on the pin:

- **Full picker** (no pin, or `run`/`apply`/`show`/`build` with no arg): every
  discovered bundle, `(vanilla)` row prepended. On non-TTY, `run` falls through
  to vanilla; the others error with a hint to pass `<name>` or pin.
- **Scoped picker** (multi-candidate pin + `run`): exactly the pin's candidates,
  default (first) pre-selected, `(vanilla)` row only if `__vanilla__` is listed
  in the pin. Ephemeral — selecting a candidate does not rewrite the pin.
  (this variant fires for `run` only; `apply`/`show`/`build` use the full picker)

`show` and `build` always use the full picker but pre-select the default
candidate when a pin is present. The current pin (or vanilla pin) is
pre-selected in all picker contexts where it applies.

## Trust

umbel fetches third-party code, so integrity is always on: every lock entry
pins a **content hash** of the dependency's resolved tree, and `install
--frozen` errors (exit 2) on any drift from it.

On top of integrity, a **trust gate** covers the artifacts umbel wires to
**auto-run** — hooks (fire on tool events) and MCP servers (spawn at launch).
When `add` or `install` pulls executable content that is **new to, or changed
from, the lock**, umbel shows a file-level diff of the affected hook/MCP
directory and asks you to confirm before writing the lock:

- The confirmation unit is the **whole artifact directory's** content hash, not
  the command string — a malicious update can keep `command: ./run.sh`
  byte-identical while rewriting the script body, so the diff drills into the
  changed files.
- **Already-trusted, locked content passes silently.** `run` / `apply` /
  `build` (and `install --frozen`) materialize the committed lock without
  prompting — CI is expected to run against a committed lock.
- **Non-interactive runs fail closed** (exit 5) on new/changed executable
  content; pass `--yes` to trust it without a prompt.
- **Skills and agents are outside the gate.** A `SKILL.md` can itself instruct
  the agent to run a script, so there is no safe subset to carve out —
  skill/agent execution is mediated by the harness's own permission system, not
  umbel's. This is a deliberate scope line (see
  [ADR-0014](docs/adr/0014-artifact-trust-gate.md)), not an oversight.

## PATH shim (recommended)

Install the shim once so plain `claude` resolves through umbel and
discovers the project's bundle automatically. The shim short-circuits to
the real `claude` binary when umbel has already resolved the launch (so
subprocess shellouts to `claude` don't re-prompt):

```bash
umbel shim install                       # writes ~/.local/share/umbel/bin/claude
# then add to ~/.zshrc or ~/.bashrc:
export PATH="$HOME/.local/share/umbel/bin:$PATH"
```

After that, plain `claude` in a project with a single-candidate pin runs
directly under that bundle. A multi-candidate pin opens the scoped picker
so you choose which candidate to use for that launch — every launch, not
just the first. In a project without a pin, the shim shows the full picker
so you can choose a bundle for that session or pick `(vanilla)` to run
plain claude. Non-interactive shells fall back to vanilla automatically
(or to the default candidate, if the pin has one).

To opt out of all umbel routing for one invocation, call claude by its
absolute path, or temporarily `unset PATH`'s shim entry.

## Pin file

`<project>/.umbel-bundle` is plain text, one candidate per line:

```text
discovery        # primary: the bundle I use most here
delivery         # also relevant on this repo
# __vanilla__    # parked: uncomment to offer plain claude too
```

- **One candidate** → resolves directly and launches (backward-compatible with existing single-line pins).
- **Many candidates** → scoped picker over just those candidates; the first is the default.
- **`__vanilla__` line** → offers "plain claude" as an explicit candidate in the scoped picker.
- **Absent / all-commented** → full picker on TTY, vanilla on non-TTY.

**File grammar:** lines are trimmed; blank lines and full-line `# …` comments are
skipped; inline trailing `name # …` comments are stripped (bundle names cannot
contain `#`). Duplicates are deduped (first occurrence wins).

**Default candidate:** the first listed candidate is pre-selected in the scoped
picker and resolved automatically in non-interactive shells.

**Visible behaviour shift:** a project with a multi-candidate pin opens an
(ephemeral) scoped picker on every launch instead of resolving directly. The
scoped picker never rewrites the pin — it resolves only the current launch.

**Hand-authored:** multi-candidate pins are written by hand. `umbel apply`
stays single-candidate and refuses (exit 2, hint to run `umbel unpin` first) to
overwrite an existing multi-candidate pin.

`umbel apply <name>` writes a single-candidate bundle pin. It also builds the
bundle as a side effect — warming the cache and updating the `by-name/<name>`
symlink, and printing a `built <path>` line — so a subsequent plain `umbel run`
launches without a rebuild. `umbel apply --vanilla`
writes the `__vanilla__` sentinel. `umbel unpin` removes the file. Commit it to
share a default with your team, or `.gitignore` it for per-developer setup.

See [`docs/adr/0007-multi-candidate-pins.md`](docs/adr/0007-multi-candidate-pins.md)
and [`CONTEXT.md`](CONTEXT.md) for rationale and terminology.

## Bundle resolution order for `run`

1. Explicit `<name>` arg
2. `UMBEL_BUNDLE` env var (set to `__vanilla__` to force vanilla)
3. `<project>/.umbel-bundle` pin file:
   - one candidate → run that bundle directly
   - `__vanilla__` sentinel → run plain claude
   - multiple candidates → scoped picker on TTY; default candidate on non-TTY
4. No pin (or all candidates commented out) → on TTY: full picker with `(vanilla)` row; on non-TTY: silent vanilla.

Arg and env bypass the picker entirely and are not constrained to the pin's candidate list.

## Env vars

| Var                   | Effect                                                                  |
|-----------------------|-------------------------------------------------------------------------|
| `UMBEL_ARTIFACTS_DIR` | Override artifact root (default: `$XDG_CONFIG_HOME/umbel`).             |
| `UMBEL_DATA_DIR`      | Override generated-data root, home of the PATH shim (default: `$XDG_DATA_HOME/umbel`). |
| `UMBEL_CACHE_DIR`     | Override compiled-bundle cache root (default: `$XDG_CACHE_HOME/umbel`). |
| `UMBEL_BUNDLE`        | Used by `run` resolution (arg > env > pin). `__vanilla__` forces vanilla. |
| `UMBEL_RESOLVED`      | Set by `umbel run` when spawning claude. The shim short-circuits to vanilla when present, so subprocess shellouts to `claude` don't re-prompt. |
| `UMBEL_GITHUB_BASE`   | Override the `github:` coordinate host (default: `https://github.com`). |

## Exit codes

| Code | Meaning                                                         |
|------|-----------------------------------------------------------------|
| 0    | Success (or dry-run completed)                                  |
| 1    | Runtime failure (e.g. `claude` not found on PATH)               |
| 2    | Usage error (bad flag, validation error, picker on non-TTY)     |
| 3    | Bundle / dependency / parent not found                          |
| 4    | Conflict (shim install without `--force`; `fork` dest exists)   |
| 5    | Trust gate: executable (hook/MCP) content not confirmed         |

## Troubleshooting

**`bundle '<name>': artifact ref(s) missing source qualifier; use '<source>/<leaf>'`**

The bundle lists a bare ref like `tdd`. Bundles only accept fully-qualified
refs (`local/tdd`, `superpowers/tdd`, …). If you have a legacy flat layout
under `~/.config/umbel/skills/<leaf>/`, move it under a source namespace:

```bash
cd ~/.config/umbel/skills
mkdir -p local
# Move every existing leaf into the `local/` namespace
for d in */; do
  [ "$d" = "local/" ] && continue
  mv "$d" local/
done
```

Then reference each skill as `local/<leaf>` in your bundles.

**`bundle '<name>': source(s) not found: skills/<source>/<leaf>`**

The ref looks right, but the directory does not exist. Check:

- The path resolves under `$UMBEL_ARTIFACTS_DIR` (default
  `$XDG_CONFIG_HOME/umbel`, typically `~/.config/umbel`) —
  `echo ${UMBEL_ARTIFACTS_DIR:-$HOME/.config/umbel}`.
- The leaf directory contains the expected manifest file (`SKILL.md`,
  `AGENT.md`, `HOOK.md`, or `MCP.md`).
- If you symlinked from an upstream repo, the link target is still readable.

**`bundle '<name>' not found`**

The CLI cannot find a manifest named `<name>.md` in either scope. Run
`umbel list` to see the scope-grouped table of bundles umbel can see —
user-scope (`~/.config/umbel/bundles/`) and project-scope
(`<project>/.claude/bundles/`). The same listing also shows the resolved
pin (`.umbel-bundle`) and the `UMBEL_BUNDLE` env override, so it doubles
as a quick "what would `umbel run` pick?" check.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Solo passive maintenance — PRs and
issues welcome, response is best-effort.

## License

MIT — see [LICENSE](LICENSE).
