// Atlas Core — governed-ticker seed metadata.
//
// The per-holding defaults used to create any missing governed ticker in the live DB. The
// RULE NUMBERS (target, hard cap, tolerance band) are DERIVED from the single source in
// lib/portfolio-spec.ts — this file only adds the presentation (name, colour). So the seed
// that populates production caps can never drift from the spec / engine / doc.

import { ATLAS_SPEC } from "@/lib/portfolio-spec"

export interface CoreHoldingDefault {
  name: string
  targetPct: number
  hardCapPct: number | null
  toleranceBand: number
  color: string
}

// Presentation only — names and colours. Rule numbers come from ATLAS_SPEC below.
const PRESENTATION: Record<string, { name: string; color: string }> = {
  VT:   { name: "Vanguard Total World Stock ETF",        color: "#818cf8" },
  VWO:  { name: "Vanguard FTSE Emerging Markets ETF",    color: "#c4b5fd" },
  QQQM: { name: "Invesco NASDAQ 100 ETF",                color: "#a78bfa" },
  SMH:  { name: "VanEck Semiconductor ETF",              color: "#f472b6" },
  BTC:  { name: "Grayscale Bitcoin Mini ETF",            color: "#f59e0b" },
  IBIT: { name: "iShares Bitcoin Trust ETF",             color: "#f59e0b" },
  SGOV: { name: "iShares 0-3 Month Treasury Bond ETF",   color: "#10b981" },
}

export const CORE_DEFAULTS: Record<string, CoreHoldingDefault> = Object.fromEntries(
  ATLAS_SPEC.funds.map((f) => [
    f.ticker,
    {
      name: PRESENTATION[f.ticker]?.name ?? f.ticker,
      targetPct: f.target,
      hardCapPct: f.hardCap,
      toleranceBand: f.band,
      color: PRESENTATION[f.ticker]?.color ?? "#64748b",
    },
  ]),
)
