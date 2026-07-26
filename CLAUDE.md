# Contributor context

TypeScript / Node CLI (ESM, `>=18.17`). Unix only.

## Layout

- `src/` — CLI (run.ts → args/dispatch → bundle/* or skills picker).
- `test/unit/` — vitest unit tests; mirrors `src/` shape.
- `docs/bundles-spec.md` — the bundle design (read this for non-trivial changes).

## Toolchain

- Build: `tsup` → `dist/cli.js` (the `umbel` bin).
- Tests: `vitest`. Run all with `npm test`; single file with `npx vitest run <path>`.
- Style: `biome check .` for lint, `biome format --write .` for fix.
- Types: `tsc --noEmit`.

## Conventions

- Imports use `.ts` extensions (ESM + tsup-compatible).
- No comments unless the *why* is non-obvious.
- Prefer editing existing files over adding new ones.
- Errors flow through `CliError` / `UsageError` / `NotFoundError`; exit codes in `src/run.ts` and the README "Exit codes" table.

## Agent workflow

Use **Clerk** (`clerk`) as the workflow facade for this repo.

- Capture raw work with `clerk capture`.
- Inspect/refine work with `clerk inbox ...`.
- Pick up and deliver ready work with `clerk backlog ...`.
- Run `clerk doctor` when setup or the next workflow step is unclear.

Runtime instructions should speak Clerk verbs only. Operator-only docs under `docs/agents/`
may describe lower-level storage details for maintenance.

## Agent skills

### Issue tracker

Work is tracked through Clerk, backed by this repo's `.clerk` configuration. Use `clerk capture`,
`clerk inbox ...`, and `clerk backlog ...`. See `docs/agents/issue-tracker.md`.

### Triage labels

The canonical triage roles map to Clerk inbox/backlog dispositions, not tracker labels. See
`docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
