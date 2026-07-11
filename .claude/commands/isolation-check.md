Check that Atlas Core and Silicon Brick Road (SBR) remain completely isolated. No Atlas Core tickers, thresholds, or logic should appear in SBR code paths, and vice versa.

## What to verify

### 1. Constitution routing guards — every page that contains Atlas Core-specific content must redirect SBR users

Check that these pages call `constitutionIdForEmail(session.email) === "silicon-brick-road"` and redirect to "/" if true:
- app/forecast/page.tsx
- app/reports/page.tsx
- app/calendar/page.tsx
- app/command-centre/page.tsx
- app/rebalance/page.tsx (or has isSbr branching)

And that the governance page routes SBR users to SbrConstitution, NOT the Atlas Core engine.

### 2. Atlas Core tickers must never appear in SBR data paths

SBR_FUND_TICKERS should be exactly: ["VWRA", "EQQQ", "SEMI", "A35"]
Atlas Core tickers (VT, VWO, BTC, IBIT, SGOV) must not appear in:
- components/sbr/*.tsx
- lib/sbr-engine.ts
- lib/sbr-market.ts (if it exists)

### 3. SBR tickers must not contaminate Atlas Core paths

SBR tickers (VWRA, A35) must not appear in:
- lib/constants.ts (HARD_THRESHOLDS, GOVERNANCE_BAND_ROWS, etc.)
- lib/next-best-move.ts
- lib/health.ts
- lib/look-through.ts (if it exists)
- app/page.tsx (the Atlas Core dashboard)

### 4. ensureCoreHoldings guard

Read lib/holdings-sync.ts — the ensureCoreHoldings function must check `constitutionIdForEmail(user.email) !== "atlas-core"` before proceeding, so it never creates Atlas Core tickers for SBR users.

### 5. Admin user creation

Read app/admin/users/actions.ts — new user creation must determine constitution from the new user's email, not copy from admin. SBR users must get SBR tickers; Atlas Core users must get Atlas Core tickers.

### 6. Behaviour page branching

Read app/behaviour/page.tsx — verify `isSbr` is derived from `constitutionIdForEmail(session.email)` and used to show different prohibited actions and section headings for SBR vs Atlas Core.

## How to check

For each item above, read the relevant file and confirm the guard/branching is present. Use Grep to search for cross-contamination (e.g., grep "VWRA" in lib/constants.ts, grep "VT" in lib/sbr-engine.ts).

## Output format

For each check, report:
- **PASS** — guard is present and correct
- **FAIL** — missing or incorrect (show the file and line)
- **WARNING** — something looks suspicious but might be intentional

End with a verdict: "Portfolios are fully isolated" or list what needs fixing.
