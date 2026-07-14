# Atlas Core

A personal portfolio-governance app (Next.js + Prisma/libSQL) that runs two constitution-governed portfolios, selected by who logs in:

- **Atlas Core v10.5** (David) — USD retirement portfolio to 2045: VWRA 70 / EQAC 10 / SMH 5 / BTC (IBIT) 5 / DBMFE 10.
- **Silicon Brick Road v10.4** (Dami) — SGD flexible medium-term growth: the same funds plus an A35 bond anchor.

Rule numbers live in one place (`lib/portfolio-spec.ts`); contract checks fail the build the moment the engine, seed, or served constitution drift from it.

## Setup

```bash
npm install
npx prisma generate
npm run dev
```

## Key environment variables

- `DATABASE_URL` (+ `DATABASE_AUTH_TOKEN` for Turso/libSQL)
- `SESSION_SECRET` — session cookie signing
- `CRON_SECRET` — bearer token the cron endpoints require
- `RESEND_API_KEY` (+ `EMAIL_FROM`) — email digests
- IBKR Flex: `IBKR_FLEX_TOKEN`, `IBKR_FLEX_QUERY_ID`, `IBKR_FLEX_QUERY_ID_ACTIVITY` (Atlas) and `IBKR_SBR_FLEX_TOKEN`, `IBKR_SBR_FLEX_QUERY_ID`, `IBKR_SBR_FLEX_QUERY_ID_ACTIVITY` (SBR)
- Optional: `FINNHUB_API_KEY`, `ANTHROPIC_API_KEY`

## Cron schedule (vercel.json / railway.toml)

- `/api/cron/sync-holdings` — `0 22 * * *` (IBKR sync)
- `/api/cron/daily` — `0 23 * * *` (governance digest)
- `/api/cron/monthly` — `0 0 14 * *` (dealing-window reminder)
- `/api/cron/annual` — `0 0 1 1 *` (annual audit reminder)

## Checks & tests

`npm run check` runs the spec/money/ingest/valuation/boundary contract checks plus `tsc --noEmit`; `npm test` runs the vitest suites. Run both before committing. See `MIGRATION.md` for deploy/migration notes.
