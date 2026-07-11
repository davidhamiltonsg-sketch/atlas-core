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
}

export interface SbrFundSpec {
  ticker: string
  target: number          // target weight (%)
  rangeLow: number        // comfortable range lower bound (%)
  rangeHigh: number       // comfortable range upper bound (%)
  hardCap: number | null  // hard cap (%)
  floor?: number          // safety floor (A35) (%)
  expectedReturn?: ReturnAssumption
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
    { ticker: "VWRA", target: 52, band: 6,   hardCap: 60,   driftLow: 42, expectedReturn: { conservative: 0.06,  base: 0.095, aggressive: 0.12 } },
    { ticker: "VOO",  target: 0,  band: 0,   hardCap: null,               expectedReturn: { conservative: 0.065, base: 0.10,  aggressive: 0.13 } },
    { ticker: "VFEA", target: 8,  band: 3,   hardCap: 13,   driftLow: 3,  expectedReturn: { conservative: 0.03,  base: 0.065, aggressive: 0.10 } },
    { ticker: "EQQQ", target: 23, band: 5,   hardCap: 30,   driftLow: 15, expectedReturn: { conservative: 0.07,  base: 0.115, aggressive: 0.16 } },
    { ticker: "SEMI", target: 10, band: 3,   hardCap: 12,   driftLow: 5, amberHigh: 11, expectedReturn: { conservative: 0.06,  base: 0.13,  aggressive: 0.20 } },
    { ticker: "BTC",  target: 7,  band: 1,   hardCap: 8,                  expectedReturn: { conservative: -0.05, base: 0.12,  aggressive: 0.25 } },
    { ticker: "IBIT", target: 0,  band: 1,   hardCap: 8,                  expectedReturn: { conservative: -0.05, base: 0.12,  aggressive: 0.25 } },
    { ticker: "SGOV", target: 0,  band: 2.5, hardCap: null },
    { ticker: "A35",  target: 0,  band: 0,   hardCap: null,               expectedReturn: { conservative: 0.01,  base: 0.03,  aggressive: 0.05 } },
  ] as AtlasFundSpec[],
  // Art. XII / §4.3 combined EQQQ + SEMI tech ceiling (soft, hard).
  combinedTech: { tickers: ["EQQQ", "SEMI"], soft: 38, hard: 42 },
  // §4 look-through sector caps (soft, hard).
  lookThroughSectors: {
    semiconductor: { soft: 16, hard: 20 },
    digital:       { soft: 48, hard: 54 },
    us:            { soft: 66, hard: 70 },
    ai:            { soft: 38, hard: 46 },
  },
} as const

// ── Silicon Brick Road (Dami · SGD · to a S$120k deposit) ────────────────────
export const SBR_SPEC = {
  id: "silicon-brick-road",
  currency: "SGD",
  monthlyContribution: 1000,
  targetValue: 120000,
  forecastBenchmarksAsOf: "Jun 2026",
  funds: [
    { ticker: "VWRA", target: 50, rangeLow: 44, rangeHigh: 56, hardCap: 62, expectedReturn: { conservative: 0.06, base: 0.095, aggressive: 0.12 } },
    { ticker: "EQQQ", target: 25, rangeLow: 20, rangeHigh: 30, hardCap: 30, expectedReturn: { conservative: 0.07, base: 0.115, aggressive: 0.16 } },
    { ticker: "SEMI", target: 15, rangeLow: 11, rangeHigh: 19, hardCap: 20, expectedReturn: { conservative: 0.06, base: 0.13,  aggressive: 0.20 } },
    { ticker: "A35",  target: 10, rangeLow: 7,  rangeHigh: 13, hardCap: null, floor: 7, expectedReturn: { conservative: 0.01, base: 0.03,  aggressive: 0.05 } },
  ] as SbrFundSpec[],
  combined: { tickers: ["EQQQ", "SEMI"], warning: 40, hard: 45, resume: 42 },
  totalEquityMaxPct: 92,
  drawdownTriggerPct: 15,
  skipAtHighPct: 3,
  phases: [
    { key: "I",   min: 0,      max: 72000 },
    { key: "II",  min: 72000,  max: 96000  },
    { key: "III", min: 96000,  max: 114000 },
    { key: "IV",  min: 114000, max: null },
  ],
} as const

// Phase-dependent caps for SBR — as the portfolio matures toward the property goal,
// semiconductor and tech ceilings tighten to reduce sequencing risk. Phase I values
// match SBR_SPEC.combined so no existing code that reads the static spec breaks.
export const SBR_PHASE_CAPS = {
  I:   { smhHard: 20, combinedHard: 45, combinedWarning: 40, combinedResume: 42 },
  II:  { smhHard: 18, combinedHard: 42, combinedWarning: 38, combinedResume: 39 },
  III: { smhHard: 16, combinedHard: 38, combinedWarning: 35, combinedResume: 36 },
  IV:  { smhHard: 14, combinedHard: 33, combinedWarning: 30, combinedResume: 31 },
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
