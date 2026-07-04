import { db } from "@/lib/db"
import { buildPortfolioTimeline } from "@/lib/portfolio-metrics"
import { SILICON_BRICK_ROAD as SBR } from "@/lib/constitutions"
import { computeSbrNextMove, computeSbrHealth, sbrPhase, type SbrPosition, type SbrHealth } from "@/lib/sbr-engine"
import { computeSbrLookThrough, SBR_TECHNOLOGY_LIMIT, SBR_SINGLE_COMPANY_LIMIT, type SbrLookThrough } from "@/lib/sbr-look-through"
import { evaluateSbrGovernance } from "@/lib/sbr-governance"
import type { NextMove } from "@/lib/next-best-move"
import type { GovAlignment } from "@/lib/governance-status"
import { PERIOD_MONTHS, PERIOD_LABEL, formatPeriodLabel, formatGeneratedOn, type ReportPeriod } from "@/lib/reports/pdf-theme"

const SBR_FUND_TICKERS = SBR.funds.map((f) => f.ticker)

export interface SbrReportPosition {
  ticker: string
  name: string
  color: string
  value: number
  actualPct: number
  targetPct: number
  drift: number
  status: "healthy" | "soft" | "hard"
}

export interface SbrReportData {
  period: ReportPeriod
  periodLabel: string
  generatedOn: string
  totalValue: number
  periodAgoValue: number | null
  valueChangeAbs: number | null
  valueChangePct: number | null
  positions: SbrReportPosition[]
  driftAlerts: number
  hardBreaches: number
  softBreaches: number
  maxDrift: number
  health: SbrHealth
  governance: GovAlignment
  lookThrough: SbrLookThrough
  nextMove: NextMove
  phaseLabel: string
}

/**
 * Aggregates everything a Silicon Brick Road periodic report needs, reusing the same
 * engines the live dashboard uses (computeSbrNextMove, computeSbrHealth,
 * computeSbrLookThrough, evaluateSbrGovernance) so the report can never disagree with
 * what the app itself says.
 *
 * Self-contained and isolated: SBR tickers only, no Atlas Core coupling.
 *
 * Simplification vs. the live dashboard: this does not fetch live fund prices (Finnhub/
 * Yahoo), so — same as the Atlas Core report — the recommendation here reflects
 * allocation/drift/phase/drawdown but not the "near 52-week high, skip this month"
 * timing nuance. Acceptable for a periodic summary rather than a real-time surface.
 */
export async function getSbrReportData(userId: string, period: ReportPeriod): Promise<SbrReportData> {
  const holdings = await db.holding.findMany({
    where: { userId, ticker: { in: SBR_FUND_TICKERS } },
    include: { snapshots: { orderBy: { date: "desc" } } },
  })

  const fundOrder = SBR.funds.map((f) => f.ticker)
  const holdingsSorted = [...holdings].sort((a, b) => fundOrder.indexOf(a.ticker) - fundOrder.indexOf(b.ticker))
  const totalValue = holdingsSorted.reduce((sum, h) => sum + (h.snapshots[0]?.value ?? 0), 0)
  const hasBalance = totalValue > 0

  const positions: SbrPosition[] = holdingsSorted.map((h) => {
    const fund = SBR.funds.find((f) => f.ticker === h.ticker)
    const value = h.snapshots[0]?.value ?? 0
    const actualPct = totalValue > 0 ? (value / totalValue) * 100 : 0
    return {
      ticker: h.ticker, name: h.name, color: fund?.color ?? h.color, value, actualPct,
      targetPct: h.targetPct, rangeLow: fund?.rangeLow ?? h.targetPct - h.toleranceBand,
      rangeHigh: fund?.rangeHigh ?? h.targetPct + h.toleranceBand, hardCap: h.hardCapPct,
      floor: fund?.floor, latestPrice: h.snapshots[0]?.price ?? 0, hi52: 0,
    }
  })

  const reportPositions: SbrReportPosition[] = positions.map((p) => {
    const drift = p.actualPct - p.targetPct
    const isHard = hasBalance && ((p.hardCap !== null && p.actualPct > p.hardCap) || (p.floor !== undefined && p.actualPct < p.floor))
    const isSoft = hasBalance && !isHard && (p.actualPct < p.rangeLow || p.actualPct > p.rangeHigh)
    return {
      ticker: p.ticker, name: p.name, color: p.color, value: p.value,
      actualPct: p.actualPct, targetPct: p.targetPct, drift,
      status: isHard ? "hard" : isSoft ? "soft" : "healthy",
    }
  })

  const hardBreaches = reportPositions.filter((p) => p.status === "hard").length
  const softBreaches = reportPositions.filter((p) => p.status === "soft").length
  const driftAlerts = hardBreaches + softBreaches
  const maxDrift = reportPositions.reduce((max, p) => Math.max(max, Math.abs(p.drift)), 0)

  // Period-ago comparison — nearest snapshot on or before the cutoff date, per holding.
  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - PERIOD_MONTHS[period])
  let periodAgoValue: number | null = null
  if (holdingsSorted.some((h) => h.snapshots.some((s) => s.date <= cutoff))) {
    periodAgoValue = holdingsSorted.reduce((sum, h) => {
      const snap = h.snapshots.find((s) => s.date <= cutoff)
      return sum + (snap?.value ?? 0)
    }, 0)
  }
  const valueChangeAbs = periodAgoValue !== null ? totalValue - periodAgoValue : null
  const valueChangePct = periodAgoValue !== null && periodAgoValue > 0 ? (valueChangeAbs! / periodAgoValue) * 100 : null

  // Drawdown from the portfolio's own peak, for the same drawdown-deploy step the dashboard uses.
  const timeline = buildPortfolioTimeline(holdingsSorted)
  let drawdownPct: number | undefined
  if (timeline.length >= 2) {
    const peak = Math.max(...timeline.map((t) => t.value))
    if (peak > 0 && totalValue < peak) drawdownPct = ((totalValue - peak) / peak) * 100
  }

  const latest = holdingsSorted.reduce<Date | null>((latestDate, h) => {
    const d = h.snapshots[0]?.date
    return d && (!latestDate || d > latestDate) ? d : latestDate
  }, null)
  const snapshotAgeDays = latest ? Math.floor((Date.now() - new Date(latest).getTime()) / 86_400_000) : 999

  const health = computeSbrHealth(positions, totalValue, snapshotAgeDays)
  const governance = evaluateSbrGovernance(positions, totalValue)
  const lookThrough = computeSbrLookThrough(positions)
  const nextMove = computeSbrNextMove(positions, totalValue, { drawdownPct })
  const phase = sbrPhase(totalValue)

  const now = new Date()

  return {
    period,
    periodLabel: `${PERIOD_LABEL[period]} — ${formatPeriodLabel(period, now)}`,
    generatedOn: formatGeneratedOn(now),
    totalValue, periodAgoValue, valueChangeAbs, valueChangePct,
    positions: reportPositions, driftAlerts, hardBreaches, softBreaches, maxDrift,
    health, governance, lookThrough, nextMove,
    phaseLabel: phase.label,
  }
}

export { SBR_TECHNOLOGY_LIMIT, SBR_SINGLE_COMPANY_LIMIT }
