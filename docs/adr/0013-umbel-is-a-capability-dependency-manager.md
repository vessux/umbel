---
status: accepted
date: 2026-07-04
---

# umbel is a dependency-manager for capabilities; the plugin is boundary I/O, not umbel's format

umbel's value is **composing portable artifacts (skills, agents, hooks, MCP servers) into a
per-session, non-mutating capability set** on a harness. This ADR settles what umbel *is*
relative to the coding-agent plugin ecosystem, and reshapes bundle acquisition, storage, and
sharing around that answer. It amends [ADR-0002](0002-bundle-artifact-model.md)
(hand-populated artifact roots → fetched **dependencies** + a persistent store) and
[ADR-0003](0003-xdg-path-layout.md) (a store path under data), and retires the v0 skills
installer.

> Refined by [ADR-0014](0014-artifact-trust-gate.md) (the trust gate for fetched executable
> artifacts) and [ADR-0015](0015-bundle-authoring-model.md) (the authoring UX). Those two
> facets were split out to keep this the north-star record.

## Grounding

A survey of the plugin/packaging model across Claude Code, OpenCode, Pi, GitHub Copilot CLI,
Cursor, Codex CLI, and Gemini CLI (2026-07) found:

- The **plugin** is the *fragmented* layer: every vendor ships its own
  `.<vendor>-plugin/plugin.json` directory — convergent on Claude Code's *schema*, divergent
  on *location* and install semantics. Conversion CLIs that translate one plugin into 12+
  native formats are thriving — the tell that the formats do not interoperate.
- Every one of those plugin systems installs **persistently, mutating global config** —
  except Claude Code's ephemeral `--plugin-dir` and Pi's `-e`.
- The **artifact** is what actually converges: `SKILL.md` (Agent Skills) is read by nearly
  all of them; MCP is a Linux-Foundation-governed protocol with near-universal support.
- **Ephemeral, non-mutating, cross-harness composition is an unoccupied axis.** The nearest
  competitor (`rulesync`) emits native config into your tree — i.e. it *mutates*.

Betting on "a plugin format" is betting on the least-settled, most-crowded layer. umbel's
durable position is the **composition + ephemeral-activation layer above the converging
artifacts.** (Grounding spike captured in beads `umbel-3hj`.)

## Decision

**Posture.** umbel is a **dependency-manager for capabilities**: it fetches versioned
upstream **dependencies**, composes selected **artifacts** from them into a **bundle**, and
activates the bundle per-session through the existing content-addressed compile + `--plugin-dir`
path — never mutating `~/.claude` or the project. Plugins and marketplaces are **boundary
I/O**: an inbound dependency to index, and an outbound `pack` target. umbel does not define,
and does not become, a plugin format.

### Bundle: two layers + a per-bundle lock

`bundle.md` gains a dependency layer:

- `deps:` — an operator-chosen **alias** bound to a **coordinate**. These are the bundle's
  dependencies.
- Composition lists (`skills:`/`agents:`/`hooks:`/`mcps:`) reference `<alias>/<leaf>` — which
  artifacts are active — unchanged in shape.
- `settings` and `extends` as before.

Each bundle has a **sibling lock** (`discovery.md` → `discovery.lock`) pinning every
dependency to a resolved commit + content hash. The lock is committed/shared *with* its
bundle — so a thin-share ships exactly one bundle's manifest + lock, never a global file that
leaks other bundles. Writing a lock beside a project-scope bundle is a project-tree write,
carved out of non-mutation the same way the `.umbel-bundle` pin already is.

### Dependencies, coordinates, aliases

A **coordinate** is `github:org/repo@ref#subpath`, `git:url@ref`, `link:path` (a local
directory), or the built-in `local` (≙ `link:${UMBEL_HOME}/local`, hand-authored artifacts).
Variable expansion (`${UMBEL_HOME}`, `${HOME}`, …) is permitted **only in `link:` paths** —
never in a git coordinate, which must resolve identically on every machine. `${UMBEL_HOME}` is
the config root (the env var formerly `UMBEL_ARTIFACTS_DIR`).

**Aliases are bundle-private and never inherited.** There is therefore no cross-bundle alias
collision to adjudicate. The consequence for `extends`: it can no longer merge raw
`<alias>/<leaf>` ref lists (a child does not know its parent's aliases). Instead each bundle
in the MRO **resolves its own deps → concrete artifacts first**, and `extends` merges the
*resolved artifact sets*, child winning on canonical artifact identity. Because each bundle
resolves through *its own* lock, two bundles pinning the same upstream at different commits is
not a conflict — it is resolved independently and merged at the artifact level.

### Versioning: version-follows-transport, the lock is truth

A git **branch** ref *tracks* (the lock advances on `update`); a **tag/commit** *pins*. The
lock always records the resolved commit **and** a content hash of the resolved artifact bytes
at that commit + `#subpath` (the exact tree umbel indexes and compiles from). That content
hash is what catches a force-push, a rewritten tag, or a moved ref, and — for store-resolved
artifacts — it is the input the compile hash keys on (not source mtimes), so the same lock
yields the same bundle on every machine. `link:`/`local` dependencies are **not
reproducible**: they carry at most an advisory content-hash for drift-warning, never a
guarantee.

### Verbs

- `try <url>` — fetch + compose **everything** + launch **ephemerally** (no pin, manifest, or
  lock). `try` runs untrusted third-party code by design — see [ADR-0014](0014-artifact-trust-gate.md).
- `adopt <url> [name]` — **create** a new bundle mirroring one source (all its artifacts).
- `add <coord>` — add a dependency to the current bundle, resolve, lock, fetch (running the
  trust gate on new executable content), pick artifacts. `add <alias>/<leaf>` activates a
  single already-fetched artifact.
- `remove <alias>` / `remove <alias>/<leaf>` — drop a dependency / an artifact.
- `edit <name>`, `fork <name>` — authoring; see [ADR-0015](0015-bundle-authoring-model.md).
- `pack <name>` — produce a self-contained plugin dir (below).
- `install` — **reconcile** the manifest against the lock, then materialize: resolve+lock+fetch
  any dep new to the lock, keep unchanged pins, drop lock entries no longer in the manifest.
  This is `npm install` — it never bumps an existing pin and never mints a bundle.
  `install --frozen` is the strict form (`npm ci`): error on manifest/lock drift, fetch exactly
  the locked commits, write nothing. Thin-share recipients and CI use `--frozen`.
- `update [alias]` — the *only* verb that moves pins: re-resolve declared refs, run the trust
  gate on changes, rewrite the lock.
- `outdated` — report available bumps; read-only.
- `run` / `apply` — unchanged launch/pin semantics ([ADR-0007](0007-multi-candidate-pins.md));
  they auto-materialize (a reconcile) before compiling.

`run`/`apply`/`pin` resolution is unchanged. Every **bundle-targeting** verb (`add`, `remove`,
`install`, `update`, `outdated`, `edit`, `fork`, `pack`) resolves its target **uniformly**:
`--bundle`/positional wins; a single-candidate pin → that bundle; a multi-candidate pin →
scoped picker on TTY, error on non-TTY; a vanilla or absent pin → error with a hint (offer
`init` on TTY). When the target is a **user-scope** bundle, umbel prints a one-line heads-up
that edits affect other projects, with a `fork` hint.

### Acquisition and the store

git is the primary transport (a GitHub page *is* a git repo); bare URLs are accepted and the
alias auto-derived. npm and marketplace-manifest resolution are deferred conveniences. One scan
indexes whatever a fetched dependency contains — a single `SKILL.md`, a `skills/` tree, a
`.claude-plugin/`, or a whole framework — honouring `plugin.json` component paths.

The store lives under **data** (`$XDG_DATA_HOME/umbel/store`), *not* cache: git upstreams are
not an immutable registry (force-push, deleted/renamed/private-flipped repos, rewritten tags),
so a pinned commit is **not** reliably refetchable, and `$XDG_CACHE_HOME` is routinely purged.
By ADR-0003's own rule — regenerable ⇒ cache, must-persist ⇒ data — a checkout that cannot be
guaranteed refetchable is data. `pack` is the durability escape hatch for anything that must
survive upstream loss. Store GC is conservative — it evicts only checkouts referenced by **no
discoverable lock** (project-scope locks in unknown repos cannot be enumerated; the promise is
scoped to what umbel can see, stated honestly). The compiled-bundle cache
(`$XDG_CACHE_HOME/umbel/bundles`) keeps its newest-3-per-name GC.

### Sharing

Thin by default — ship `bundle.md` + its lock; the recipient runs `install --frozen`. Fat on
demand — `umbel pack <bundle>` produces a self-contained directory that runs as a CC plugin
*and* re-imports into umbel. `pack` emits the **plugin-native** form (MCP commands rewritten
`${CLAUDE_PLUGIN_ROOT}`-relative for the plugin consumer — the launch cache instead uses the
absolute `--mcp-config` path, see [ADR-0004](0004-claude-code-plugin-path-resolution.md)) and
inlines `link:`/`local` content to be self-contained. "Re-imports into umbel" therefore means
umbel **recompiles** the packed directory (re-deriving its own absolute paths); it does not
launch the packed `.mcp.json` directly — the two consumers need different command forms. Reproducibility
guarantees cover the **git-coordinate subset only**; `install --frozen` hard-errors on an
unresolvable `link:` path (`--allow-missing` to override). The resolution graph is
artifacts-only in v1 (remote bundle-`extends` deferred).

### v0 retired

The `umbel skills` verb and its symlink-installer (`target/`, `state/`, `planner/`,
`applier/`, the skills picker UI) are deleted — they mutate a project's real `.claude/skills/`,
contradicting non-mutation. `source/walk.ts` + `frontmatter.ts` + `collision.ts` are retained
and repurposed as the store-indexer.

## Considered options

- **Bundle-as-plugin (collapse the layers)** — rejected: bets on the most-fragmented layer,
  forces competition with seven vendors' native tooling plus converters, and discards the
  composition + ephemeral-activation moat.
- **Parallel format + edge adapters only** (no acquisition) — rejected: leaves the inbound
  "use what I found on GitHub" pain unsolved, the primary use case.
- **Semver ranges everywhere** — rejected for git: upstream versioning is immature. Refs +
  resolved-commit lock are honest; version-follows-transport keeps the door open for npm's real
  semver later.
- **Inherited aliases across `extends`** — rejected: aliases are bundle-private, so `extends`
  merges *resolved artifacts* instead of raw refs. Removes a whole class of silent-rebind and
  disagreeing-lock hazards.
- **Store in cache** — rejected: git is not an immutable registry, so "regenerable from the
  lock" is false; a purged cache + a vanished upstream = a permanently dead pinned bundle. The
  store is data; `pack` covers durability.
- **Per-verb pin behavior** (batch `install`/`update` over all candidates) — rejected for a
  single uniform picker-everywhere rule; one mental model beats a convenience special-case.
- **A global `umbel.lock`** — rejected: it leaks every bundle's deps into a thin-share and has
  no project-scope story. Per-bundle locks are shareable slices.

## Consequences

- **Amends [ADR-0002](0002-bundle-artifact-model.md):** the four hand-populated artifact roots
  become (a) a `local/` dependency (kind-first, hand-authored, in config) and (b) a fetched,
  content-addressed **store** (data), indexed in place. The `<alias>/<leaf>` ref survives; the
  `<source>` label becomes an alias bound to a coordinate. `compose.ts`'s contract changes from
  "merge ref lists" to "resolve each bundle then merge artifact sets."
- **Amends [ADR-0003](0003-xdg-path-layout.md):** config (`${UMBEL_HOME}`) holds bundles +
  locks + `local/`; data adds `store/` (alongside the shim); cache keeps only compiled bundles.
  `UMBEL_ARTIFACTS_DIR` is renamed `UMBEL_HOME`.
- **Leaves multi-harness ([ADR-0008](0008-graded-harness-isolation.md) /
  [0009](0009-capability-axes-are-the-artifact-kinds.md) /
  [0010](0010-harness-selected-by-invoked-binary.md)) intact:** the store is harness-agnostic;
  acquisition is a front-end to the same compile spine.
- **Compile determinism:** for store-resolved artifacts the compile hash keys on the lock's
  commit/content hash, not source mtimes (which would churn `UMBEL_BUNDLE_VERSION` machine to
  machine); mtimes stay only for `local`/`link:` deps. So "same lock → same bundle" holds.
- **New surface, narrow:** an acquisition layer (git fetch → store), lockfile read/write, and
  `pack`. The trust gate ([ADR-0014](0014-artifact-trust-gate.md)) and the comment-preserving
  manifest writer ([ADR-0015](0015-bundle-authoring-model.md)) are the other new modules. The
  compile/cache/exec/pin spine is reused unchanged; `resolve.ts` evolves (alias → store/link),
  `discover.ts` gains mirror bundles, `manifest.ts` parses `deps:`.
- **Migration:** the current pool at `$XDG_CONFIG_HOME/umbel/{skills,agents,hooks,mcps}/<source>/<leaf>/`
  is preserved by minting **one `link:` dependency per legacy `<source>` dir** (aliased to the
  old source name), so every existing `bundle.md` ref resolves byte-for-byte; truly
  hand-authored sources fold into `local` opt-in.
- **CLI surface:** adds `try`, `adopt`, `add`, `remove`, `install` (+`--frozen`), `update`,
  `outdated`, `edit`, `fork`, `pack`; removes `umbel skills`.
- **v1 slice is deliberately unspecified here** and will be scoped at epic-planning time; the
  full surface is ~3× today's and must land incrementally, not as one PR.
- **Competitor noted:** `rulesync` occupies the adjacent "unified source → emit many" niche but
  mutates the tree; umbel's non-mutation is the differentiator.
