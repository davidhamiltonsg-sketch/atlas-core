// v6.1 hard drift thresholds (Section 3.1)
// BTC has no lower hard trigger — underweight is soft-alert only (it's a held
// conviction asset: accumulate on weakness toward target, never sold at a loss)
// SMH cap tightened 15% → 12% (Principle 04)
export const HARD_THRESHOLDS: Record<string, { low?: number; high: number }> = {
  VT:   { low: 42, high: 62 },
  QQQM: { low: 15, high: 31 },
  SMH:  { low: 5,  high: 12 },
  VWO:  { low: 3,  high: 13 },
  BTC:  { high: 8  },
}

// v6.1 Command Centre — market-aware governance rules from pattern analysis
// These complement Section 3 drift bands with market-condition-aware overlays
export const COMMAND_CENTRE_RULES = {
  minHoldDays: 90,         // 3-month hold before any sale
  smhConcentrationCap: 12, // SMH hard cap at 12% weight (§4 override)
  shockBufferTargetPct: 10, // Target 8-10% in SGOV / short-duration
  tranche1Pct: 30,         // First entry tranche: 30% of intended capital
  tranche2Pct: 40,         // Second entry (after 3 green weeks): 40%
  tranche3Pct: 30,         // Third entry (trend confirmed): 30%
  smhEntryLevel1: 590,     // First SMH alert level (watch)
  smhEntryLevel2: 550,     // Second SMH alert level (deploy tranche 1)
  smhEntryLevel3: 510,     // Third SMH alert level (deploy tranche 2)
  policyShockRecoveryDays: 42,  // Historical avg recovery: policy shocks
  macroShockRecoveryDays: 540,  // Historical avg recovery: macro cycles
} as const
