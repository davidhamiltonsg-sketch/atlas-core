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
// Colours are the Atlas "mixed purples" brand ramp — a lightness ladder within the
// violet→purple→fuchsia family (CVD-validated vs dark + light surfaces; every mark in the
// app is also direct-labelled by ticker). BTC/IBIT keep semantic amber, SGOV green.
const PRESENTATION: Record<string, { name: string; color: string }> = {
  IMID: { name: "SPDR MSCI ACWI IMI UCITS ETF (Acc)", color: "#7c3aed" },
  EQAC: { name: "Invesco EQQQ Nasdaq-100 UCITS ETF Acc", color: "#a78bfa" },
  SMH: { name: "VanEck Semiconductor UCITS ETF", color: "#c026d3" },
  IWQU: { name: "iShares Edge MSCI World Quality Factor UCITS ETF (Acc)", color: "#6366f1" },
  DTLA: { name: "iShares $ Treasury Bond 20+yr UCITS ETF USD (Acc)", color: "#10b981" },
  VWRA: { name: "Vanguard FTSE All-World UCITS ETF",          color: "#7c3aed" },
  VFEA: { name: "Vanguard FTSE Emerging Markets UCITS ETF",   color: "#8b5cf6" },
  EQQQ: { name: "Invesco NASDAQ-100 UCITS ETF",               color: "#a78bfa" },
  SEMI: { name: "VanEck Semiconductor UCITS ETF",             color: "#c026d3" },
  BTC:  { name: "Bitcoin (run-off)",                          color: "#f59e0b" },
  IBIT: { name: "iShares Bitcoin Trust ETF",                  color: "#f59e0b" },
  SGOV: { name: "iShares 0-3 Month Treasury Bond ETF",        color: "#10b981" },
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
