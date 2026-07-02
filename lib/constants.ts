import { ATLAS_SPEC } from "@/lib/portfolio-spec"

/**
 * Atlas Core — Governance Constants
 *
 * The raw source of record for every rule value: allocation targets, position hard caps,
 * drift bands, the BTC halving-cycle modifier (§4.1), the SMH cycle-aware soft band (§4.2),
 * and the combined QQQM+SMH tech-concentration ceiling (§4.3). Hard caps are static; only
 * the soft bands float — the one exception is BTC's hard cap, which moves by cycle phase.
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
// Derived from the single source (lib/portfolio-spec.ts) — SGOV is a buffer, not a target row.
export const TICKER_TARGETS: Record<string, number> = Object.fromEntries(
  ATLAS_SPEC.funds.filter((f) => f.ticker !== "SGOV").map((f) => [f.ticker, f.target]),
)

// Hard drift thresholds — whole-number percent. Position hard caps live in Art. VII
// (VT 60%); the drift bands (soft/hard triggers, SMH amber zone) live in Art. VIII.
// BTC has no lower hard trigger — underweight is soft-alert only (it's a held
// conviction asset: accumulate on weakness toward target, never sold at a loss).
// SMH hard cap 12% (Principle 04). SMH amberHigh=11 adds a soft amber
// zone 11–12% (Art. VII); display shows green <11%, amber 11–12%, red ≥12%.
// BTC.high tracks the CURRENT cycle phase (Normal = 8% as of Jun 2026). The full
// floating ladder lives in BTC_CYCLE_MODIFIERS (§4.1) and is surfaced in Governance.
// amberHigh?: if set, the amber/soft zone is (amberHigh, high]; healthy zone is (hardLow, amberHigh].
// Derived from the single source (lib/portfolio-spec.ts). Key order (low, high, amberHigh) is
// preserved so the JSON-compare contract checks stay byte-identical. SGOV (cap null) is excluded.
export const HARD_THRESHOLDS: Record<string, { low?: number; high: number; amberHigh?: number }> =
  Object.fromEntries(
    ATLAS_SPEC.funds.filter((f) => f.ticker !== "SGOV").map((f) => [
      f.ticker,
      {
        ...(f.driftLow !== undefined ? { low: f.driftLow } : {}),
        high: f.hardCap as number,
        ...(f.amberHigh !== undefined ? { amberHigh: f.amberHigh } : {}),
      },
    ]),
  )

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

// Art. X: the cap NEVER WIDENS on a cycle forecast — that would operationalise a market
// prediction the doctrine (Art. XXV) rejects. It holds at 8% and only TIGHTENS defensively
// (to 6%) in a deep drawdown, which is prudence, not forecasting. The post-halving-bull
// phase holds the cap at 8%; it is retained only so the cockpit can label the phase.
// Target is a constant 7% (matches Art. VI).
export const BTC_CYCLE_MODIFIERS: Record<BtcCyclePhase, BtcCycleModifier> = {
  post_halving_bull: {
    phase: 'post_halving_bull', hardHigh: 8, target: 7, softHigh: 8,
    label: 'Post-Halving Bull',
    rationale: '12–24 months post-halving. Cap held at 8% — it does not widen on the cycle.',
  },
  normal: {
    phase: 'normal', hardHigh: 8, target: 7, softHigh: 8,
    label: 'Normal',
    rationale: 'Standard governance. No halving catalyst active.',
  },
  bear: {
    phase: 'bear', hardHigh: 6, target: 5, softHigh: 5.5,
    label: 'Bear / Risk-Off',
    rationale: 'BTC drawdown >50% from cycle high. Cap tightens defensively — protection, not a forecast.',
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
    // The pullback widens the buy zone only on the LOW side (accumulate down to 5%).
    // The upper bound stays clamped to the 12% hard cap (Art. VII) — the cap never moves,
    // so healthyHigh/softHigh may never exceed it. See Art. XI accumulation precedence.
    phase: 'bottom', softLow: 5, softHigh: 12, healthyLow: 7, healthyHigh: 12,
    label: 'Cycle Bottom',
    signal: 'SMH >20% off 52-week high. Buy zone widens on the downside — accumulate toward the 12% cap.',
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

// ─── §4.3 — COMBINED TECH CONCENTRATION RULE ─────────────────────────────────
// Display/governance rule. QQQM+SMH combined exposure as a whole-number percent.
export const COMBINED_TECH_RULE = {
  tickers:     ['QQQM', 'SMH'] as const,
  softCeiling: ATLAS_SPEC.combinedTech.soft,  // derived from lib/portfolio-spec.ts
  hardCeiling: ATLAS_SPEC.combinedTech.hard,
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

// ─── OPERATING ASSUMPTIONS & SAFEGUARDS ──────────────────────────────────────
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

// ─── COMMAND CENTRE — market-aware governance overlays ───────────────────────
// Market-condition-aware rules that complement the Section 3 drift bands with overlays
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

// Art. XIV crash threshold: a drawdown at or beyond this (negative %) from the tracked
// all-time high triggers the crash protocol (A2 — keep contributing, never redesign).
// Single source of record so the Art. XIII ladder and the next-best-move engine agree.
export const CRASH_DRAWDOWN_PCT = -25
