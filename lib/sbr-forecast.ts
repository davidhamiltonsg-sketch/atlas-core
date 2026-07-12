/**
 * Silicon Brick Road — time-to-goal forecast math.
 *
 * Fully self-contained: SBR's own tickers and return assumptions only, no dependency on
 * Atlas Core's ticker/threshold tables (lib/constants.ts, lib/next-best-move.ts, etc.) —
 * kept isolated per the standing Atlas/SBR separation rule. The monthly-contribution model
 * is simpler than Atlas's (no lump sum, no contribution-growth rate — SBR's plan is a flat
 * SGD amount per month), so this doesn't reuse Atlas's projectPortfolio signature.
 */

import { SBR_SPEC, type ReturnAssumption } from "@/lib/portfolio-spec"
import { effectiveMonthlyRate } from "@/lib/forecast"

export type SbrGrowthRates = ReturnAssumption

// Derived from SBR_SPEC.funds — the spec is the single source of truth for return assumptions.
export const SBR_ASSET_EXPECTED_RETURNS: Record<string, SbrGrowthRates> = Object.fromEntries(
  SBR_SPEC.funds.filter(f => f.expectedReturn).map(f => [f.ticker, f.expectedReturn!])
)

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

  if (weight <= 0) {
    return sbrBlendedGrowthRate(Object.fromEntries(SBR_SPEC.funds.map(f => [f.ticker, f.target])))
  }
  return { conservative: conservative / weight, base: base / weight, aggressive: aggressive / weight }
}

// A sane search bound (50 years) — not a real-world claim, just stops the loop.
const MAX_MONTHS = 600

/**
 * Required annual return (CAGR) for a portfolio to reach targetValue in exactly
 * horizonMonths, given currentValue and a flat monthly contribution. Solved via
 * binary search (0%–300% annual). Returns 0 if already there, or 3.0 (300%) as
 * the ceiling if the target is unreachable in the horizon even at extreme returns.
 */
export function requiredAnnualReturn(
  currentValue: number,
  monthlyContribution: number,
  targetValue: number,
  horizonMonths: number,
): number {
  if (targetValue <= 0 || currentValue >= targetValue) return 0
  let lo = 0, hi = 3.0
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    const mr = effectiveMonthlyRate(mid)
    let value = currentValue
    for (let m = 0; m < horizonMonths; m++) value = value * (1 + mr) + monthlyContribution
    if (value >= targetValue) hi = mid
    else lo = mid
  }
  return (lo + hi) / 2
}

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
  const monthlyRate = effectiveMonthlyRate(annualRate)
  let value = currentValue
  for (let m = 1; m <= MAX_MONTHS; m++) {
    value = value * (1 + monthlyRate) + monthlyContribution
    if (value >= targetValue) return m
  }
  return null
}
