# Atlas Core — System Overview (v6.0)

## What it is

**Atlas Core is a personal investment operating system** — a single-user web app that runs
one long-horizon portfolio toward a **2045 retirement target**. It is not a brokerage and it
does not place trades. It is a **governance and decision engine**: it holds the rules, watches
the portfolio against them, and at every screen ends in **one clear instruction — what to do,
why, and when.** The human executes manually.

The guiding philosophy: **discipline beats tinkering.** The system exists to keep its owner
invested and rule-bound through volatility, and to make the right action so obvious that
emotion never gets a vote.

---

## How it works (architecture)

| Layer | Technology |
|-------|-----------|
| Framework | **Next.js (App Router)** — React Server Components, server actions |
| Data | **Prisma ORM** over **SQLite** (`prisma/atlas.db`) |
| Auth | Session-based (`lib/session.ts`); every page redirects to `/login` if unauthenticated |
| Market data | Live pulls from Yahoo Finance (FX, prices) + an **IBKR Flex** import path (`lib/ibkr-flex.ts`) |
| Deploy | **Vercel**, auto-deploying on push to `main`; build runs `prisma generate && next build` |

### Data model (Prisma)

- **User** — contribution settings (monthly $3,000, annual lump $20,000, 5% growth, risk-free rate), role.
- **Holding** — a position: ticker, name, `targetPct`, `hardCapPct`, `toleranceBand`, colour.
- **Snapshot** — a point-in-time valuation of a holding (units, price, value, currency). The portfolio's history is the chain of snapshots.
- **Trade / ContributionRecord / Dividend** — actual executed activity, including **DRIP** (dividend reinvestment) tracking.
- **GovernanceRule** — the 34 enforced rules (title, description, category, active flag).
- **EtfLookThrough** — cached company/sector/geo weights per ETF, refreshed from the UI, powering §4 concentration.
- **BehaviourLog / WatchlistItem / PasswordResetToken** — discipline journal, watchlist, auth.

### The engines (`lib/`)

- **`next-best-move.ts`** — the brain. Two exports:
  - `computeNextBestMove()` walks the **7-level precedence ladder** and returns the single highest-priority action in plain English (`action / what / why / when`).
  - `computeMarketAwareDca()` produces the **market-aware monthly contribution split** — skipping 52-week highs, deploying into confirmed dips in three tranches, never feeding exit candidates.
  - Carries `MARKET_STATE`, the fact-checked market overlay (SGOV yield, Iran, tariffs, Fed, per-position price/vol/52w levels).
- **`action-plan.ts`** *(v6.0, new)* — the **single source of truth** for the ordered, time-staged action sequence (the 10 steps), shared by the dashboard and the Command Centre so they never drift.
- **`health.ts`** — the 4-dimension portfolio health score (below).
- **`constants.ts`** — hard drift thresholds and Command-Centre rule constants.

---

## How a user actually uses it (the monthly loop)

1. **Update the portfolio** — on the Portfolio page, enter units + price per holding (manual, screenshot from IBKR, or live refresh). Do it monthly, ideally after contributing. This creates a new snapshot.
2. **Read the dashboard** — alerts surface at the top; the **Next Best Move** card states the single most important action.
3. **Follow the plan** — *What To Do This Month* gives the exact dollar split of the $3,000; *Your Action Plan — Step by Step* gives the full staged sequence (what to do now, this week, and on each future trigger).
4. **Check health** — keep the score above 80.
5. **Review reports** — confirm no company/sector look-through cap is breached before contributing.
6. **Never sell on emotion** — the Behaviour page holds the red-flag checklist and cooling-off rules.

---

## The surfaces (pages)

**Decision surfaces** — where the system tells you what to do:

- **Dashboard (`/`)** — the operating picture. Next Best Move hero → KPI strip (value, active rules, drift alerts, goal-track) → Your Holdings → **What To Do This Month** (market-aware DCA split) → **Your Action Plan — Step by Step** → health gauge, value history, 2045 forecast, allocation donut.
- **Command Centre (`/command-centre`)** — the deep view. Same Next Best Move, then four tabs: **What to Do** (live scanner with BUY/HOLD/EXIT signals + entry zones), **Risks Ahead** (5 ranked risk scenarios with probability, portfolio impact, and what-to-do), **When to Act** (the action calendar — same `action-plan.ts` source as the dashboard), and **The Rules** (10 plain-English governance principles).
- **Governance (`/governance`)** — the constitution made visible: live position gauges vs healthy/soft/hard bands, the allocation threshold table, the §5.4 Monthly Decision Engine, and the full 34-rule register by category.

**Supporting surfaces:** Portfolio, Holdings, Reports (look-through), Forecast (compounding to 2045), Behaviour, Rebalance, Risk, YTD, History, Trades, Contributions, Dividends, Watchlist, Settings, Export (annual PDF), Admin.

---

## How it's governed (in brief)

The full constitution is in **`docs/GOVERNANCE-v6.0.md`**. In one screen:

- **Five core holdings**, each with a fixed target and an identity: VT 52% (anchor), QQQM 23% (growth), SMH 10% (AI tilt), VWO 8% (EM), BTC 7% (optionality) — plus **SGOV 8–10%** being added in v6.0 as the shock buffer.
- **Three kinds of limit:**
  - **Position Caps (§2)** — absolute ceilings that force a trim (e.g. SMH capped at **12%**, tightened from 15% in v6.0).
  - **Drift bands (§3)** — soft/hard zones that route *new contributions* rather than forcing sales.
  - **Look-Through Concentration (§4)** — the highest law: effective exposure to companies (Nvidia, Microsoft, Apple…) and sectors (semiconductor, US, AI cluster) across all ETFs combined.
- **Precedence is absolute:** **§4 concentration → §3 drift → §5 contributions → everything else.** Concentration overrides conviction; hard always overrides soft.
- **The monthly decision** runs as an 8-step checklist (the §5.4 engine), executable in under five minutes, with the v6.0 market-aware overlay layered on top (skip the highs, tranche into dips, never feed an exit).
- **Behavioural guards** make emotional action structurally hard: a market-timing ban, a 48-hour cooling-off before any drawdown sell, a 90-day redesign moratorium, and a tiered Crash Protocol (>40% drawdown → don't even open the app more than monthly, never sell).
- **Compliance:** manual execution only, inside approved dealing windows; every trade logged; emergency reserves kept outside the portfolio; no withdrawals before 2045.

### The Health Score (`lib/health.ts`)

A 0–100 composite of four independent dimensions. **Governed concentration within caps is
*not* penalised** — only unmanaged breaches are.

| Dimension | Weight | Measures |
|-----------|:------:|----------|
| **Structural** | 40% | Allocation drift and tolerance breaches |
| **Behavioural** | 25% | Share of governance rules left active |
| **Concentration** | 25% | Only *hard-cap* company/sector breaches |
| **Execution** | 10% | Data freshness (how recently you snapshotted) |

Overall: **≥80 "Good standing" · ≥65 "Review recommended" · else "Action required."**

---

## What v6.0 changed

- **Market-aware DCA** — contributions adapt to conditions instead of routing purely on drift.
- **Always-on Next Best Move** — every screen resolves to one unambiguous action.
- **SMH concentration cap tightened** 15% → **12%**.
- **A shock buffer (SGOV)** introduced as a first-class defensive position; the engine recommends funding it by exiting BTC.
- **Fact-checked market data** — SGOV yield corrected to ~3.85%, Iran reframed as two-sided risk, tariff/Fed states verified.
- **Shared `action-plan.ts`** — the dashboard's new step-by-step Action Plan and the Command Centre's "When to Act" calendar now read from one source of truth.

---

*Authoritative sources: `lib/next-best-move.ts`, `lib/action-plan.ts`, `lib/health.ts`,
`lib/constants.ts`, `app/governance/page.tsx`, `prisma/schema.prisma`, `prisma/seed.ts`.*
