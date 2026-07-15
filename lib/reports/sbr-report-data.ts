import { db } from "@/lib/db"
import { getExternalLiquidityVerified } from "@/lib/external-liquidity"
import { buildPortfolioTimeline } from "@/lib/portfolio-metrics"
import { SILICON_BRICK_ROAD as SBR } from "@/lib/constitutions"
import { computeSbrNextMove, computeSbrHealth, type SbrPosition, type SbrHealth } from "@/lib/sbr-engine"
import { computeSbrLookThrough, SBR_TECHNOLOGY_LIMIT, SBR_SINGLE_COMPANY_LIMIT, type SbrLookThrough } from "@/lib/sbr-look-through"
import { refreshedLookThroughData } from "@/lib/look-through-data"
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
  const [holdings,lookThroughSources,liquidityVerified] = await Promise.all([
    db.holding.findMany({ where: { userId }, include: { snapshots: { orderBy: { date: "desc" } } } }),
    db.etfLookThrough.findMany({ where: { ticker: { in: SBR_FUND_TICKERS } }, select: { ticker: true, updatedAt: true } }),
    getExternalLiquidityVerified(userId),
  ])

  const fundOrder = SBR.funds.map((f) => f.ticker)
  const orderOf=(ticker:string)=>{const i=fundOrder.indexOf(ticker);return i<0?Number.MAX_SAFE_INTEGER:i}
  const holdingsSorted = [...holdings].sort((a, b) => orderOf(a.ticker) - orderOf(b.ticker))
  const totalValue = holdingsSorted.reduce((sum, h) => sum + (h.snapshots[0]?.value ?? 0), 0)
  const hasBalance = totalValue > 0

  const positions: SbrPosition[] = holdingsSorted.filter(h=>SBR_FUND_TICKERS.includes(h.ticker)).map((h) => {
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

  const reportPositions: SbrReportPosition[] = holdingsSorted.map((h) => {
    const p=positions.find(x=>x.ticker===h.ticker)
    const value=h.snapshots[0]?.value??0
    const actualPct=totalValue>0?value/totalValue*100:0
    const targetPct=p?.targetPct??0
    const drift = actualPct-targetPct
    const isHard = hasBalance && (!p || ((p.hardCap !== null && actualPct > p.hardCap) || (p.floor !== undefined && actualPct < p.floor)))
    const isSoft = hasBalance && !!p && !isHard && (actualPct < p.rangeLow || actualPct > p.rangeHigh)
    return {
      ticker: h.ticker, name: h.name, color: p?.color??h.color, value,
      actualPct, targetPct, drift,
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
    return d && (h.snapshots[0]?.value??0)>0 && (!latestDate || d < latestDate) ? d : latestDate
  }, null)
  const snapshotAgeDays = latest ? Math.floor((Date.now() - new Date(latest).getTime()) / 86_400_000) : 999

  const health = computeSbrHealth(positions, totalValue, snapshotAgeDays, SBR, liquidityVerified)
  const lookThroughAsOf=lookThroughSources.length===SBR_FUND_TICKERS.length?new Date(Math.min(...lookThroughSources.map(x=>x.updatedAt.getTime()))):new Date(0)
  const refreshedLt = await refreshedLookThroughData()
  const lookThrough = computeSbrLookThrough(positions,new Date(),lookThroughAsOf,refreshedLt.weights)
  const excludedPct=totalValue>0?Math.max(0,100-positions.reduce((s,p)=>s+p.actualPct,0)):0
  if(excludedPct>0.005){lookThrough.unclassifiedPct+=excludedPct;lookThrough.warnings.unshift(`${excludedPct.toFixed(1)}% of NAV is outside the target universe and is included as unclassified.`)}
  const governance = evaluateSbrGovernance(positions, totalValue,lookThroughAsOf,new Date(),lookThrough)
  const nextMove = computeSbrNextMove(positions, totalValue, { drawdownPct })

  const now = new Date()

  return {
    period,
    periodLabel: `${PERIOD_LABEL[period]} — ${formatPeriodLabel(period, now)}`,
    generatedOn: formatGeneratedOn(now),
    totalValue, periodAgoValue, valueChangeAbs, valueChangePct,
    positions: reportPositions, driftAlerts, hardBreaches, softBreaches, maxDrift,
    health, governance, lookThrough, nextMove,
  }
}

export { SBR_TECHNOLOGY_LIMIT, SBR_SINGLE_COMPANY_LIMIT }
