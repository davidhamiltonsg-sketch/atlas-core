/**
 * Silicon Brick Road — time-to-goal forecast math.
 *
 * Fully self-contained: SBR's own tickers and return assumptions only, no dependency on
 * Atlas Core's ticker/threshold tables (lib/constants.ts, lib/next-best-move.ts, etc.) —
 * kept isolated per the standing Atlas/SBR separation rule. The monthly-contribution model
 * is simpler than Atlas's (no lump sum, no contribution-growth rate — SBR's plan is a flat
 * SGD amount per month), so this doesn't reuse Atlas's projectPortfolio signature.
 */

export interface SbrGrowthRates {
  conservative: number
  base: number
  aggressive: number
}

// Per-fund long-run CAGR assumptions — verified Jun 2026 (update the date when refreshed).
// VWRA/QQQM/SMH mirror the same funds' long-run profile used elsewhere; A35 (SGD bonds) is
// deliberately modest and low-variance — it's the safety floor, not a growth engine.
export const SBR_ASSET_EXPECTED_RETURNS: Record<string, SbrGrowthRates> = {
  VWRA: { conservative: 0.06, base: 0.095, aggressive: 0.12 },
  QQQM: { conservative: 0.07, base: 0.115, aggressive: 0.16 },
  SMH:  { conservative: 0.06, base: 0.13,  aggressive: 0.20 },
  A35:  { conservative: 0.01, base: 0.03,  aggressive: 0.05 },
}

const FALLBACK_RATES: SbrGrowthRates = { conservative: 0.03, base: 0.07, aggressive: 0.11 }

/**
 * Blends per-fund expected-return assumptions by the ACTUAL current allocation (not the
 * target weights) — the plan reflects what's really held, drifted or not.
 */
export function sbrBlendedGrowthRate(allocPct: Record<string, number>): SbrGrowthRates {
  let weight = 0
  let conservative = 0
  let base = 0
  let aggressive = 0

  for (const [ticker, pct] of Object.entries(allocPct)) {
    if (!(pct > 0)) continue
    const a = SBR_ASSET_EXPECTED_RETURNS[ticker]
    if (!a) continue
    const w = pct / 100
    conservative += w * a.conservative
    base += w * a.base
    aggressive += w * a.aggressive
    weight += w
  }

  if (weight <= 0) return FALLBACK_RATES
  return { conservative: conservative / weight, base: base / weight, aggressive: aggressive / weight }
}

// A sane search bound (50 years) — not a real-world claim, just stops the loop.
const MAX_MONTHS = 600

/**
 * Months (rounded up to the month the target is first reached) until the projected value,
 * compounding monthly with a flat monthly contribution, reaches targetValue. Returns 0 if
 * already there, or null if it wouldn't be reached within the search bound.
 */
export function monthsToTarget(
  currentValue: number,
  monthlyContribution: number,
  annualRate: number,
  targetValue: number
): number | null {
  if (targetValue <= 0 || currentValue >= targetValue) return 0
  const monthlyRate = annualRate / 12
  let value = currentValue
  for (let m = 1; m <= MAX_MONTHS; m++) {
    value = value * (1 + monthlyRate) + monthlyContribution
    if (value >= targetValue) return m
  }
  return null
}
