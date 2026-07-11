/**
 * Atlas Core — Cycle Instruments (Art. XIII, XIV)
 *
 * Pure-function computation module for cycle-aware decision support.
 * No DB access — all inputs passed as parameters.
 * Imported by the cockpit home screen and governance page.
 *
 * Exports:
 *   getBtcPhaseCard     — current BTC cycle phase, target, cap, bull window countdown
 *   getSemiBuyZone      — SEMI cycle position and skip-rule status
 *   getCombinedTechCeiling — EQQQ+SEMI combined exposure vs Art. IX ceilings
 *   getSkipRuleRadar    — per-position skip-rule applicability
 *   getSgovQueueState   — months to SGOV floor at current contribution rate (Art. XIII §5)
 */

import {
  getBtcCyclePhase,
  getBtcModifier,
  getSemiCyclePhase,
  getSemiSoftBand,
  COMBINED_TECH_RULE,
  BEHAVIORAL_RULES,
  type BtcCyclePhase,
  type SemiCyclePhase,
} from "@/lib/constitution"

// ── BTC Phase Card (Art. VIII) ───────────────────────────────────────────────
export interface BtcPhaseCard {
  phase: BtcCyclePhase
  label: string
  target: number        // % of NAV for this cycle phase
  hardCap: number       // hard cap % of NAV
  softHigh: number      // soft ceiling % of NAV
  rationale: string
  monthsSinceHalving: number
  daysUntilBullEnd: number | null  // null if not currently in bull phase
}

export function getBtcPhaseCard(
  btcPriceVsCycleHigh?: number,
  manualOverride?: BtcCyclePhase,
): BtcPhaseCard {
  const modifier = getBtcModifier(btcPriceVsCycleHigh, manualOverride)
  const halvingDate = new Date(2024, 3, 19)  // 2024-04-19 (local)
  const now = new Date()
  const monthsSinceHalving = Math.floor(
    (now.getFullYear() - halvingDate.getFullYear()) * 12 +
    (now.getMonth() - halvingDate.getMonth()),
  )
  // Bull window ends at the 24-month mark (2026-04-19)
  const bullEndDate = new Date(halvingDate.getFullYear() + 2, halvingDate.getMonth(), halvingDate.getDate())
  const daysUntilBullEnd = modifier.phase === "post_halving_bull"
    ? Math.max(0, Math.round((bullEndDate.getTime() - now.getTime()) / 86_400_000))
    : null
  return {
    phase:               modifier.phase,
    label:               modifier.label,
    target:              modifier.target,
    hardCap:             modifier.hardHigh,
    softHigh:            modifier.softHigh,
    rationale:           modifier.rationale,
    monthsSinceHalving,
    daysUntilBullEnd,
  }
}

// ── SEMI Buy Zone (Art. XIV) ─────────────────────────────────────────────────
export interface SemiBuyZone {
  phase: SemiCyclePhase
  label: string
  signal: string
  pctFromHigh: number     // (price / hi52) - 1; negative = below high
  isBuyWindow: boolean    // true when not at cycle top (phase !== "top")
  isSkipRule: boolean     // true when within 3% of 52w high (Art. XIII step 7 would skip)
  pctToHigh: number       // % gain needed to reach 52w high
}

export function getSemiBuyZone(price: number, hi52: number): SemiBuyZone {
  const pctFromHigh = hi52 > 0 ? (price - hi52) / hi52 : -1
  const phase       = getSemiCyclePhase(pctFromHigh)
  const band        = getSemiSoftBand(pctFromHigh)
  return {
    phase,
    label:       band.label,
    signal:      band.signal,
    pctFromHigh,
    isBuyWindow: phase !== "top",
    isSkipRule:  pctFromHigh > -BEHAVIORAL_RULES.nearHighThreshold,
    pctToHigh:   hi52 > 0 ? (hi52 - price) / price : 0,
  }
}

// ── Combined Tech Ceiling (Art. IX) ─────────────────────────────────────────
export type CeilingStatus = "clear" | "soft_breach" | "hard_breach"

export interface CombinedTechCeiling {
  qqqmPct: number
  smhPct: number
  combinedPct: number
  softCeiling: number
  hardCeiling: number
  status: CeilingStatus
  headroom: number      // % below next breach level (negative when over)
  label: string
}

export function getCombinedTechCeiling(qqqmPct: number, smhPct: number): CombinedTechCeiling {
  const combined      = qqqmPct + smhPct
  const { softCeiling, hardCeiling } = COMBINED_TECH_RULE
  const status: CeilingStatus =
    combined >= hardCeiling ? "hard_breach" :
    combined >= softCeiling ? "soft_breach" :
    "clear"
  const headroom =
    combined >= hardCeiling ? hardCeiling - combined :
    combined >= softCeiling ? hardCeiling - combined :
    softCeiling - combined
  const label =
    status === "hard_breach" ? `Hard breach — ${combined.toFixed(1)}% (cap ${hardCeiling}%)` :
    status === "soft_breach" ? `Soft breach — ${combined.toFixed(1)}% (flag ≥${softCeiling}%)` :
    `Clear — ${combined.toFixed(1)}% (soft ceiling ${softCeiling}%)`
  return { qqqmPct, smhPct, combinedPct: combined, softCeiling, hardCeiling, status, headroom, label }
}

// ── Skip-Rule Radar (Art. XIII step 7) ───────────────────────────────────────
// Reports which positions would be skipped under Art. XIII step 7 B1.
// VWRA is exempt: it is always the DCA destination and is never skipped.
export interface SkipRuleEntry {
  ticker: string
  price: number
  hi52: number
  pctFromHigh: number
  isNearHigh: boolean   // within NEAR_HIGH_THRESHOLD of 52w high
  isExempt: boolean     // VWRA is exempt — never skipped
  wouldSkip: boolean    // isNearHigh && !isExempt
}

const SKIP_EXEMPT = new Set(["VWRA"])

export function getSkipRuleRadar(
  positions: ReadonlyArray<{ ticker: string; price: number; hi52: number }>,
): SkipRuleEntry[] {
  return positions.map(({ ticker, price, hi52 }) => {
    const pctFromHigh = hi52 > 0 ? (price - hi52) / hi52 : -1
    const isNearHigh  = pctFromHigh > -BEHAVIORAL_RULES.nearHighThreshold
    const isExempt    = SKIP_EXEMPT.has(ticker)
    return { ticker, price, hi52, pctFromHigh, isNearHigh, isExempt, wouldSkip: isNearHigh && !isExempt }
  })
}

// ── SGOV Build Queue (Art. XIII §5) ─────────────────────────────────────────
// Months needed to reach the 8% SGOV floor at the current monthly contribution
// rate, assuming all contributions go to SGOV until the floor is met.
export interface SgovQueueState {
  currentPct: number
  floorPct: number              // 8% per Art. XIII §5
  gapPct: number                // floorPct - currentPct; negative = already at floor
  portfolioValueSgd: number
  gapSgd: number                // SGD value of the gap (0 when already at floor)
  monthlyContributionSgd: number
  monthsToFloor: number | null  // null if already at/above floor or contribution is 0
  isAtFloor: boolean
}

const SGOV_FLOOR_PCT = 8

export function getSgovQueueState({
  currentPct,
  portfolioValueSgd,
  monthlyContributionSgd,
}: {
  currentPct: number
  portfolioValueSgd: number
  monthlyContributionSgd: number
}): SgovQueueState {
  const gapPct    = SGOV_FLOOR_PCT - currentPct
  const gapSgd    = Math.max(0, (gapPct / 100) * portfolioValueSgd)
  const monthsToFloor =
    gapPct > 0 && monthlyContributionSgd > 0
      ? Math.ceil(gapSgd / monthlyContributionSgd)
      : null
  return {
    currentPct,
    floorPct:               SGOV_FLOOR_PCT,
    gapPct,
    portfolioValueSgd,
    gapSgd,
    monthlyContributionSgd,
    monthsToFloor,
    isAtFloor:              currentPct >= SGOV_FLOOR_PCT,
  }
}
