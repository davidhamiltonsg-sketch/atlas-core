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
    { ticker: "IMID", target: 52, band: 5, hardFloor: 45, hardCap: 62, driftLow: 45, isin: "IE00B3YLTY66", exchange: "LSE", expectedReturn: { conservative: 0.05, base: 0.085, aggressive: 0.12 } },
    { ticker: "EQAC", target: 10, band: 3, hardFloor: 5, hardCap: 15, driftLow: 5, isin: "IE00BFZXGZ54", exchange: "LSE", expectedReturn: { conservative: 0.05, base: 0.105, aggressive: 0.15 } },
    { ticker: "SMH", target: 4, band: 2, hardFloor: 0, hardCap: 8, driftLow: 0, amberHigh: 7, isin: "IE00BMC38736", exchange: "LSE", expectedReturn: { conservative: 0.04, base: 0.115, aggressive: 0.18 } },
    { ticker: "IWQU", target: 29, band: 5, hardFloor: 20, hardCap: 35, driftLow: 20, isin: "IE00BP3QZ601", exchange: "LSE", expectedReturn: { conservative: 0.05, base: 0.09, aggressive: 0.13 } },
    { ticker: "BTC", target: 5, band: 2, hardFloor: null, hardCap: 8, cusip: "46438F101", exchange: "NASDAQ", expectedReturn: { conservative: -0.10, base: 0.12, aggressive: 0.25 } },
  ] as AtlasFundSpec[],
  combinedTech: { tickers: ["EQAC", "SMH"], soft: 16, hard: 18 },
  combinedSatellites: { tickers: ["EQAC", "SMH", "BTC"], hard: 24 },
  // §4 look-through sector caps (soft, hard).
  lookThroughSectors: {
    semiconductor: { soft: 15, hard: 20 },
    digital:       { soft: 40, hard: 45 },
    us:            { soft: 65, hard: 70 },
    ai:            { soft: 30, hard: 38 },
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
    { ticker: "IMID", target: 80, rangeLow: 75, rangeHigh: 85, floor: 70, hardCap: 90, isin: "IE00B3YLTY66", exchange: "LSE", expectedReturn: { conservative: 0.05, base: 0.085, aggressive: 0.12 } },
    { ticker: "EQAC", target: 10, rangeLow: 7, rangeHigh: 13, floor: 5, hardCap: 15, isin: "IE00BFZXGZ54", exchange: "LSE", expectedReturn: { conservative: 0.05, base: 0.105, aggressive: 0.15 } },
    { ticker: "SMH", target: 5, rangeLow: 3, rangeHigh: 7, floor: 0, hardCap: 8, isin: "IE00BMC38736", exchange: "LSE", expectedReturn: { conservative: 0.04, base: 0.115, aggressive: 0.18 } },
    { ticker: "IB01", target: 5, rangeLow: 3, rangeHigh: 8, floor: 3, hardCap: 10, isin: "IE00BGSF1X88", exchange: "LSE", expectedReturn: { conservative: 0.02, base: 0.035, aggressive: 0.05 } },
  ] as SbrFundSpec[],
  combined: { tickers: ["EQAC", "SMH"], warning: 18, hard: 20, resume: 17 },
  totalEquityMaxPct: 97,
  drawdownTriggerPct: 30,
  skipAtHighPct: 0,
  phases: [{ key: "GROWTH", min: 0, max: null }],
} as const

// Phase-dependent caps for SBR — as the portfolio matures toward the property goal,
// semiconductor and tech ceilings tighten to reduce sequencing risk. Phase I values
// match SBR_SPEC.combined so no existing code that reads the static spec breaks.
export const SBR_PHASE_CAPS = {
  GROWTH: { smhHard: 8, combinedHard: 20, combinedWarning: 18, combinedResume: 17 },
} as const
export type SbrPhaseKey = keyof typeof SBR_PHASE_CAPS

// A35.SI trades in board lots of 1,000 units on the SGX. At ≈SGD 1.18/unit that's
// ≈SGD 1,180 per lot. Odd-lot fills are possible but attract a wider spread; the
// accrual engine banks SGD until a full lot can be purchased.
export const A35_LOT_SIZE = 1000          // units per board lot
export const A35_PRICE_APPROX_SGD = 1.18 // refresh from live price quarterly

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
