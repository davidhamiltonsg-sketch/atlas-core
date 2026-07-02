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
  citation: string    // Art. XXII: cite the governing article for each dimension
  status: "excellent" | "good" | "caution" | "critical"
}

export interface PortfolioHealth {
  overall: number
  overallLabel: string
  structural: DimensionScore
  behavioural: DimensionScore
  concentration: DimensionScore
  freshness: DimensionScore
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
  uncorrectedViolations,
}: {
  hardBreaches: number
  softBreaches: number
  maxDrift: number
  companyHardBreaches?: number
  sectorHardBreaches?: number
  activeRules: number
  totalRules: number
  snapshotAgeDays: number
  // Art. XXII: count of GovernanceLog EXCEPTION_LOGGED entries without a
  // subsequent corrective action for the same ruleId. When provided, this
  // replaces the activeRules/totalRules fallback for the behavioural score.
  uncorrectedViolations?: number
}): PortfolioHealth {

  // ── Structural (Art. VI–IX): allocation drift and tolerance breaches ─────
  const structural = Math.max(0, Math.round(
    100 - hardBreaches * 20 - softBreaches * 8 - maxDrift * 1.2
  ))

  // ── Behavioural (Art. XII–XIV): only uncorrected violations score ────────
  // When uncorrectedViolations is provided (from GovernanceLog), each open
  // exception deducts 20 points. Falls back to activeRules ratio otherwise.
  const behavioural = uncorrectedViolations !== undefined
    ? Math.max(0, Math.round(100 - uncorrectedViolations * 20))
    : totalRules > 0
      ? Math.min(100, Math.round((activeRules / totalRules) * 100))
      : 100

  // ── Concentration (Art. IX): ONLY hard-cap breaches penalised ────────────
  // Governed concentration (within hard caps) is intentional — not a risk.
  const concentration = Math.max(0, Math.round(
    100 - companyHardBreaches * 15 - sectorHardBreaches * 12 - hardBreaches * 5
  ))

  // ── Execution (Art. XIII): data freshness / snapshot discipline ──────────
  const execution =
    snapshotAgeDays <= 3  ? 100 :
    snapshotAgeDays <= 7  ? 95  :
    snapshotAgeDays <= 14 ? 85  :
    snapshotAgeDays <= 30 ? 70  :
    snapshotAgeDays <= 60 ? 45  : 20

  // ── Overall: weighted composite (weights per Art. XXII) ──────────────────
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
      citation: "Art. VI–IX",
      status: dimStatus(structural),
    },
    behavioural: {
      score: behavioural,
      label: "Behavioural",
      description: "Governance compliance",
      citation: "Art. XII–XIV",
      status: dimStatus(behavioural),
    },
    concentration: {
      score: concentration,
      label: "Concentration",
      description: "Dependency risk",
      citation: "Art. IX",
      status: dimStatus(concentration),
    },
    freshness: {
      score: execution,
      label: "Freshness",
      description: "Data freshness",
      citation: "Art. XXII",
      status: dimStatus(execution),
    },
  }
}
