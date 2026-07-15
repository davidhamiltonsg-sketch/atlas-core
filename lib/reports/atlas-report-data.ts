import { db } from "@/lib/db"
import { HARD_THRESHOLDS } from "@/lib/constants"
import { applyEconomicSleeves, type PositionInput } from "@/lib/next-best-move"
import { computeLadder, type LadderInstruction } from "@/lib/ladder"
import { computeLookThrough, worstLookThroughBreach, worstLookThroughApproach, type LookThroughResult } from "@/lib/look-through"
import { refreshedLookThroughData } from "@/lib/look-through-data"
import { computePortfolioHealth, type PortfolioHealth } from "@/lib/health"
import { evaluateGovernance, type GovAlignment } from "@/lib/governance-status"
import { CORE_DEFAULTS } from "@/lib/core-holdings"
import { PERIOD_MONTHS, PERIOD_LABEL, formatPeriodLabel, formatGeneratedOn, type ReportPeriod } from "@/lib/reports/pdf-theme"
import { buildPortfolioTimeline } from "@/lib/portfolio-metrics"

export interface AtlasReportPosition {
  ticker: string
  name: string
  color: string
  value: number
  actualPct: number
  targetPct: number
  drift: number
  status: "healthy" | "soft" | "hard"
  hardCapPct: number | null
}

export interface AtlasReportData {
  period: ReportPeriod
  periodLabel: string
  generatedOn: string
  totalValue: number
  periodAgoValue: number | null
  valueChangeAbs: number | null
  valueChangePct: number | null
  positions: AtlasReportPosition[]
  driftAlerts: number
  hardBreaches: number
  softBreaches: number
  maxDrift: number
  health: PortfolioHealth
  governance: GovAlignment
  lookThrough: LookThroughResult
  nextMove: LadderInstruction
}

/**
 * Aggregates everything an Atlas Core periodic report needs, reusing the same engines the
 * live dashboard uses (computeLadder, computeLookThrough, computePortfolioHealth,
 * evaluateGovernance) so the report can never disagree with what the app itself says.
 *
 * Simplification vs. the live dashboard: this does not fetch live market prices (Finnhub),
 * so the ladder recommendation here reflects allocation/drift/concentration/drawdown but not
 * the "near 52-week high, skip this month" market-timing nuance — acceptable for a periodic
 * summary rather than a real-time trading surface.
 */
export async function getAtlasReportData(userId: string, period: ReportPeriod): Promise<AtlasReportData> {
  const holdings = await db.holding.findMany({
    where: { userId },
    include: { snapshots: { orderBy: { date: "desc" } } },
  })

  const totalValue = holdings.reduce((sum, h) => sum + (h.snapshots[0]?.value ?? 0), 0)
  const hasBalance = totalValue > 0

  const rawPositions: PositionInput[] = holdings.map((h) => {
    const value = h.snapshots[0]?.value ?? 0
    const actualPct = totalValue > 0 ? (value / totalValue) * 100 : 0
    return {
      ticker: h.ticker,
      name: h.name,
      color: CORE_DEFAULTS[h.ticker]?.color ?? h.color,
      value,
      actualPct,
      targetPct: h.targetPct,
      hardCapPct: h.hardCapPct,
      toleranceBand: h.toleranceBand,
      latestPrice: h.snapshots[0]?.price ?? 0,
    }
  })
  const sleeved = applyEconomicSleeves(rawPositions)

  const positions: AtlasReportPosition[] = sleeved.map((p) => {
    const ht = HARD_THRESHOLDS[p.ticker]
    const drift = p.actualPct - p.targetPct
    const overCap = p.hardCapPct !== null && p.actualPct > p.hardCapPct
    const isHard = hasBalance && (overCap || (ht?.low !== undefined && p.actualPct < ht.low) || (ht !== undefined && p.actualPct > ht.high))
    const isSoft = hasBalance && !isHard && Math.abs(drift) > p.toleranceBand
    return {
      ticker: p.ticker, name: p.name, color: p.color, value: p.value,
      actualPct: p.actualPct, targetPct: p.targetPct, drift,
      status: isHard ? "hard" : isSoft ? "soft" : "healthy",
      hardCapPct: p.hardCapPct,
    }
  })

  const hardBreaches = positions.filter((p) => p.status === "hard").length
  const softBreaches = positions.filter((p) => p.status === "soft").length
  const driftAlerts = hardBreaches + softBreaches
  const maxDrift = positions.reduce((max, p) => Math.max(max, Math.abs(p.drift)), 0)

  // Period-ago comparison — nearest snapshot on or before the cutoff date, per holding.
  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - PERIOD_MONTHS[period])
  let periodAgoValue: number | null = null
  if (holdings.some((h) => h.snapshots.some((s) => s.date <= cutoff))) {
    periodAgoValue = holdings.reduce((sum, h) => {
      const snap = h.snapshots.find((s) => s.date <= cutoff)
      return sum + (snap?.value ?? 0)
    }, 0)
  }
  const valueChangeAbs = periodAgoValue !== null ? totalValue - periodAgoValue : null
  const valueChangePct = periodAgoValue !== null && periodAgoValue > 0 ? (valueChangeAbs! / periodAgoValue) * 100 : null

  // Drawdown from the all-time-high snapshot total, for the ladder's crash-protocol step.
  const totalsByDate = buildPortfolioTimeline(holdings).map(point=>point.value)
  let portfolioDrawdownPct: number | undefined
  if (totalsByDate.length >= 2) {
    const peak = Math.max(...totalsByDate)
    if (peak > 0 && totalValue < peak) portfolioDrawdownPct = ((totalValue - peak) / peak) * 100
  }

  const refreshedLt = await refreshedLookThroughData()
  const lookThrough = computeLookThrough(positions,new Date(),refreshedLt.updatedAt,refreshedLt.weights)
  const lookThroughBreach = worstLookThroughBreach(lookThrough)
  const lookThroughHardBreach = lookThroughBreach
    ? { label: lookThroughBreach.label, pct: lookThroughBreach.pct, hard: lookThroughBreach.hard, trimTicker: null }
    : undefined
  const ltApproach = worstLookThroughApproach(lookThrough)
  const lookThroughSoftWarning = ltApproach
    ? { label: ltApproach.label, pct: ltApproach.pct, soft: ltApproach.soft }
    : undefined

  const companyHardBreaches = lookThrough.companies.filter((c) => c.status === "breach").length
  const sectorHardBreaches = lookThrough.sectors.filter((s) => s.status === "breach").length

  const [activeRules, totalRules] = await Promise.all([
    db.governanceRule.count({ where: { active: true } }),
    db.governanceRule.count(),
  ])
  const latestSnapshotDate = holdings.reduce<Date | null>((latest, h) => {
    const d = h.snapshots[0]?.date
    return d && (h.snapshots[0]?.value??0)>0 && (!latest || d < latest) ? d : latest
  }, null)
  const snapshotAgeDays = latestSnapshotDate ? Math.floor((Date.now() - latestSnapshotDate.getTime()) / 86_400_000) : 999

  const health = computePortfolioHealth({
    hardBreaches, softBreaches, maxDrift, companyHardBreaches, sectorHardBreaches,
    activeRules, totalRules, snapshotAgeDays,
  })

  const governance = evaluateGovernance({
    positions,
    bufferPct: 0,
    lookThrough,
  })

  const ladderInput: PositionInput[] = sleeved.map((p) => ({ ...p }))
  const nextMove = computeLadder(ladderInput, totalValue, {
    lookThroughHardBreach,
    lookThroughSoftWarning,
    portfolioDrawdownPct,
  })

  const now = new Date()

  return {
    period,
    periodLabel: `${PERIOD_LABEL[period]} — ${formatPeriodLabel(period, now)}`,
    generatedOn: formatGeneratedOn(now),
    totalValue, periodAgoValue, valueChangeAbs, valueChangePct,
    positions, driftAlerts, hardBreaches, softBreaches, maxDrift,
    health, governance, lookThrough, nextMove,
  }
}
