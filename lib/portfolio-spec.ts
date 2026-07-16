// ─────────────────────────────────────────────────────────────────────────────
// Portfolio Spec — the SINGLE source of every governed rule NUMBER.
//
// Increment 1 of the ground-up migration: one canonical, machine-readable definition
// of each portfolio's rule set. The rest of the codebase derives from this (the DB seed,
// the SBR fund registry) or is pinned to it by scripts/check-spec.ts (the Atlas constants,
// the look-through combined ceiling, the SBR globals). A rule value that lives here cannot
// drift from the engine, the seed, or the served doc, because the contract check fails the
// moment they disagree.
//
// This file holds ONLY numbers and tickers — no prose, colours, or presentation. Those stay
// with the experience layer (constitutions.ts / core-holdings.ts), which compose them with
// the numbers derived from here.
// ─────────────────────────────────────────────────────────────────────────────

export interface ReturnAssumption {
  conservative: number
  base: number
  aggressive: number
}

export interface AtlasFundSpec {
  ticker: string
  target: number          // Art. VI target weight (%)
  band: number            // Art. VIII symmetric drift tolerance (± %)
  hardCap: number | null  // Art. VII single-position hard cap (%)
  driftLow?: number       // Art. VIII hard-underweight trigger (%)
  amberHigh?: number      // soft/amber zone upper bound below the cap (%)
  expectedReturn?: ReturnAssumption
  hardFloor?: number | null
  isin?: string
  cusip?: string
  exchange?: string
}

export interface SbrFundSpec {
  ticker: string
  target: number          // target weight (%)
  rangeLow: number        // comfortable range lower bound (%)
  rangeHigh: number       // comfortable range upper bound (%)
  hardCap: number | null  // hard cap (%)
  floor?: number          // safety floor (A35) (%)
  expectedReturn?: ReturnAssumption
  isin?: string
  cusip?: string
  exchange?: string
}

// ── Atlas Core (David · USD · to 2045) ───────────────────────────────────────
export const ATLAS_SPEC = {
  id: "atlas-core",
  currency: "USD",
  monthlyContribution: 3000,
  annualJanuaryBoost: 20000,
  horizonYear: 2045,
  forecastBenchmarksAsOf: "Jun 2026",
  funds: [
    { ticker: "VWRA", target: 70, band: 5, hardFloor: null, hardCap: 80, isin: "IE00BK5BQT80", exchange: "LSE", expectedReturn: { conservative: 0.05, base: 0.085, aggressive: 0.12 } },
    { ticker: "EQAC", target: 10, band: 2.5, hardFloor: 5, hardCap: 15, driftLow: 5, isin: "IE00BFZXGZ54", exchange: "LSE", expectedReturn: { conservative: 0.05, base: 0.105, aggressive: 0.15 } },
    { ticker: "SMH", target: 5, band: 1.25, hardFloor: 2, hardCap: 10, driftLow: 2, isin: "IE00BMC38736", exchange: "LSE", expectedReturn: { conservative: 0.04, base: 0.115, aggressive: 0.18 } },
    { ticker: "BTC", target: 5, band: 1.25, hardFloor: 2, hardCap: 8, driftLow: 2, cusip: "46438F101", exchange: "NASDAQ", expectedReturn: { conservative: -0.10, base: 0.12, aggressive: 0.25 } },
    { ticker: "DBMFE", target: 10, band: 2.5, hardFloor: 5, hardCap: 15, driftLow: 5, isin: "LU2951555403", exchange: "EURONEXT PARIS", expectedReturn: { conservative: 0.00, base: 0.06, aggressive: 0.10 } },
  ] as AtlasFundSpec[],
  combinedTech: { tickers: ["EQAC", "SMH"], soft: 18.75, hard: 25 },
  combinedSatellites: { tickers: ["EQAC", "SMH", "BTC"], hard: 28 },
  // §4 look-through sector caps (soft, hard).
  lookThroughSectors: {
    semiconductor: { soft: 25, hard: 30 },
    digital:       { soft: 45, hard: 50 },
    us:            { soft: 70, hard: 75 },
    ai:            { soft: 45, hard: 50 },
  },
} as const

// ── Silicon Brick Road (Dami · SGD · flexible medium-term growth) ────────────
export const SBR_SPEC = {
  id: "silicon-brick-road",
  currency: "SGD",
  monthlyContribution: 1000,
  targetValue: 0,
  hasFixedTarget: false,
  planningHorizonMonths: 120,
  forecastBenchmarksAsOf: "Jun 2026",
  funds: [
    { ticker: "VWRA", target: 65, rangeLow: 60, rangeHigh: 70, hardCap: 75, isin: "IE00BK5BQT80", exchange: "LSE", expectedReturn: { conservative: 0.05, base: 0.085, aggressive: 0.12 } },
    { ticker: "EQAC", target: 10, rangeLow: 7.5, rangeHigh: 12.5, hardCap: 15, isin: "IE00BFZXGZ54", exchange: "LSE", expectedReturn: { conservative: 0.05, base: 0.105, aggressive: 0.15 } },
    { ticker: "SMH", target: 5, rangeLow: 3.75, rangeHigh: 6.25, hardCap: 10, isin: "IE00BMC38736", exchange: "LSE", expectedReturn: { conservative: 0.04, base: 0.115, aggressive: 0.18 } },
    { ticker: "BTC", target: 5, rangeLow: 3.75, rangeHigh: 6.25, floor: 2, hardCap: 8, cusip: "46438F101", exchange: "NASDAQ", expectedReturn: { conservative: -0.10, base: 0.12, aggressive: 0.25 } },
    { ticker: "DBMFE", target: 10, rangeLow: 7.5, rangeHigh: 12.5, floor: 5, hardCap: 15, isin: "LU2951555403", exchange: "EURONEXT PARIS", expectedReturn: { conservative: 0.00, base: 0.06, aggressive: 0.10 } },
    { ticker: "A35", target: 5, rangeLow: 3.75, rangeHigh: 6.25, hardCap: 10, isin: "SG1S08926457", exchange: "SGX", expectedReturn: { conservative: 0.02, base: 0.03, aggressive: 0.04 } },
  ] as SbrFundSpec[],
  combined: { tickers: ["EQAC", "SMH"], warning: 25, hard: 32.5, resume: 22.5 },
  totalEquityMaxPct: 90,
  drawdownTriggerPct: 30,
  skipAtHighPct: 0,
  phases: [{ key: "GROWTH", min: 0, max: null }],
} as const

// Single flexible-growth rule set retained behind the phase-shaped compatibility type.
export const SBR_PHASE_CAPS = {
  GROWTH: { smhHard: 10, combinedHard: 32.5, combinedWarning: 25, combinedResume: 22.5 },
} as const
export type SbrPhaseKey = keyof typeof SBR_PHASE_CAPS

// Both portfolios buy whole exchange-traded units. Cash that cannot fund the next
// whole unit after FX and commission remains in the portfolio-specific DCA bank.
/** The reporting currency for a constitution — the single source for "USD base vs SGD".
 *  Toward the money-boundary pillar: callers should use this instead of `isSbr ? "SGD" : "USD"`. */
export function reportingCurrencyForConstitution(id: string): "USD" | "SGD" {
  return id === SBR_SPEC.id ? SBR_SPEC.currency : ATLAS_SPEC.currency
}

/** Look up a fund spec by ticker. */
export function atlasFund(ticker: string): AtlasFundSpec | undefined {
  return ATLAS_SPEC.funds.find((f) => f.ticker === ticker)
}
export function sbrFund(ticker: string): SbrFundSpec | undefined {
  return SBR_SPEC.funds.find((f) => f.ticker === ticker)
}
