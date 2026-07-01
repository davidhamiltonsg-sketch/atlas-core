Audit every numerical threshold in the codebase and verify it matches the Atlas Core Constitution v5.8. Report any mismatches, duplicates, or missing guards.

## What to check

### 1. Position targets and hard caps (Constitution v5.8 — Article VI/VII)

Expected values:
| Ticker | Target | Hard Cap | Healthy Low | Healthy High |
|--------|--------|----------|-------------|--------------|
| VT     | 52%    | 60%      | 46%         | 58%          |
| QQQM   | 23%    | 30%      | 18%         | 28%          |
| SMH    | 10%    | 12%      | 7%          | 12%          |
| VWO    | 8%     | 13%      | 5%          | 11%          |
| BTC    | 7%     | 8%       | 6%          | 8%           |

Hard breach triggers (HARD_THRESHOLDS in lib/constants.ts):
- VT: below 42% or above 62%
- QQQM: below 15% or above 31%
- SMH: below 5% or above 12% (note: hardHigh = 12 not 15 in SMH case — check)
- VWO: below 3% or above 13%
- BTC: above 8% only (no lower hard trigger)

### 2. Combined tech ceiling (Article XII)
- COMBINED_TECH_RULE in lib/constants.ts: softCeiling=38, hardCeiling=42
- Must appear on both dashboard (app/page.tsx) and portfolio (app/portfolio/page.tsx)

### 3. BTC cycle modifiers (Article X)
- BTC_CYCLE_MODIFIERS: bull=10%, normal=8%, bear=6%
- Check lib/constants.ts

### 4. SMH 52-week high skip (Article XI)
- skipAtHighPct = 5% (within 5% of 52-week high → skip SMH buys)
- Check lib/constants.ts SMH_SOFT_BANDS / getSmhCyclePhase

### 5. Company exposure caps (Article IX)
- Nvidia/Microsoft: soft 10%, hard 13%
- Apple: soft 8%, hard 11%
- Amazon: soft 7%, hard 9%
- Meta/Alphabet: soft 6%, hard 8%
- Broadcom/TSMC: soft 5%, hard 7%

### 6. Sector/cluster caps (Article section 4.2)
- Semiconductor & Compute: soft 28%, hard 35%
- Digital Economy: soft 55%, hard 65%
- US Equity Dependency: soft 70%, hard 80%
- AI Infrastructure: soft 20%, hard 28%

### 7. Health score weights (Appendix A)
- Structural: 40%, Behavioural: 25%, Concentration: 25%, Execution: 10%
- Check lib/health.ts

### 8. Monthly contribution constants
- MONTHLY_CONTRIBUTION = 3000 (SGD)
- ANNUAL_LUMP_SUM = 20000 (SGD)
- Check app/forecast/page.tsx

## How to audit

1. Read lib/constants.ts in full — extract every numerical constant
2. Read lib/health.ts — check score weights
3. Read app/page.tsx lines around HARD_THRESHOLDS and combined tech ceiling usage
4. Read app/portfolio/page.tsx — check same thresholds appear consistently
5. Read app/forecast/page.tsx — check contribution constants
6. Read app/reports/page.tsx — check company/sector exposure caps

## Output format

Report in three sections:
- **PASS** — values that match the constitution exactly
- **MISMATCH** — values that differ (show actual vs expected)
- **NOT FOUND** — expected constants that couldn't be located

End with a one-line verdict: "All X constants verified" or "X mismatches found — fix before next trade."
