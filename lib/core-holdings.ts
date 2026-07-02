// Atlas Core — governed-ticker seed metadata.
//
// The single source of the per-holding defaults used to create any missing governed ticker
// in the live DB (targets, hard caps, tolerance bands). Kept in its OWN db-free module so the
// contract checks can import it and assert it matches the constitution's HARD_THRESHOLDS /
// TICKER_TARGETS — the seed that populates production caps must never drift from the rules.

export interface CoreHoldingDefault {
  name: string
  targetPct: number
  hardCapPct: number | null
  toleranceBand: number
  color: string
}

export const CORE_DEFAULTS: Record<string, CoreHoldingDefault> = {
  VT:   { name: "Vanguard Total World Stock ETF",        targetPct: 52, hardCapPct: 60,   toleranceBand: 6,   color: "#818cf8" },
  VWO:  { name: "Vanguard FTSE Emerging Markets ETF",    targetPct: 8,  hardCapPct: 13,   toleranceBand: 3,   color: "#c4b5fd" },
  QQQM: { name: "Invesco NASDAQ 100 ETF",                targetPct: 23, hardCapPct: 30,   toleranceBand: 5,   color: "#a78bfa" },
  SMH:  { name: "VanEck Semiconductor ETF",              targetPct: 10, hardCapPct: 12,   toleranceBand: 3,   color: "#f472b6" },
  BTC:  { name: "Grayscale Bitcoin Mini ETF",            targetPct: 7,  hardCapPct: 8,    toleranceBand: 1,   color: "#f59e0b" },
  IBIT: { name: "iShares Bitcoin Trust ETF",             targetPct: 0,  hardCapPct: 8,    toleranceBand: 1,   color: "#f59e0b" },
  SGOV: { name: "iShares 0-3 Month Treasury Bond ETF",   targetPct: 0,  hardCapPct: null, toleranceBand: 2.5, color: "#10b981" },
}
