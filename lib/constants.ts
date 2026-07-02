/**
 * Atlas Core — Governance Constants
 * Version: 6.1
 *
 * Changes from v6.0:
 * - BTC: Halving cycle modifier (§4.1)
 * - SMH: Cycle-aware soft band (§4.2)
 * - NEW: Combined tech concentration rule QQQM+SMH (§4.3)
 * - Hard caps remain static — floating applies to soft bands only
 *   (BTC's hard cap is the one exception: it floats by cycle phase.)
 *
 * UNITS — IMPORTANT:
 *   Allocation targets, caps, soft/healthy bands and the combined-tech ceilings are
 *   expressed as WHOLE-NUMBER PERCENTAGES (e.g. 52 = 52% of NAV). This matches how
 *   HARD_THRESHOLDS is consumed across the app (app/page.tsx, app/portfolio,
 *   app/rebalance compare against actualPct on a 0–100 scale). Do NOT switch these
 *   to fractions without updating every consumer.
 *   Price-from-high inputs and tranche weights are decimal RATIOS (e.g. -0.05 = 5%
 *   below the 52-week high; 0.30 = 30% of a tranche), because they are not allocations.
 */

// Target weights (whole-number percent of NAV)
// Bitcoin sleeve = BTC + IBIT combined = 7% (see §4.1). BTC is being transitioned into
// IBIT (the more tax-effective vehicle) like-for-like: as the transition proceeds the BTC
// target steps down and IBIT steps up by the same amount, keeping the sleeve at 7%.
export const TICKER_TARGETS: Record<string, number> = {
  VT:   52,
  QQQM: 23,
  SMH:  10,
  VWO:  8,
  BTC:  7,   // legacy Bitcoin vehicle — transitioning out
  IBIT: 0,   // target Bitcoin vehicle — rises as BTC falls; sleeve total stays 7%
}

// Hard drift thresholds — whole-number percent. Position hard caps live in Art. VII
// (VT 60%); the drift bands (soft/hard triggers, SMH amber zone) live in Art. VIII.
// BTC has no lower hard trigger — underweight is soft-alert only (it's a held
// conviction asset: accumulate on weakness toward target, never sold at a loss).
// SMH cap tightened 15% → 12% (Principle 04). SMH amberHigh=11 adds a soft amber
// zone 11–12% (Art. VII); display shows green <11%, amber 11–12%, red ≥12%.
// BTC.high tracks the CURRENT cycle phase (Normal = 8% as of Jun 2026). The full
// floating ladder lives in BTC_CYCLE_MODIFIERS (§4.1) and is surfaced in Governance.
// amberHigh?: if set, the amber/soft zone is (amberHigh, high]; healthy zone is (hardLow, amberHigh].
export const HARD_THRESHOLDS: Record<string, { low?: number; high: number; amberHigh?: number }> = {
  VT:   { low: 42, high: 60 },                    // Art. VII: hard cap 60% (was 62% in v6.x)
  QQQM: { low: 15, high: 31 },
  SMH:  { low: 5,  high: 12, amberHigh: 11 },     // Art. VII: amber zone 11–12%
  VWO:  { low: 3,  high: 13 },
  // Bitcoin sleeve (BTC + IBIT) — no lower hard trigger; hard cap 8% applies to the
  // COMBINED sleeve (the engine sums BTC + IBIT). Per-ticker values mirror the sleeve cap.
  BTC:  { high: 8 }, // base = Normal phase; see BTC cycle modifier (§4.1)
  IBIT: { high: 8 }, // tax-effective Bitcoin vehicle — same sleeve as BTC
}

// ─── GOVERNANCE BAND ROWS (single source of truth for the §2/§3 gauge table) ──
// The governance page's "Where Each Holding Stands" gauges are DERIVED from
// TICKER_TARGETS + HARD_THRESHOLDS + this profile — never hand-maintained — so the
// displayed bands can never disagree with the numbers the engine enforces.
export const POSITION_PROFILE: Record<string, { band: number; classification: string; color: string }> = {
  VT:   { band: 6, classification: "Global Core",              color: "#6366f1" },
  QQQM: { band: 5, classification: "Digital Economy Engine",   color: "#8b5cf6" },
  SMH:  { band: 3, classification: "AI Infrastructure Tilt",   color: "#a78bfa" },
  VWO:  { band: 3, classification: "Geographic Diversifier",   color: "#c4b5fd" },
  BTC:  { band: 1, classification: "Bitcoin — Volatility Cap", color: "#f59e0b" },
}

export interface GovernanceBandRow {
  ticker: string
  target: number
  classification: string
  color: string
  healthyLow: number; healthyHigh: number   // soft-drift band (target ± tolerance, clamped to hard)
  softLow: number;    softHigh: number       // outside healthy but inside hard (= hard bounds)
  hardLow: number;    hardHigh: number       // §3 hard-drift triggers
}

/** Build the governance gauge row for a ticker straight from the canonical constants. */
export function getGovernanceBandRow(ticker: string): GovernanceBandRow | null {
  const target  = TICKER_TARGETS[ticker]
  const hard    = HARD_THRESHOLDS[ticker]
  const profile = POSITION_PROFILE[ticker]
  if (target === undefined || !hard || !profile) return null
  const hardLow  = hard.low ?? 0
  const hardHigh = hard.high
  return {
    ticker, target, classification: profile.classification, color: profile.color,
    healthyLow:  Math.max(hardLow, target - profile.band),
    healthyHigh: Math.min(hard.amberHigh ?? hardHigh, target + profile.band),
    softLow: hardLow, softHigh: hardHigh,
    hardLow, hardHigh,
  }
}

export const GOVERNANCE_BAND_ROWS: GovernanceBandRow[] =
  (["VT", "QQQM", "SMH", "VWO", "BTC"] as const)
    .map(getGovernanceBandRow)
    .filter((r): r is GovernanceBandRow => r !== null)

// ─── §4.1 — BTC HALVING CYCLE MODIFIER ───────────────────────────────────────
export type BtcCyclePhase = 'post_halving_bull' | 'normal' | 'bear'

export interface BtcCycleModifier {
  phase:     BtcCyclePhase
  hardHigh:  number  // % of NAV
  target:    number  // % of NAV
  softHigh:  number  // % of NAV
  label:     string
  rationale: string
}

export const BTC_CYCLE_MODIFIERS: Record<BtcCyclePhase, BtcCycleModifier> = {
  post_halving_bull: {
    phase: 'post_halving_bull', hardHigh: 10, target: 8, softHigh: 9,
    label: 'Post-Halving Bull',
    rationale: '12–24 months post-halving. Wider cap reflects historically elevated return window.',
  },
  normal: {
    phase: 'normal', hardHigh: 8, target: 7, softHigh: 8,
    label: 'Normal',
    rationale: 'Standard governance. No halving catalyst active.',
  },
  bear: {
    phase: 'bear', hardHigh: 6, target: 5, softHigh: 5.5,
    label: 'Bear / Risk-Off',
    rationale: 'BTC drawdown >50% from cycle high. Reduce exposure ceiling.',
  },
}

/**
 * @param btcPriceVsCycleHigh price ÷ cycle-high as a ratio (e.g. 0.45 = 55% drawdown)
 * @param manualOverride optional forced phase
 */
export function getBtcCyclePhase(
  btcPriceVsCycleHigh?: number,
  manualOverride?: BtcCyclePhase
): BtcCyclePhase {
  if (manualOverride) return manualOverride
  const halvingDate = new Date('2024-04-19')
  const now = new Date()
  const monthsSinceHalving =
    (now.getFullYear() - halvingDate.getFullYear()) * 12 +
    (now.getMonth() - halvingDate.getMonth())
  if (btcPriceVsCycleHigh !== undefined && btcPriceVsCycleHigh < 0.50) return 'bear'
  // Art. VIII: bull window = months 12–24 post-halving only. Months 0–12 = normal (catalyst not yet priced).
  if (monthsSinceHalving >= 12 && monthsSinceHalving <= 24) return 'post_halving_bull'
  return 'normal'
}

export function getBtcModifier(
  btcPriceVsCycleHigh?: number,
  manualOverride?: BtcCyclePhase
): BtcCycleModifier {
  return BTC_CYCLE_MODIFIERS[getBtcCyclePhase(btcPriceVsCycleHigh, manualOverride)]
}

// ─── §4.2 — SMH CYCLE-AWARE SOFT BAND ────────────────────────────────────────
export type SmhCyclePhase = 'top' | 'mid' | 'bottom'

export interface SmhSoftBand {
  phase:       SmhCyclePhase
  softLow:     number  // % of NAV
  softHigh:    number  // % of NAV
  healthyLow:  number  // % of NAV
  healthyHigh: number  // % of NAV
  label:       string
  signal:      string
}

export const SMH_SOFT_BANDS: Record<SmhCyclePhase, SmhSoftBand> = {
  top: {
    phase: 'top', softLow: 7, softHigh: 10, healthyLow: 9, healthyHigh: 10,
    label: 'Cycle Top',
    signal: 'SMH within 5% of 52-week high. Hold only. No new buys.',
  },
  mid: {
    phase: 'mid', softLow: 7, softHigh: 12, healthyLow: 7, healthyHigh: 12,
    label: 'Mid-Cycle',
    signal: 'Standard soft band applies.',
  },
  bottom: {
    phase: 'bottom', softLow: 5, softHigh: 14, healthyLow: 7, healthyHigh: 14,
    label: 'Cycle Bottom',
    signal: 'SMH >20% off 52-week high. Soft band widens — accumulation window.',
  },
}

/** @param pctFromHigh price-from-52w-high as a ratio (e.g. -0.05 = 5% below high) */
export function getSmhCyclePhase(pctFromHigh: number): SmhCyclePhase {
  if (pctFromHigh > -0.05) return 'top'
  if (pctFromHigh < -0.20) return 'bottom'
  return 'mid'
}

export function getSmhSoftBand(pctFromHigh: number): SmhSoftBand {
  return SMH_SOFT_BANDS[getSmhCyclePhase(pctFromHigh)]
}

// ─── §4.3 — COMBINED TECH CONCENTRATION RULE (NEW in v6.1) ────────────────────
// Display/governance rule. QQQM+SMH combined exposure as a whole-number percent.
export const COMBINED_TECH_RULE = {
  tickers:     ['QQQM', 'SMH'] as const,
  softCeiling: 38,
  hardCeiling: 42,
  label:       'Combined Tech Concentration',
  rationale:   'QQQM+SMH combined exposure. Semis overlap means individual caps understate concentration risk.',
  action: {
    soft: 'Flag for review. No new QQQM or SMH buys until combined falls below 36%.',
    hard: 'Halt all QQQM and SMH contributions. Review at next monthly cycle.',
  },
} as const

// ─── Bitcoin sleeve constants (Art. VIII) ────────────────────────────────────
// BTC and IBIT are ONE economic exposure (Bitcoin). BTC is in run-off (held, not bought);
// IBIT is the accumulation vehicle. New Bitcoin money always flows to IBIT.
// Combined sleeve target 7%; cycle-aware hard cap lives in BTC_CYCLE_MODIFIERS.
export const BITCOIN_TICKERS = ["BTC", "IBIT"] as const
export const BITCOIN_SLEEVE_TARGET_PCT = 7
export const BITCOIN_RUNOFF_TICKER     = "BTC"   // transitioning out like-for-like
export const BITCOIN_ACCUMULATION_TICKER = "IBIT" // accumulation vehicle

/**
 * Apply the Bitcoin-sleeve transition model: BTC's effective target = its current
 * weight (zero buy/sell pressure); IBIT's effective target = max(0, sleevePct − BTC).
 * This routes new Bitcoin money to IBIT while BTC naturally runs off.
 * Only transforms when both are present; otherwise returns positions unchanged.
 */
export function applyBitcoinSleeve<T extends { ticker: string; actualPct: number; targetPct: number }>(
  positions: T[]
): T[] {
  const btc  = positions.find((p) => p.ticker === BITCOIN_RUNOFF_TICKER)
  const ibit = positions.find((p) => p.ticker === BITCOIN_ACCUMULATION_TICKER)
  if (!btc || !ibit) return positions
  return positions.map((p) => {
    if (p.ticker === BITCOIN_RUNOFF_TICKER)     return { ...p, targetPct: p.actualPct }
    if (p.ticker === BITCOIN_ACCUMULATION_TICKER) return { ...p, targetPct: Math.max(0, BITCOIN_SLEEVE_TARGET_PCT - btc.actualPct) }
    return p
  })
}

export const BEHAVIORAL_RULES = {
  holdPeriodDays:        90,
  contributionLagMonths: 3,
  dipTranches: { first: 0.30, second: 0.40, third: 0.30 }, // proportions of intended capital
  nearHighThreshold:     0.03, // ratio: within 3% of 52w high
  sgovHighSkip:          true,
} as const

export const DCA_PARAMS = {
  monthlyContribution:  3000,
  annualJanuaryBoost:  20000,
  currency:            'USD', // Art. XIII: "USD 3,000 per month" + "USD 20,000" January lump sum (reporting is SGD — Art. XXIII)
  brokerageAccount:    'IBKR Singapore',
  horizonYear:         2045,
} as const

// SGOV yield — verified 24 Jun 2026 (30-day SEC 3.55% on 17 Jun; dividend yield 3.85% on 18 Jun)
export const SGOV_YIELD = {
  thirtyDaySec:  0.0355,
  dividendYield: 0.0385,
  lastVerified:  '2026-06',
} as const

// ─── OPERATING ASSUMPTIONS & SAFEGUARDS (analyst review, v6.7) ────────────────
// Hard, documented parameters for the blind spots a 20-year plan must pin down:
// estate-tax trigger, emergency reserve, base/retirement currency, platform risk,
// override policy, and the rule-conflict hierarchy.
export const OPERATING_ASSUMPTIONS = {
  baseCurrency: "USD",
  trackingCurrency: "SGD",
  retirementCurrency: "SGD",
  // Emergency cash held OUTSIDE this portfolio (so SGOV stays available for deployment).
  emergencyReserveMonths: 6,
  // US estate tax bites on US-sited assets above ~USD 60k for non-US persons (estate-tax risk begins).
  // Art. XV: migration is MANDATORY when US-sited ETF value exceeds USD 100k (UCITS mandate threshold).
  // Two-tier: warn at 60k (estate-tax risk live), require migration at 100k.
  usEstateTaxTriggerUsd:    60_000,   // Art. XV: warn — estate-tax risk begins
  ucitsMandatoryTriggerUsd: 100_000,  // Art. XV: mandate — UCITS migration required above this
  broker: "IBKR Singapore",
  // Single-broker exposure is accepted; revisit a second custodian on a regulatory change,
  // sanctions/capital-control risk, or once the balance is a material single-point risk.
  platformPolicy: "single-broker (IBKR) accepted — review a second custodian on regulatory change or material single-point risk",
  // Overrides are allowed ONLY at the scheduled January review or a documented emergency,
  // and must be logged with a reason.
  overridePolicy: "overrides only at the annual January review or a documented emergency — logged with reason",
} as const

export const GOVERNANCE_VERSION = '6.7' as const  // legacy v6.x version string (retained for backward compat)
export const GOVERNANCE_UPDATED = '2026-07' as const

// ─── LEGACY (v6.0) — retained; no external importer, kept for reference ───────
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
