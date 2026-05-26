# Contributing

Thanks for the interest. A few honest notes up front:

- **Solo maintenance, best-effort.** Issues and PRs are reviewed when I have
  time, which may be weeks. No SLA. Drive-by contributions welcome — just
  don't expect immediate turnaround.
- **Breaking changes are possible** while pre-1.0. Pin your version if that
  matters to you.

## Dev setup

```bash
npm install
npm run typecheck
npm test
npm run lint
npm run build
```

Requires Node ≥ 18.17. Unix only (symlinks).

## Tests

`vitest` for unit + integration. Run a single file:

```bash
npx vitest run test/unit/bundle/exec.test.ts
```

## Style

[Biome](https://biomejs.dev) handles lint + format. CI gates on `biome check`.

```bash
npm run format    # auto-fix
npm run lint      # check only
```

## PRs

- Keep changes focused. One concern per PR.
- Add tests for new behavior.
- Update `CHANGELOG.md` under `## Unreleased`.
- Commit messages: short, imperative ("fix X", "add Y").

## Reporting bugs

Open an issue with: repro steps, observed vs expected, Node version, OS.

## Security

See [SECURITY.md](SECURITY.md).
