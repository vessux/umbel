# umbel

umbel composes per-project sets of Claude Code skills/agents into a **bundle** and routes plain `claude` invocations through the bundle that a project has selected.

## Language

### Bundles & running

**Bundle**:
A named, composable set of skills/agents/config that Claude Code runs under.
_Avoid_: package, profile, preset.

**Vanilla**:
Running plain `claude` with no bundle applied.
_Avoid_: bare, default, none.

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
