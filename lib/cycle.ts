/**
 * Atlas Core — Cycle Instruments (Art. IX)
 *
 * Pure-function computation module for cycle-aware decision support.
 * No DB access — all inputs passed as parameters.
 *
 * Exports:
 *   getCombinedTechCeiling — EQAC+SMH combined exposure vs Art. IX ceilings
 */

import { COMBINED_TECH_RULE } from "@/lib/constitution"

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
