# test-factory

Monorepo used to validate the software factory on one project: the `school` app-module. Plan: `.claude/plans/2026-11-14_factory-architecture.md`.

## Branches

| Branch | Role |
|---|---|
| `main` | production |
| `integration` | pre-production; promotion to `main` is manual |
| `<ticketId>-<desc>` | one per task |

## Dev server

```sh
npm install
app-core-cli dev ./packages/app-module-school --watch
```

Checks: `npm run check`, `npm run build`, `npm test`.
