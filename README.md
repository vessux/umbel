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
[`docs/bundles-spec.md`](docs/bundles-spec.md) for the full schema.

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
umbel apply [name] [--vanilla]          # pin <project>/.umbel-bundle (--vanilla = pin "no bundle")
umbel unpin                             # remove the pin
umbel run [name] [-- ...claude args]    # launch claude (bundle if name/pin, vanilla otherwise)
umbel init                              # multi-step authoring wizard
umbel gc                                # prune cache (keep newest 3 per name)
umbel shim install [--force]            # install ~/.local/share/umbel/bin/claude (the PATH shim)
umbel shim uninstall                    # remove the shim
umbel shim path                         # print the shim's absolute path
umbel skills [options]                  # low-level skill installer (v0 picker)
```

When invoked without `[name]` on a TTY, `run` / `apply` / `show` / `build`
open a single-select picker. For `run` and `apply` the picker prepends a
`(vanilla)` row meaning "no bundle, plain claude." Pinned bundle (or
vanilla pin) is pre-selected.

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

After that, plain `claude` in a project with a `.umbel-bundle` pin runs
under that bundle. In a project without a pin, the shim shows the picker
so you can choose a bundle for that session or pick `(vanilla)` to run
plain claude. Non-interactive shells fall back to vanilla automatically.

To opt out of all umbel routing for one invocation, call claude by its
absolute path, or temporarily `unset PATH`'s shim entry.

## Pin file

`<project>/.umbel-bundle` is plain text, one line:

- a bundle name → run under that bundle;
- `__vanilla__` → run plain claude with no bundle, no picker;
- absent → picker on TTY, vanilla on non-TTY.

`umbel apply <name>` writes a bundle pin. `umbel apply --vanilla` writes
the vanilla pin. `umbel unpin` removes the file. Commit it to share a
default with your team, or `.gitignore` it for per-developer setup.

## Bundle resolution order for `run`

1. Explicit `<name>` arg
2. `UMBEL_BUNDLE` env var (set to `__vanilla__` to force vanilla)
3. `<project>/.umbel-bundle` pin file (name or `__vanilla__`)
4. On TTY → picker with `(vanilla)` row; on non-TTY → silent vanilla.

## Skills picker (low-level, v0)

The original v0 entry point. Symlinks handpicked skills from
`$UMBEL_ARTIFACTS_DIR/skills/` into a project's `.claude/skills/`. Useful for
sandbox image builds and CI idempotency checks. Mostly subsumed by bundles —
keep using it if it fits your workflow.

```bash
# Interactive, from a Claude Code project root
umbel skills

# Deterministic install for a sandbox image build
umbel skills --target ./skills --skills tdd,grill-me,review

# CI-safe idempotency check
umbel skills --target .claude/skills --skills tdd,review --dry-run

# Replace a stray real dir left over from a manual copy
umbel skills --target .claude/skills --skills tdd --force
```

### Picker flags

| Flag                | Meaning                                                |
|---------------------|--------------------------------------------------------|
| `--target <path>`   | Exact parent dir for skill symlinks                    |
| `--source <path>`   | Override source root (default `$UMBEL_ARTIFACTS_DIR/skills`) |
| `--skills <csv>`    | Non-interactive selection; implies no prompts          |
| `--force`           | Back up conflicting real dirs/files and replace        |
| `--dry-run`         | Print plan, exit 0, no writes                          |
| `-h`, `--help`      | Usage                                                  |
| `-v`, `--version`   | Version                                                |

### Picker row states

Rows start checked iff currently installed correctly.

| Icon | Meaning                            | Default-checked | Toggleable              |
|------|------------------------------------|-----------------|-------------------------|
| (none) | Not installed                    | no              | yes                     |
| (none) | Installed (correct symlink)      | yes             | yes (uncheck = remove)  |
| `⚠`  | Symlink → different source         | yes             | yes (leave = relink)    |
| `✖`  | Real dir/file, not a symlink       | no              | no (need `--force`)     |
| `?`  | Malformed SKILL.md                 | no              | yes                     |

## Env vars

| Var                   | Effect                                                                  |
|-----------------------|-------------------------------------------------------------------------|
| `UMBEL_ARTIFACTS_DIR` | Override artifact root (default: `$XDG_CONFIG_HOME/umbel`).             |
| `UMBEL_DATA_DIR`      | Override generated-data root, home of the PATH shim (default: `$XDG_DATA_HOME/umbel`). |
| `UMBEL_CACHE_DIR`     | Override compiled-bundle cache root (default: `$XDG_CACHE_HOME/umbel`). |
| `UMBEL_BUNDLE`        | Used by `run` resolution (arg > env > pin). `__vanilla__` forces vanilla. |
| `UMBEL_RESOLVED`      | Set by `umbel run` when spawning claude. The shim short-circuits to vanilla when present, so subprocess shellouts to `claude` don't re-prompt. |
| `NO_COLOR`            | Disable ANSI color (icons retained).                                    |

## Exit codes

| Code | Meaning                                                         |
|------|-----------------------------------------------------------------|
| 0    | Success (or dry-run completed)                                  |
| 1    | Apply / runtime failure                                         |
| 2    | Usage error (bad flag, validation error, picker on non-TTY)     |
| 3    | Source / bundle / parent not found                              |
| 4    | Conflict without `--force` (skills picker)                      |

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
