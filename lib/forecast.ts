/**
 * Atlas Core — shared forecast math.
 *
 * Single source for both the dashboard's "Base Case — 2045" tile (app/page.tsx) and the
 * full Forecast page (app/forecast/page.tsx), so the two surfaces can never quote a
 * different growth-rate assumption for the same portfolio — the same class of bug fixed
 * for the tech-concentration pause (both engines must agree on the same underlying gate).
 *
 * The point of this page/tile is not prediction (Art. XXV: the engine never trades on a
 * forecast). Conservative/Base/Aggressive are declared planning scenarios that bracket a
 * reasonable range of long-run outcomes — informing patience, not decisions.
 */

import { ATLAS_SPEC, type ReturnAssumption } from "@/lib/portfolio-spec"

export type { ReturnAssumption }
export type AssetReturnAssumption = ReturnAssumption

export const FORECAST_BENCHMARKS_AS_OF = ATLAS_SPEC.forecastBenchmarksAsOf

export function effectiveMonthlyRate(annualRate: number): number {
  if (annualRate <= -1) throw new RangeError("annualRate must be greater than -100%")
  return Math.pow(1 + annualRate, 1 / 12) - 1
}

export function yearsToHorizon(horizonYear: number, currentYear = new Date().getFullYear()): number {
  return Math.max(0, horizonYear - currentYear)
}

// Derived from ATLAS_SPEC.funds — the spec is the single source of truth for return assumptions.
export const ASSET_EXPECTED_RETURNS: Record<string, AssetReturnAssumption> = Object.fromEntries(
  ATLAS_SPEC.funds.filter(f => f.expectedReturn).map(f => [f.ticker, f.expectedReturn!])
)

// Buffer/cash-like tickers use the user's own risk-free-rate assumption (Settings),
// not a fixed guess — it already represents "current MAS T-bill proxy" per that field's
// own description, which is exactly what SGOV approximates.
const BUFFER_TICKERS = new Set(["SGOV", "AGG", "CASH"])

const FALLBACK_RATES: AssetReturnAssumption = { conservative: 0.05, base: 0.10, aggressive: 0.15 }

/**
 * Blends per-asset expected-return assumptions by the portfolio's ACTUAL current
 * allocation (not the target weights) — so a portfolio that has drifted toward more
 * BTC/QQQM, say, sees that reflected in its growth-rate assumption, and rebalancing
 * changes the forecast the same way it changes everything else in the app.
 *
 * @param allocPct ticker -> % of NAV (0-100); need not sum to exactly 100.
 * @param riskFreeRate the user's Settings risk-free-rate assumption, applied to buffer tickers.
 */
export interface BlendResult {
  rates: AssetReturnAssumption
  excludedTickers: string[]
}

export function blendedGrowthRates(allocPct: Record<string, number>, riskFreeRate: number): BlendResult {
  let weight = 0
  let conservative = 0
  let base = 0
  let aggressive = 0
  const excludedTickers: string[] = []

  for (const [ticker, pct] of Object.entries(allocPct)) {
    if (!(pct > 0)) continue
    const w = pct / 100
    if (BUFFER_TICKERS.has(ticker)) {
      conservative += w * riskFreeRate
      base += w * riskFreeRate
      aggressive += w * riskFreeRate
    } else {
      const a = ASSET_EXPECTED_RETURNS[ticker]
      if (!a) {
        excludedTickers.push(ticker)
        continue
      }
      conservative += w * a.conservative
      base += w * a.base
      aggressive += w * a.aggressive
    }
    weight += w
  }

  if (weight <= 0) return { rates: FALLBACK_RATES, excludedTickers }
  return {
    rates: { conservative: conservative / weight, base: base / weight, aggressive: aggressive / weight },
    excludedTickers,
  }
}

/** One-off planned inflow at a specific month offset from now, in the same PLAN
 *  currency as monthlyContribution/annualLumpSum (Atlas: USD). Used for RSU vests
 *  under the sell-on-vest → contribute SOP; never a holding, only a cash inflow. */
export interface ExtraContribution {
  monthsFromNow: number
  amount: number
}

/**
 * Deterministic monthly-compounding projection: current value + monthly contributions
 * (growing at contributionGrowthRate p.a.) + an annual lump sum, compounded at annualRate.
 * Optional extraContributions land in their scheduled month; months beyond the horizon
 * are ignored (the money hasn't arrived inside the projected window).
 */
export function projectPortfolio(
  currentValue: number,
  monthlyContribution: number,
  annualLumpSum: number,
  annualRate: number,
  years: number,
  contributionGrowthRate: number,
  extraContributions: ExtraContribution[] = []
): number {
  let value = currentValue
  const monthlyRate = effectiveMonthlyRate(annualRate)
  // Bucket one-offs by absolute month index so the loop stays O(months).
  const extraByMonth = new Map<number, number>()
  for (const e of extraContributions) {
    if (!Number.isFinite(e.amount) || e.amount === 0) continue
    const idx = Math.max(0, Math.floor(e.monthsFromNow))
    extraByMonth.set(idx, (extraByMonth.get(idx) ?? 0) + e.amount)
  }
  for (let year = 0; year < years; year++) {
    const contribution = monthlyContribution * Math.pow(1 + contributionGrowthRate, year)
    for (let month = 0; month < 12; month++) {
      value = value * (1 + monthlyRate) + contribution + (extraByMonth.get(year * 12 + month) ?? 0)
    }
    value += annualLumpSum // annual top-up applied every year (incl. the first)
  }
  return value
}

export function toReal(nominal: number, years: number, cpi = 0.025): number {
  return nominal / Math.pow(1 + cpi, years)
}

// Log-normal P10/P90 cone around the base projection.
// Approximation: scale base value by exp(±1.28 × σ × √n).
// This is conservative since contributions reduce variance vs. lump-sum.
export function coneProjection(base: number, yr: number, z: number, vol: number): number {
  if (yr === 0) return base
  return base * Math.exp(z * vol * Math.sqrt(yr))
}
