/**
 * Atlas Core — Portfolio Health Engine v2
 *
 * Four independent dimensions, each 0–100, combined into an overall score.
 *
 * Key principle: governed concentration (within hard caps) is NOT pathological.
 * Only unmanaged breaches (outside hard caps) penalise the concentration score.
 */

export interface DimensionScore {
  score: number
  label: string
  description: string
  status: "excellent" | "good" | "caution" | "critical"
}

export interface PortfolioHealth {
  overall: number
  overallLabel: string
  structural: DimensionScore
  behavioural: DimensionScore
  concentration: DimensionScore
  execution: DimensionScore
}

function dimStatus(score: number): "excellent" | "good" | "caution" | "critical" {
  if (score >= 90) return "excellent"
  if (score >= 75) return "good"
  if (score >= 55) return "caution"
  return "critical"
}

export function computePortfolioHealth({
  hardBreaches,
  softBreaches,
  maxDrift,
  companyHardBreaches = 0,
  sectorHardBreaches = 0,
  activeRules,
  totalRules,
  snapshotAgeDays,
}: {
  hardBreaches: number
  softBreaches: number
  maxDrift: number
  companyHardBreaches?: number
  sectorHardBreaches?: number
  activeRules: number
  totalRules: number
  snapshotAgeDays: number
}): PortfolioHealth {

  // ── Structural: allocation drift and tolerance breaches ──────────────────
  const structural = Math.max(0, Math.round(
    100 - hardBreaches * 20 - softBreaches * 8 - maxDrift * 1.2
  ))

  // ── Behavioural: governance rules compliance ─────────────────────────────
  // 100% if all rules active. Deactivated rules reduce score proportionally.
  const behavioural = totalRules > 0
    ? Math.min(100, Math.round((activeRules / totalRules) * 100))
    : 100

  // ── Concentration: ONLY hard-cap breaches penalised ──────────────────────
  // Governed concentration (within hard caps) is intentional — not a risk.
  // Soft-cap exposure at position level is already captured in structural.
  const concentration = Math.max(0, Math.round(
    100 - companyHardBreaches * 15 - sectorHardBreaches * 12 - hardBreaches * 5
  ))

  // ── Execution: data freshness / snapshot discipline ──────────────────────
  const execution =
    snapshotAgeDays <= 3  ? 100 :
    snapshotAgeDays <= 7  ? 95  :
    snapshotAgeDays <= 14 ? 85  :
    snapshotAgeDays <= 30 ? 70  :
    snapshotAgeDays <= 60 ? 45  : 20

  // ── Overall: weighted composite ──────────────────────────────────────────
  const overall = Math.round(
    structural    * 0.40 +
    behavioural   * 0.25 +
    concentration * 0.25 +
    execution     * 0.10
  )

  const overallLabel =
    overall >= 80 ? "Good standing" :
    overall >= 65 ? "Review recommended" :
    "Action required"

  return {
    overall,
    overallLabel,
    structural: {
      score: structural,
      label: "Structural",
      description: "Allocation integrity",
      status: dimStatus(structural),
    },
    behavioural: {
      score: behavioural,
      label: "Behavioural",
      description: "Governance compliance",
      status: dimStatus(behavioural),
    },
    concentration: {
      score: concentration,
      label: "Concentration",
      description: "Dependency risk",
      status: dimStatus(concentration),
    },
    execution: {
      score: execution,
      label: "Freshness",
      description: "Snapshot freshness",
      status: dimStatus(execution),
    },
  }
}
