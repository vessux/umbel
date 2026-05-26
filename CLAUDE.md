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
