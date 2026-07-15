import { ATLAS_SPEC } from "@/lib/portfolio-spec"
import { GOVERNED_LINE_ALIASES } from "@/lib/instrument-identity"

/**
 * Atlas Core — Governance Constants
 *
 * The raw source of record for every rule value: allocation targets, position hard caps,
 * drift bands, and the combined EQAC+SMH tech-concentration ceiling (§4.3).
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
// Bitcoin sleeve = IBIT plus any temporary GBTC legacy exposure, combined at 5%.
// This is an economic grouping only; instrument history and cost basis are never merged.
// Derived from the single source (lib/portfolio-spec.ts) — SGOV is a buffer, not a target row.
export const TICKER_TARGETS: Record<string, number> = Object.fromEntries(
  ATLAS_SPEC.funds.filter((f) => f.ticker !== "SGOV").map((f) => [f.ticker, f.target]),
)

// Hard drift thresholds — whole-number percent. Position hard caps live in Art. VII
// (VWRA 80%); the drift bands (soft/hard triggers) live in Art. VIII.
// BTC has no lower hard trigger — underweight is soft-alert only (it's a held
// conviction asset: accumulate on weakness toward target, never sold at a loss).
// SMH hard cap 10% (Art. VII). BTC hard cap 8%.
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
  VWRA: { band: 5, classification: "Global Market Core",       color: "#7c3aed" },
  EQAC: { band: 2.5, classification: "Nasdaq Growth Tilt",     color: "#a78bfa" },
  SMH:  { band: 1.25, classification: "Semiconductor Satellite", color: "#c026d3" },
  BTC:  { band: 1.25, classification: "Bitcoin — IBIT",        color: "#f59e0b" },
  DBMFE:{ band: 2.5, classification: "Managed Futures",        color: "#10b981" },
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
  (["VWRA", "EQAC", "SMH", "BTC", "DBMFE"] as const)
    .map(getGovernanceBandRow)
    .filter((r): r is GovernanceBandRow => r !== null)

// ─── §4.3 — COMBINED TECH CONCENTRATION RULE ─────────────────────────────────
// Display/governance rule. EQQQ+SEMI combined exposure as a whole-number percent.
export const COMBINED_TECH_RULE = {
  tickers:     ['EQAC', 'SMH'] as const,
  softCeiling: ATLAS_SPEC.combinedTech.soft,  // derived from lib/portfolio-spec.ts
  hardCeiling: ATLAS_SPEC.combinedTech.hard,
  label:       'Combined Tech Concentration',
  rationale:   'EQAC+SMH combined exposure. Semiconductor overlap means individual caps understate concentration risk.',
  action: {
    soft: `Flag for review. No new EQAC or SMH buys until combined falls below the ${ATLAS_SPEC.combinedTech.soft}% watch level.`,
    hard: `Halt all EQAC and SMH contributions until combined falls below the ${ATLAS_SPEC.combinedTech.hard}% cap. Review at next monthly cycle.`,
  },
} as const

// ─── Bitcoin sleeve constants (Art. VIII) ────────────────────────────────────
// BTC and IBIT are ONE economic exposure (Bitcoin). BTC is in run-off (held, not bought);
// IBIT is the accumulation vehicle. New Bitcoin money always flows to IBIT.
// Combined sleeve target 5%; the 8% hard cap lives in HARD_THRESHOLDS (from the spec).
export const BITCOIN_TICKERS = ["BTC", "IBIT"] as const
export const BITCOIN_SLEEVE_TARGET_PCT = 5
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

/**
 * Generalized economic-sleeve transition model (identity over ticker):
 *  — Bitcoin sleeve: BTC runs off, IBIT accumulates toward the combined 5% target
 *    (applyBitcoinSleeve above; GBTC remains a genuine legacy instrument).
 *  — Governed-line aliases (EQQQ→EQAC, SEMI→SMH): the alias row is the SAME
 *    instrument (same ISIN) on another exchange line. It holds in place
 *    (effective target = its current weight, no buy/sell pressure) while the
 *    governed line accumulates toward the REMAINDER of the sleeve target — so
 *    the sleeve's combined weight is what gets judged against the constitution.
 * Storage, cost basis and history always retain the original instrument rows.
 */
export function applyEconomicSleeves<T extends { ticker: string; actualPct: number; targetPct: number }>(
  positions: T[]
): T[] {
  let out = applyBitcoinSleeve(positions)
  for (const [alias, governedTicker] of Object.entries(GOVERNED_LINE_ALIASES)) {
    const aliasActual = out.filter((p) => p.ticker === alias).reduce((s, p) => s + p.actualPct, 0)
    if (aliasActual <= 0 || !out.some((p) => p.ticker === governedTicker)) continue
    // The governed line's remainder is derived from the CONSTITUTIONAL target (spec), not
    // the row's current targetPct — so the transform is idempotent: pages can bake the
    // effective target into engine inputs and the engines can safely apply it again.
    const sleeveTarget = TICKER_TARGETS[governedTicker]
    out = out.map((p) =>
      p.ticker === alias ? { ...p, targetPct: p.actualPct }
      : p.ticker === governedTicker && sleeveTarget !== undefined ? { ...p, targetPct: Math.max(0, sleeveTarget - aliasActual) }
      : p
    )
  }
  return out
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

// SGOV yield — ILLUSTRATIVE; update annually if rates move more than 1% (last verified Jun 2026)
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
  // Art. XV: above USD 100k, a mandatory REVIEW is triggered — migration to Irish UCITS is the
  // expected outcome but must be confirmed against current law, IBKR availability, and tax advice
  // before executing. "Mandatory review" not "mandatory execution" because laws change.
  usEstateTaxTriggerUsd:    60_000,   // Art. XV: warn — estate-tax risk begins
  ucitsMandatoryTriggerUsd: 100_000,  // Art. XV: mandatory review — migration to UCITS is expected but must be confirmed first
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
