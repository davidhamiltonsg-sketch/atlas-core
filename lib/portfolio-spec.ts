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

export interface AtlasFundSpec {
  ticker: string
  target: number          // Art. VI target weight (%)
  band: number            // Art. VIII symmetric drift tolerance (± %)
  hardCap: number | null  // Art. VII single-position hard cap (%)
  driftLow?: number       // Art. VIII hard-underweight trigger (%)
  amberHigh?: number      // soft/amber zone upper bound below the cap (%)
}

export interface SbrFundSpec {
  ticker: string
  target: number          // target weight (%)
  rangeLow: number        // comfortable range lower bound (%)
  rangeHigh: number       // comfortable range upper bound (%)
  hardCap: number | null  // hard cap (%)
  floor?: number          // safety floor (A35) (%)
}

// ── Atlas Core (David · USD · to 2045) ───────────────────────────────────────
export const ATLAS_SPEC = {
  id: "atlas-core",
  currency: "USD",
  monthlyContribution: 3000,
  annualJanuaryBoost: 20000,
  horizonYear: 2045,
  funds: [
    { ticker: "VT",   target: 52, band: 6,   hardCap: 60,   driftLow: 42 },
    { ticker: "VWO",  target: 8,  band: 3,   hardCap: 13,   driftLow: 3 },
    { ticker: "QQQM", target: 23, band: 5,   hardCap: 30,   driftLow: 15 },
    { ticker: "SMH",  target: 10, band: 3,   hardCap: 12,   driftLow: 5, amberHigh: 11 },
    { ticker: "BTC",  target: 7,  band: 1,   hardCap: 8 },
    { ticker: "IBIT", target: 0,  band: 1,   hardCap: 8 },
    { ticker: "SGOV", target: 0,  band: 2.5, hardCap: null },
  ] as AtlasFundSpec[],
  // Art. XII / §4.3 combined QQQM + SMH tech ceiling (soft, hard).
  combinedTech: { tickers: ["QQQM", "SMH"], soft: 38, hard: 42 },
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
  monthlyContribution: 2000,
  targetValue: 120000,
  funds: [
    { ticker: "VWRA", target: 50, rangeLow: 44, rangeHigh: 56, hardCap: 62 },
    { ticker: "QQQM", target: 25, rangeLow: 20, rangeHigh: 30, hardCap: 30 },
    { ticker: "SMH",  target: 15, rangeLow: 11, rangeHigh: 19, hardCap: 20 },
    { ticker: "A35",  target: 10, rangeLow: 7,  rangeHigh: 13, hardCap: null, floor: 7 },
  ] as SbrFundSpec[],
  combined: { tickers: ["QQQM", "SMH"], warning: 40, hard: 45, resume: 42 },
  totalEquityMaxPct: 92,
  drawdownTriggerPct: 15,
  skipAtHighPct: 3,
  phases: [
    { key: "I",   min: 0,      max: 72000 },
    { key: "II",  min: 72000,  max: 102000 },
    { key: "III", min: 102000, max: 114000 },
    { key: "IV",  min: 114000, max: null },
  ],
} as const

/** Look up a fund spec by ticker. */
export function atlasFund(ticker: string): AtlasFundSpec | undefined {
  return ATLAS_SPEC.funds.find((f) => f.ticker === ticker)
}
export function sbrFund(ticker: string): SbrFundSpec | undefined {
  return SBR_SPEC.funds.find((f) => f.ticker === ticker)
}
