# umbel

umbel composes per-project sets of skills/agents/config into a **bundle** and routes a harness invocation (today, plain `claude`) through the bundle that a project has selected.

## Language

### Bundles & running

**Bundle**:
A named, composable set of skills/agents/config that a **harness** runs under (today, only Claude Code).
_Avoid_: package, profile, preset.

**Vanilla**:
Running a harness with no bundle applied (today, plain `claude`).
_Avoid_: bare, default, none.

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
- "version" was read as an authored semantic release — resolved: a bundle's identity is a content **hash**, surfaced bare (`hash: <12-hex>`) in the harness-agnostic `bundle.md`. "Version" is only the Claude-Code-plugin-format string `0.0.0+<hash>` derived from that hash — it lives in `plugin.json` and is exported as `UMBEL_BUNDLE_VERSION`. Same identity, two representations; the `0.0.0+` shape is a CC plugin-schema artifact, not umbel data, so it stays out of `bundle.md`.
