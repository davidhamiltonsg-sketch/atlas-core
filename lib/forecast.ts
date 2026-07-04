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

export interface AssetReturnAssumption {
  conservative: number
  base: number
  aggressive: number
}

// Per-asset-class long-run CAGR assumptions — verified Jun 2026 (update the date when
// these are refreshed). BTC/IBIT share one entry since they're one economic sleeve
// everywhere else in the app (applyBitcoinSleeve).
export const FORECAST_BENCHMARKS_AS_OF = "Jun 2026"

export const ASSET_EXPECTED_RETURNS: Record<string, AssetReturnAssumption> = {
  VT:   { conservative: 0.06,  base: 0.095, aggressive: 0.12 },  // Global total-world equity, long-run
  QQQM: { conservative: 0.07,  base: 0.115, aggressive: 0.16 },  // US large-cap tech tilt
  SMH:  { conservative: 0.06,  base: 0.13,  aggressive: 0.20 },  // Semiconductors — cyclical, higher variance
  VWO:  { conservative: 0.03,  base: 0.065, aggressive: 0.10 },  // Emerging markets — valuation-dependent
  BTC:  { conservative: -0.05, base: 0.12,  aggressive: 0.25 },  // Bitcoin sleeve — genuinely wide uncertainty
  IBIT: { conservative: -0.05, base: 0.12,  aggressive: 0.25 },
}

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
export function blendedGrowthRates(allocPct: Record<string, number>, riskFreeRate: number): AssetReturnAssumption {
  let weight = 0
  let conservative = 0
  let base = 0
  let aggressive = 0

  for (const [ticker, pct] of Object.entries(allocPct)) {
    if (!(pct > 0)) continue
    const w = pct / 100
    if (BUFFER_TICKERS.has(ticker)) {
      conservative += w * riskFreeRate
      base += w * riskFreeRate
      aggressive += w * riskFreeRate
    } else {
      const a = ASSET_EXPECTED_RETURNS[ticker]
      if (!a) continue // unknown ticker — excluded, blend renormalizes over known weight below
      conservative += w * a.conservative
      base += w * a.base
      aggressive += w * a.aggressive
    }
    weight += w
  }

  if (weight <= 0) return FALLBACK_RATES // no holdings yet — same defaults the static version used
  return { conservative: conservative / weight, base: base / weight, aggressive: aggressive / weight }
}

/**
 * Deterministic monthly-compounding projection: current value + monthly contributions
 * (growing at contributionGrowthRate p.a.) + an annual lump sum, compounded at annualRate.
 */
export function projectPortfolio(
  currentValue: number,
  monthlyContribution: number,
  annualLumpSum: number,
  annualRate: number,
  years: number,
  contributionGrowthRate: number
): number {
  let value = currentValue
  const monthlyRate = annualRate / 12
  for (let year = 0; year < years; year++) {
    const contribution = monthlyContribution * Math.pow(1 + contributionGrowthRate, year)
    for (let month = 0; month < 12; month++) {
      value = value * (1 + monthlyRate) + contribution
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
