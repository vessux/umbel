# umbel

umbel composes per-project sets of skills/agents/config into a **bundle** and routes a harness invocation (today, plain `claude`) through the bundle that a project has selected.

## Language

### Bundles & running

**Bundle**:
A named, composable set of **artifacts** (skills/agents/hooks/mcps) plus `settings`, defined by a `bundle.md` manifest in two layers — the **dependencies** it draws from and the **composition** of artifacts it activates. A **harness** runs under it (today, only Claude Code).
_Avoid_: package, profile, preset, plugin.

**Vanilla**:
Running a harness with no bundle applied (today, plain `claude`).
_Avoid_: bare, default, none.

### Dependencies & acquisition

**Artifact**:
A single skill, agent, hook, or MCP server — the composable unit a bundle activates. The canonical unit term (see ADR-0002).
_Avoid_: atom, item, primitive.

**Dependency**:
A versioned upstream a bundle draws artifacts from — a git repo, a subdirectory of one, a local checkout, or the built-in `local`. Declared in a bundle's `deps:` map as an operator-chosen **alias** bound to a **coordinate**. umbel is, at bottom, a dependency-manager for capabilities.
_Avoid_: source (retired), package, plugin.

**Coordinate**:
A dependency's address: `github:org/repo@ref#subpath`, `git:url@ref`, `link:path` (a local directory — the only form that expands `${…}` variables), or `local`.

**Alias**:
The operator-chosen short name a bundle binds a coordinate to; the `<alias>` half of a composition ref (`<alias>/<leaf>`). **Bundle-private** — never inherited across `extends`.

**Lock**:
A bundle's sibling `<name>.lock`, pinning each dependency to a resolved commit + content hash. Distinct from a **Pin** (see below).
_Avoid_: pin.

**Store**:
The on-disk set of fetched dependency checkouts (`$XDG_DATA_HOME/umbel/store`), kept as-is and indexed in place. Data-grade (persistent) — git upstreams are not a guaranteed-refetchable registry.

**Pack**:
Producing a self-contained directory from a bundle (artifacts copied in) that runs as a plugin without umbel *and* re-imports into umbel — the outbound plugin boundary I/O.
_Avoid_: vendor, export, build.

### Composition

**Extends**:
A bundle inheriting another's **composition** — the child specializes the parent. Each bundle resolves its own artifacts (through its own **lock**) first; the resolved sets then merge, child overriding on **artifact identity** (ADR-0013; ADR-0016).
_Avoid_: inherits, includes, imports.

**Artifact identity**:
What makes two resolved artifacts *the same* for `extends` override: a shared **kind** and **provenance** — the upstream **coordinate** (sans commit) plus subpath/leaf — independent of **alias** or pinned commit. A child re-declaring the same artifact overrides the parent (the child's commit wins); artifacts that merely share a **canonical name** are distinct and coexist.
_Avoid_: canonical identity (ambiguous — see Flagged ambiguities).

**Canonical name**:
An artifact's harness-visible name — its frontmatter `name`, else its leaf dir. Two *distinct* artifacts sharing a canonical name **collide**; umbel keeps both, disambiguating each as `<alias>-<name>`. A display-level concern resolved at compile — never an override key.
_Avoid_: canonical identity.

### Harnesses

**Harness**:
The coding-agent CLI a bundle is compiled for and run under. Claude Code is the only shipped harness; OpenCode, Pi, and GitHub Copilot CLI are in design.
_Avoid_: backend, runtime, engine, target.

**Adapter**:
The per-harness component that maps a bundle to one harness's native form, declaring which of the bundle's capabilities that harness supports, degrades, or cannot express.
_Avoid_: driver, plugin, backend.

**Capability**:
One of the five artifact kinds — skills, agents, hooks, mcps, settings — seen as a harness-agnostic axis. A bundle declares capabilities by naming artifacts; each adapter maps a capability to its harness's native form, degrades it (**best-effort**), or marks it **unsupported**. There is no abstract layer above the kinds.
_Avoid_: feature, primitive.

**Non-mutation**:
The absolute promise that umbel never writes a bundle into the project tree or the real global config — it always injects via a relocated/external config. Holds on every harness, independent of suppression grade.

**Suppression grade**:
How completely a harness can be made to *ignore* its own ambient project/global config so only the bundle is active — distinct from non-mutation. Three values: **strict** (ambient fully shadowed — Claude Code), **scoped** (composable to strict via extra flags, at a cost — GitHub Copilot CLI), **best-effort** (injected config merges over ambient; cannot be suppressed — OpenCode, Pi). Each adapter declares its grade; the support matrix surfaces it honestly.
_Avoid_: isolation (too absolute — it conflates non-mutation with suppression).

### Pinning

**Pin**:
A project's record of which bundle(s) apply in that project. An ordered list of one or more **candidates**; an empty/absent pin means "no choice recorded".
_Avoid_: lock, config, default-bundle.

**Candidate**:
A bundle named by the pin. A pin with one candidate resolves to it outright; a pin with multiple candidates is resolved by the user at launch.
_Avoid_: option, entry, choice.

**Default candidate**:
The first candidate listed in the pin. It is pre-selected in the scoped picker and resolved automatically when no human can choose (non-interactive shells). Candidate order is therefore meaningful.

**Scoped picker**:
The launch-time picker restricted to a pin's candidates.

**Full picker**:
The launch-time picker over every discovered bundle, shown when no pin records a choice.

## Relationships

- A **Pin** lists one or more **Candidates** (each a **Bundle**, or **Vanilla** as an explicit candidate); the first is the **default candidate**.
- One candidate → resolved directly. Multiple candidates → resolved via the **scoped picker**, or to the **default candidate** when non-interactive.
- No pin (or all candidates commented out) → the **full picker** (or vanilla on a non-interactive shell).

## Flagged ambiguities

- "pin" was used to mean both *the resolved bundle* and *a shortlist to choose from* — resolved: a pin is an ordered list of **candidates**; resolution to a single bundle happens directly (one candidate) or via the **scoped picker** (multiple).
- "pin" vs "lock" — resolved: a **Pin** (`.umbel-bundle`) records *which bundle applies to a project*; a **Lock** (`<name>.lock`) records *which upstream versions a bundle resolves to*. Different concepts, different files.
- "source" — the ADR-0002 sense (an arbitrary operator-chosen `<source>/<leaf>` attribution label) is **retired** by ADR-0013: a bundle now declares **dependencies** (an alias bound to a coordinate) via `deps:`. The naming freedom moves to the alias; the coordinate + lock add provenance and reproducibility.
- "canonical" / "canonical artifact identity" — ADR-0013 said `extends` merges "child winning on canonical artifact identity", but **canonical name** (`collision.ts`) already meant the display name, which *coexists* (prefixed) rather than overrides. Resolved by ADR-0016: `extends` override keys on **artifact identity** (kind + provenance); **canonical name** stays a display-level collision concern. Artifacts that differ in provenance but share a name never silently drop across `extends` — they coexist and are prefixed, uniformly with same-bundle collisions.
- "version" was read as an authored semantic release — resolved: a bundle's identity is a content **hash**, surfaced bare (`hash: <12-hex>`) in the harness-agnostic `bundle.md`. "Version" is only the Claude-Code-plugin-format string `0.0.0+<hash>` derived from that hash — it lives in `plugin.json` and is exported as `UMBEL_BUNDLE_VERSION`. Same identity, two representations; the `0.0.0+` shape is a CC plugin-schema artifact, not umbel data, so it stays out of `bundle.md`.
