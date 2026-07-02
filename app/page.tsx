import { Shell } from "@/components/shell"
import { TrendingUp, Activity, AlertTriangle } from "lucide-react"
import { db } from "@/lib/db"
import { formatCurrency } from "@/lib/utils"
import { getSession } from "@/lib/session"
import { redirect } from "next/navigation"
import { AllocationDonut } from "@/components/charts/allocation-donut"
import { PortfolioHistoryChart } from "@/components/charts/portfolio-history-chart"
import { computePortfolioHealth } from "@/lib/health"
import { HealthMethodology } from "@/components/health-methodology"
import { HARD_THRESHOLDS } from "@/lib/constants"
import { computeMarketAwareDca, BITCOIN_SLEEVE_TARGET_PCT, type PositionInput } from "@/lib/next-best-move"
import { computeLadder } from "@/lib/ladder"
import { getBtcPhaseCard, getSmhBuyZone, getCombinedTechCeiling, getSgovQueueState } from "@/lib/cycle"
import { BufferStatus } from "@/components/dashboard/buffer-status"
import { getLiveMarketPositions, getSgovYield } from "@/lib/finnhub"
import { computeLookThrough, worstLookThroughBreach, largestContributor } from "@/lib/look-through"
import { evaluateGovernance } from "@/lib/governance-status"
import { GovernanceAlignment } from "@/components/dashboard/governance-alignment"
import { isUsSited, isInScope } from "@/lib/approved-alternatives"
import { getRecentExecutions } from "@/lib/execution-actions"
import { HoldingsTable } from "@/components/dashboard/holdings-table"
import { RefreshPricesButton } from "@/components/portfolio/refresh-prices-button"
import { PortfolioUpdateButton } from "@/components/portfolio-update-button"
import { constitutionIdForEmail } from "@/lib/constitutions"
import { SbrDashboard } from "@/components/sbr/sbr-dashboard"
import { GovernanceSeal, type SealDimension } from "@/components/cockpit/governance-seal"
import { DecisionLadderCard } from "@/components/cockpit/decision-ladder-card"
import { ComplianceBoard, type ComplianceBandPosition } from "@/components/cockpit/compliance-board"
import { CycleInstruments } from "@/components/cockpit/cycle-instruments"

// Fallback defaults (overridden by user DB settings)
const DEFAULT_MONTHLY = 3000
const DEFAULT_ANNUAL_LUMP_SUM = 20000
const DEFAULT_GROWTH_RATE = 0.05

function projectPortfolio(
  currentValue: number,
  monthlyContribution: number,
  annualLumpSum: number,
  annualRate: number,
  years: number,
  contributionGrowthRate: number
): number {
  let value = currentValue
  const monthlyRate = annualRate / 12
  for (let year = 0; year < years; year++) {
    const contribution = monthlyContribution * Math.pow(1 + contributionGrowthRate, year)
    for (let month = 0; month < 12; month++) {
      value = value * (1 + monthlyRate) + contribution
    }
    value += annualLumpSum
  }
  return value
}

type ActionStatus = "healthy" | "soft" | "hard"

async function getUsdSgdRate(): Promise<number> {
  try {
    const res = await fetch(
      "https://query1.finance.yahoo.com/v8/finance/chart/USDSGD=X?interval=1d&range=1d",
      { headers: { "User-Agent": "Mozilla/5.0" }, next: { revalidate: 3600 } }
    )
    if (res.ok) {
      const d = await res.json()
      const rate = d?.chart?.result?.[0]?.meta?.regularMarketPrice
      if (rate && rate > 0) return rate
    }
  } catch {}
  return 1.35
}

/** Dealing window: opens 3rd business day after the 15th, closes last business day of month. */
function getDealingWindow(now: Date): {
  daysUntilOpen: number | null
  windowClosesLabel: string | null
  isOpen: boolean
} {
  const y = now.getFullYear(), m = now.getMonth()
  const todayStr = `${y}-${m}-${now.getDate()}`

  // 3rd business day after the 15th
  let count = 0
  let open = new Date(y, m, 15)
  while (count < 3) {
    open = new Date(open.getTime() + 86_400_000)
    if (open.getDay() !== 0 && open.getDay() !== 6) count++
  }

  // Last business day of month
  const last = new Date(y, m + 1, 0)
  while (last.getDay() === 0 || last.getDay() === 6) last.setDate(last.getDate() - 1)

  const todayMs  = new Date(y, m, now.getDate()).getTime()
  const openMs   = new Date(open.getFullYear(), open.getMonth(), open.getDate()).getTime()
  const closeMs  = new Date(last.getFullYear(), last.getMonth(), last.getDate()).getTime()

  if (todayMs >= openMs && todayMs <= closeMs) {
    return {
      daysUntilOpen: null,
      windowClosesLabel: last.toLocaleDateString("en-GB", { day: "numeric", month: "short" }).toUpperCase(),
      isOpen: true,
    }
  } else if (todayMs < openMs) {
    return {
      daysUntilOpen: Math.round((openMs - todayMs) / 86_400_000),
      windowClosesLabel: null,
      isOpen: false,
    }
  }
  return { daysUntilOpen: null, windowClosesLabel: null, isOpen: false }
}

async function getDashboardData(userId: string) {
  const [user, holdings, usdSgdRate, trades] = await Promise.all([
    db.user.findUnique({ where: { id: userId } }),
    db.holding.findMany({
      where: { userId },
      include: { snapshots: { orderBy: { date: "desc" }, take: 8 } },
    }),
    getUsdSgdRate(),
    db.trade.findMany({ where: { userId }, orderBy: { date: "asc" } }),
  ])

  // Weighted-average cost basis per ticker from trades
  const avgCost: Record<string, { units: number; sgd: number; usd: number }> = {}
  for (const t of trades) {
    if (!avgCost[t.ticker]) avgCost[t.ticker] = { units: 0, sgd: 0, usd: 0 }
    const a = avgCost[t.ticker]
    if (t.type === "BUY") { a.units += t.units; a.sgd += t.amount; a.usd += t.units * t.price }
    else { const su = a.units > 0 ? a.sgd / a.units : 0; const uu = a.units > 0 ? a.usd / a.units : 0; const rem = Math.max(0, a.units - t.units); a.units = rem; a.sgd = rem * su; a.usd = rem * uu }
  }

  // Portfolio value history (deduplicated, last 8 complete dates)
  const holdingDateMaps = new Map<string, Map<string, number>>()
  for (const h of holdings) {
    const dm = new Map<string, number>()
    for (const s of h.snapshots) dm.set(s.date.toISOString().split("T")[0], s.value)
    holdingDateMaps.set(h.id, dm)
  }
  const holdingsWithData = holdings.filter(h => holdingDateMaps.get(h.id)!.size > 0)
  const allDates = [...new Set(holdingsWithData.flatMap(h => [...holdingDateMaps.get(h.id)!.keys()]))].sort()
  const completeDates = allDates.filter(date =>
    holdingsWithData.every(h => holdingDateMaps.get(h.id)!.has(date))
  ).slice(-8)
  const historyPoints = completeDates.map(date => ({
    label: new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
    value: holdingsWithData.reduce((sum, h) => sum + holdingDateMaps.get(h.id)!.get(date)!, 0),
  }))

  const totalValue = holdings.reduce((sum, h) => sum + (h.snapshots[0]?.value ?? 0), 0)
  const hasBalance = totalValue > 0
  const valueChange = historyPoints.length >= 2
    ? historyPoints[historyPoints.length - 1].value - historyPoints[historyPoints.length - 2].value
    : null

  const positions = holdings.map((h) => {
    const value = h.snapshots[0]?.value ?? 0
    const actualPct = totalValue > 0 ? (value / totalValue) * 100 : 0
    const driftPct = actualPct - h.targetPct
    const absDrift = Math.abs(driftPct)
    const overCap = h.hardCapPct !== null && actualPct > h.hardCapPct
    const ht = HARD_THRESHOLDS[h.ticker]
    const isHardDrift = totalValue > 0 && (overCap ||
      (ht?.low !== undefined && actualPct < ht.low) ||
      (ht !== undefined && actualPct > ht.high))
    const isSoftDrift = totalValue > 0 && !isHardDrift && absDrift > h.toleranceBand
    const status: ActionStatus = isHardDrift ? "hard" : isSoftDrift ? "soft" : "healthy"
    const latestPrice = h.snapshots[0]?.price ?? 0
    const prevPrice = h.snapshots[1]?.price ?? 0
    const priceChangePct = prevPrice > 0 ? ((latestPrice - prevPrice) / prevPrice) * 100 : null
    const priceHistory = [...h.snapshots].reverse().map(s => s.price).filter(p => p > 0)
    const cb = avgCost[h.ticker]
    const costBasisSgd = cb ? cb.sgd : 0
    const avgCostUsd = cb && cb.units > 0 ? cb.usd / cb.units : null
    const unrealisedSgd = costBasisSgd > 0 ? value - costBasisSgd : null
    const unrealisedPct = costBasisSgd > 0 ? (unrealisedSgd! / costBasisSgd) * 100 : null
    return { ticker: h.ticker, name: h.name, color: h.color, value, actualPct, targetPct: h.targetPct, driftPct, status, hardCapPct: h.hardCapPct, toleranceBand: h.toleranceBand, latestPrice, priceChangePct, priceHistory, avgCostUsd, costBasisSgd, unrealisedSgd, unrealisedPct, units: h.snapshots[0]?.units ?? 0 }
  })

  // Bitcoin sleeve consolidation — BTC in run-off, IBIT is accumulation vehicle
  {
    const btcPos = positions.find(p => p.ticker === "BTC")
    const ibitPos = positions.find(p => p.ticker === "IBIT")
    if (btcPos && ibitPos && totalValue > 0) {
      const sleevePct = btcPos.actualPct + ibitPos.actualPct
      const sleeveCap = HARD_THRESHOLDS["IBIT"]?.high ?? 8
      btcPos.targetPct = btcPos.actualPct; btcPos.driftPct = 0; btcPos.status = "healthy"
      const ibitTarget = Math.max(0, BITCOIN_SLEEVE_TARGET_PCT - btcPos.actualPct)
      const ibitBand = ibitPos.toleranceBand ?? 1
      ibitPos.targetPct = ibitTarget
      ibitPos.driftPct = ibitPos.actualPct - ibitTarget
      ibitPos.status = sleevePct > sleeveCap ? "hard" : Math.abs(ibitPos.driftPct) > ibitBand ? "soft" : "healthy"
    }
  }

  const order: Record<ActionStatus, number> = { hard: 0, soft: 1, healthy: 2 }
  positions.sort((a, b) => order[a.status] - order[b.status])

  const hardBreaches = positions.filter(p => p.status === "hard").length
  const softBreaches = positions.filter(p => p.status === "soft").length
  const driftAlerts  = hardBreaches + softBreaches
  const maxDrift     = hasBalance ? positions.reduce((max, p) => Math.max(max, Math.abs(p.driftPct)), 0) : 0

  const latestSnapshotDate = holdings.reduce<Date | null>((latest, h) => {
    const d = h.snapshots[0]?.date
    if (!d) return latest
    return latest === null || d > latest ? d : latest
  }, null)
  const daysSinceUpdate = latestSnapshotDate
    ? Math.floor((Date.now() - new Date(latestSnapshotDate).getTime()) / 86_400_000)
    : null

  const [activeRules, totalRules] = await Promise.all([
    db.governanceRule.count({ where: { active: true } }),
    db.governanceRule.count(),
  ])
  const snapshotAgeDays = daysSinceUpdate ?? 999
  const lookThrough = computeLookThrough(positions)
  const companyHardBreaches = lookThrough.companies.filter(c => c.status === "breach").length
  const sectorHardBreaches  = lookThrough.sectors.filter(s => s.status === "breach").length
  const health = computePortfolioHealth({ hardBreaches, softBreaches, maxDrift, companyHardBreaches, sectorHardBreaches, activeRules, totalRules, snapshotAgeDays })

  const monthlyContribution = user?.monthlyContribution ?? DEFAULT_MONTHLY
  const annualLumpSum = user?.annualLumpSum ?? DEFAULT_ANNUAL_LUMP_SUM
  const contributionGrowthRate = user?.contributionGrowthRate ?? DEFAULT_GROWTH_RATE

  const yearsTo2045 = Math.max(1, 2045 - new Date().getFullYear())
  const base2045 = projectPortfolio(totalValue, monthlyContribution, annualLumpSum, 0.10, yearsTo2045, contributionGrowthRate)

  const startOfYear = new Date(new Date().getFullYear(), 0, 1)
  const dayOfYear = Math.floor((Date.now() - startOfYear.getTime()) / 86_400_000)
  const monthsElapsed = Math.min(12, Math.max(0, Math.round(dayOfYear / 30.44)))
  const soySnaps = await Promise.all(
    holdings.map((h) => db.snapshot.findFirst({ where: { holdingId: h.id, date: { lt: startOfYear } }, orderBy: { date: "desc" } }))
  )
  const startOfYearValue = soySnaps.reduce((s, snap) => s + (snap?.value ?? 0), 0)
  let targetNow: number | null = null
  if (startOfYearValue > 0 && monthsElapsed > 0) {
    let v = startOfYearValue + annualLumpSum
    const mRate = 0.10 / 12
    for (let m = 0; m < monthsElapsed; m++) v = v * (1 + mRate) + monthlyContribution
    targetNow = v
  }
  const onTrackPct = targetNow && targetNow > 0 ? (totalValue / targetNow) * 100 : null

  const now = new Date()
  const day15ThisMonth = new Date(now.getFullYear(), now.getMonth(), 15)
  const nextContribution = now < day15ThisMonth
    ? day15ThisMonth
    : new Date(now.getFullYear(), now.getMonth() + 1, 15)
  const daysToContribution = Math.ceil((nextContribution.getTime() - now.getTime()) / 86_400_000)
  const nextContributionLabel = nextContribution.toLocaleDateString("en-GB", { day: "numeric", month: "short" })

  const donutData = holdings.map((h) => {
    const value = h.snapshots[0]?.value ?? 0
    const actualPct = totalValue > 0 ? (value / totalValue) * 100 : 0
    return { ticker: h.ticker, name: h.name, actualPct, targetPct: h.targetPct, color: h.color, value }
  }).sort((a, b) => b.actualPct - a.actualPct)

  const moveInputs: PositionInput[] = positions.map(p => ({
    ticker: p.ticker, name: p.name, color: p.color, value: p.value,
    actualPct: p.actualPct, targetPct: p.targetPct,
    hardCapPct: p.hardCapPct ?? null, toleranceBand: p.toleranceBand ?? 2.5,
    latestPrice: p.latestPrice ?? 0,
  }))

  const [marketSnapshot, sgov, recentExecutions] = await Promise.all([
    getLiveMarketPositions(),
    getSgovYield(),
    getRecentExecutions(userId, 1),
  ])

  const ltBreach = worstLookThroughBreach(lookThrough)
  const lookThroughBreach = ltBreach
    ? {
        label: ltBreach.label, pct: ltBreach.pct, hard: ltBreach.hard,
        trimTicker: largestContributor(ltBreach.key, lookThrough.companies.some(c => c.key === ltBreach.key) ? "company" : "sector", positions),
      }
    : undefined

  let portfolioDrawdownPct: number | undefined
  if (historyPoints.length >= 2) {
    let peakIdx = 0
    for (let i = 1; i < historyPoints.length; i++) if (historyPoints[i].value > historyPoints[peakIdx].value) peakIdx = i
    const peak = historyPoints[peakIdx].value
    const current = historyPoints[historyPoints.length - 1].value
    if (peak > 0 && current < peak) portfolioDrawdownPct = ((current - peak) / peak) * 100
  }

  // Art. XIII: Decision Ladder
  const ladder = computeLadder(moveInputs, totalValue, {
    market: marketSnapshot.positions,
    lookThroughHardBreach: lookThroughBreach,
    portfolioDrawdownPct,
  })

  // Market-aware DCA for holdings table thisMonth column
  const dcaPlan = computeMarketAwareDca(moveInputs, monthlyContribution, { market: marketSnapshot.positions, lookThroughBreach })
  const dcaByTicker = new Map(dcaPlan.allocations.map((a) => [a.ticker, { amount: a.amount, tag: a.tag, reason: a.reason }]))
  const holdingsRows = positions.map((p) => ({
    ticker: p.ticker, name: p.name, color: p.color, units: p.units, value: p.value,
    latestPrice: p.latestPrice ?? 0, priceChangePct: p.priceChangePct, priceHistory: p.priceHistory,
    avgCostUsd: p.avgCostUsd, unrealisedSgd: p.unrealisedSgd, unrealisedPct: p.unrealisedPct,
    actualPct: p.actualPct, targetPct: p.targetPct, toleranceBand: p.toleranceBand ?? 2.5,
    hardCapPct: p.hardCapPct ?? null, status: p.status,
    thisMonth: dcaByTicker.get(p.ticker) ?? null,
  }))

  // Compliance Board — band data per position
  const complianceBands: ComplianceBandPosition[] = positions.map((p) => {
    const ht = HARD_THRESHOLDS[p.ticker]
    return {
      ticker: p.ticker, name: p.name, color: p.color, value: p.value,
      actualPct: p.actualPct, targetPct: p.targetPct,
      softLow: Math.max(0, p.targetPct - (p.toleranceBand ?? 2.5)),
      softHigh: p.targetPct + (p.toleranceBand ?? 2.5),
      hardLow: ht?.low,
      hardHigh: p.hardCapPct ?? ht?.high ?? (p.targetPct + 15),
      status: p.status,
    }
  })

  // Cycle Instruments (Art. VIII, IX, XI, XIV)
  const smhLive = marketSnapshot.positions["SMH"]
  const qqqmPct = positions.find(p => p.ticker === "QQQM")?.actualPct ?? 0
  const smhPct  = positions.find(p => p.ticker === "SMH")?.actualPct ?? 0
  const sgovPct = positions.find(p => ["SGOV", "AGG", "CASH"].includes(p.ticker))?.actualPct ?? 0

  const cycleInstruments = {
    btc:  getBtcPhaseCard(),
    smh:  getSmhBuyZone(smhLive?.price ?? 0, smhLive?.hi52 ?? 0),
    tech: getCombinedTechCeiling(qqqmPct, smhPct),
    sgov: getSgovQueueState({ currentPct: sgovPct, portfolioValueSgd: totalValue, monthlyContributionSgd: monthlyContribution }),
  }

  // Buffer status (F2)
  const sgovValue = (sgovPct / 100) * totalValue
  const bufferTargetLow = 8, bufferTargetHigh = 10
  const bufferNeeded = Math.max(0, (bufferTargetLow / 100) * totalValue - sgovValue)
  const bufferMonthsToBand = bufferNeeded > 0 && monthlyContribution > 0 ? Math.ceil(bufferNeeded / monthlyContribution) : 0

  const usSitedValueUsd = usdSgdRate > 0
    ? positions.filter(p => isUsSited(p.ticker)).reduce((s, p) => s + p.value / usdSgdRate, 0)
    : 0
  const outOfScopeTickers = positions.filter((p) => p.value > 0 && !isInScope(p.ticker)).map((p) => p.ticker.toUpperCase())
  const govAlignment = evaluateGovernance({ positions, bufferPct: sgovPct, lookThrough, usSitedValueUsd })

  const dealingWindow = getDealingWindow(now)

  const updateHoldings = holdings.map((h) => ({
    id: h.id, ticker: h.ticker, name: h.name,
    latestUnits: h.snapshots[0]?.units ?? 0, latestPrice: h.snapshots[0]?.price ?? 0,
  }))

  return {
    totalValue, hasBalance, positions, holdingsRows, driftAlerts, maxDrift,
    activeRules, totalRules, snapshotAgeDays, health, hardBreaches, softBreaches,
    donutData, daysSinceUpdate, latestSnapshotDate: latestSnapshotDate?.toISOString() ?? null,
    base2045, yearsTo2045, daysToContribution, nextContributionLabel, historyPoints,
    valueChange, monthlyContribution, annualLumpSum, usdSgdRate, onTrackPct,
    marketStale: marketSnapshot.stale,
    bufferTargetLow, bufferTargetHigh, bufferMonthsToBand,
    sgovYieldPct: sgov.dividendYieldPct, sgovSecYieldPct: sgov.secYieldPct, sgovStale: sgov.stale,
    govAlignment, outOfScopeTickers, updateHoldings,
    complianceBands, cycleInstruments, ladder, dealingWindow,
    lastDone: recentExecutions[0] ?? null,
  }
}

export default async function Dashboard() {
  const session = await getSession()
  if (!session) redirect("/login")

  if (constitutionIdForEmail(session.email) === "silicon-brick-road") {
    return <SbrDashboard userId={session.userId} name={session.name} isAdmin={session.role === "admin"} />
  }

  const d = await getDashboardData(session.userId)

  // Build SealDimension array for GovernanceSeal
  const sealDimensions: SealDimension[] = [
    { label: "Structural",    score: d.health.structural.score,    maxScore: 40, status: d.health.structural.status,    citation: d.health.structural.citation },
    { label: "Behavioural",   score: d.health.behavioural.score,   maxScore: 25, status: d.health.behavioural.status,   citation: d.health.behavioural.citation },
    { label: "Concentration", score: d.health.concentration.score, maxScore: 25, status: d.health.concentration.status, citation: d.health.concentration.citation },
    { label: "Execution",     score: d.health.execution.score,     maxScore: 10, status: d.health.execution.status,     citation: d.health.execution.citation },
  ]

  return (
    <Shell title="Cockpit" subtitle="Atlas Core — Constitution v1.4" userName={session.name} isAdmin={session.role === "admin"}>

      {/* Toolbar */}
      <div className="mb-5 flex flex-wrap items-start gap-2">
        <RefreshPricesButton />
        <PortfolioUpdateButton label="Update Holdings" holdings={d.updateHoldings} />
        {d.dealingWindow.isOpen && (
          <span className="inline-flex items-center text-[10px] font-bold px-3 py-1.5 rounded-full border border-green-500/40 bg-green-500/10 text-green-600 dark:text-green-400">
            DEALING WINDOW OPEN · CLOSES {d.dealingWindow.windowClosesLabel}
          </span>
        )}
        {!d.dealingWindow.isOpen && d.dealingWindow.daysUntilOpen !== null && (
          <span className="inline-flex items-center text-[10px] font-semibold px-3 py-1.5 rounded-full border border-border text-muted-foreground">
            WINDOW OPENS IN {d.dealingWindow.daysUntilOpen}d
          </span>
        )}
      </div>

      {/* Stale data warning */}
      {d.hasBalance && d.daysSinceUpdate !== null && d.daysSinceUpdate >= 3 && (
        <a href="/portfolio" className={`mb-5 flex items-center gap-3 rounded-xl border px-5 py-3 transition-colors group ${
          d.daysSinceUpdate >= 7
            ? "border-red-500/30 bg-red-500/[0.07] hover:bg-red-500/[0.11]"
            : "border-amber-400/30 bg-amber-400/[0.07] hover:bg-amber-400/[0.11]"
        }`}>
          <Activity className={`h-4 w-4 shrink-0 ${d.daysSinceUpdate >= 7 ? "text-red-500" : "text-amber-500"}`} />
          <p className={`text-xs flex-1 ${d.daysSinceUpdate >= 7 ? "text-red-600 dark:text-red-400" : "text-amber-700 dark:text-amber-400"}`}>
            <span className="font-bold">Prices last updated {d.daysSinceUpdate} day{d.daysSinceUpdate !== 1 ? "s" : ""} ago</span>
            {d.latestSnapshotDate && ` · ${new Date(d.latestSnapshotDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`}
            {d.daysSinceUpdate >= 7 ? " — portfolio values may be significantly out of date." : ""}
          </p>
          <span className={`shrink-0 text-xs font-semibold transition-colors ${d.daysSinceUpdate >= 7 ? "text-red-500/70 group-hover:text-red-500" : "text-amber-500/70 group-hover:text-amber-500"}`}>
            Update now →
          </span>
        </a>
      )}

      {/* Out-of-scope holding alert */}
      {d.hasBalance && d.outOfScopeTickers.length > 0 && (
        <a href="/portfolio" className="mb-5 flex items-center gap-4 rounded-xl border border-amber-400/40 bg-amber-400/10 dark:bg-amber-400/[0.08] px-5 py-3.5 hover:bg-amber-400/[0.14] transition-colors group">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
          <div className="flex-1">
            <p className="text-sm font-bold text-amber-700 dark:text-amber-400">
              {d.outOfScopeTickers.join(", ")} {d.outOfScopeTickers.length > 1 ? "are" : "is"} held but not in your plan
            </p>
            <p className="text-xs text-amber-700/80 dark:text-amber-400/80 mt-0.5">
              Decide what to do: keep it and set a target, switch to an approved alternative, or sell it.
            </p>
          </div>
          <span className="shrink-0 text-xs font-semibold text-amber-500/70 group-hover:text-amber-500 transition-colors">Review →</span>
        </a>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
        <div className="space-y-5 min-w-0">

          {/* ── COMPLIANCE COCKPIT ────────────────────────────────────── */}
          {/* 1. Governance Seal — constitution health, always first */}
          <GovernanceSeal
            overall={d.health.overall}
            overallLabel={d.health.overallLabel}
            dimensions={sealDimensions}
            constitutionLabel="Art. XXII · Governance Score"
            narrative={
              d.hasBalance
                ? `${d.hardBreaches > 0 ? d.hardBreaches + " hard breach" + (d.hardBreaches > 1 ? "es" : "") + " require immediate action. " : ""}${d.softBreaches > 0 ? d.softBreaches + " position" + (d.softBreaches > 1 ? "s" : "") + " outside tolerance. " : ""}${d.hardBreaches === 0 && d.softBreaches === 0 ? "All positions within bands. " : ""}Snapshot age: ${d.snapshotAgeDays <= 1 ? "current" : d.snapshotAgeDays + " days old"}.`
                : "No portfolio balance yet. Enter your holdings to begin tracking."
            }
          />

          {/* 2. Decision Ladder — the single instruction (Art. XIII) */}
          <DecisionLadderCard
            ladder={d.ladder}
            monthlyContribution={d.monthlyContribution}
            daysToWindow={d.dealingWindow.daysUntilOpen}
            windowClosesLabel={d.dealingWindow.windowClosesLabel}
          />

          {/* 3. Compliance Board — position bands */}
          {d.hasBalance && (
            <ComplianceBoard positions={d.complianceBands} totalValue={d.totalValue} />
          )}

          {/* ── PERFORMANCE ───────────────────────────────────────────── */}
          {/* KPI strip */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <a href="/ytd" className="rounded-xl border border-border bg-card p-4 card-elevated flex flex-col gap-2 hover:border-primary/30 hover:bg-accent/40 transition-colors group">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Portfolio</span>
                <TrendingUp className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              <p className="text-xl font-black tabular-nums">{formatCurrency(d.totalValue, "SGD")}</p>
              {d.valueChange !== null ? (
                <p className={`text-[11px] tabular-nums font-medium ${d.valueChange >= 0 ? "text-green-500" : "text-red-500"}`}>
                  {d.valueChange >= 0 ? "▲" : "▼"} {formatCurrency(Math.abs(d.valueChange), "SGD")}
                </p>
              ) : (
                <p className="text-[11px] text-muted-foreground">USD/SGD {d.usdSgdRate.toFixed(4)}</p>
              )}
            </a>
            <div className="rounded-xl border border-border bg-card p-4 card-elevated flex flex-col gap-2">
              <span className="text-xs font-medium text-muted-foreground">Health</span>
              <p className={`text-xl font-black tabular-nums ${d.health.overall >= 80 ? "text-green-500" : d.health.overall >= 65 ? "text-amber-500" : "text-red-500"}`}>{d.health.overall}</p>
              <p className="text-[11px] text-muted-foreground">{d.health.overallLabel}</p>
            </div>
            <a href="/portfolio" className={`rounded-xl border bg-card p-4 card-elevated flex flex-col gap-2 hover:bg-accent/40 transition-colors group ${d.driftAlerts > 0 ? "border-amber-400/40" : "border-border hover:border-primary/30"}`}>
              <span className="text-xs font-medium text-muted-foreground">Drift Alerts</span>
              <p className={`text-xl font-black tabular-nums ${d.driftAlerts > 0 ? (d.hardBreaches > 0 ? "text-red-500" : "text-amber-500") : "text-green-500"}`}>{d.driftAlerts}</p>
              <p className="text-[11px] text-muted-foreground">{d.driftAlerts === 0 ? "All on target" : `${d.hardBreaches}H / ${d.softBreaches}S breach`}</p>
            </a>
            <a href="/forecast" className={`rounded-xl border bg-card p-4 card-elevated flex flex-col gap-2 hover:bg-accent/40 transition-colors group ${
              d.onTrackPct === null ? "border-border hover:border-primary/30" :
              d.onTrackPct >= 95 ? "border-green-500/30" :
              d.onTrackPct >= 80 ? "border-yellow-400/30" : "border-red-500/30"
            }`}>
              <span className="text-xs font-medium text-muted-foreground">On Track</span>
              <p className={`text-xl font-black tabular-nums ${
                d.onTrackPct === null ? "text-muted-foreground" :
                d.onTrackPct >= 95 ? "text-green-500" :
                d.onTrackPct >= 80 ? "text-yellow-400" : "text-red-500"
              }`}>{d.onTrackPct !== null ? `${d.onTrackPct.toFixed(0)}%` : "—"}</p>
              <p className="text-[11px] text-muted-foreground">vs 2045 plan</p>
            </a>
          </div>

          {/* ── WHAT IS HELD ─────────────────────────────────────────── */}
          {d.hasBalance && (
            <HoldingsTable positions={d.holdingsRows} totalValue={d.totalValue} priceStale={d.marketStale} />
          )}

          {/* ── CYCLE INSTRUMENTS ────────────────────────────────────── */}
          <CycleInstruments {...d.cycleInstruments} />

          {/* ── GOVERNANCE & COMPLIANCE ──────────────────────────────── */}
          {d.hasBalance && d.govAlignment && (
            <GovernanceAlignment data={d.govAlignment} />
          )}

        </div>

        {/* Right sidebar */}
        <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">

          {/* Allocation donut */}
          <div className="rounded-xl border border-border bg-card p-5 card-elevated">
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-1">Allocation</h2>
            <p className="text-[11px] text-muted-foreground mb-3">Outer = actual · Inner = target</p>
            <AllocationDonut data={d.donutData} totalValue={d.totalValue} />
          </div>

          {/* Value history */}
          {d.historyPoints.length >= 2 && (
            <div className="rounded-xl border border-border bg-card p-4 card-elevated">
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Value History</h2>
                {d.valueChange !== null && (
                  <span className={`text-[11px] font-bold tabular-nums ${d.valueChange >= 0 ? "text-green-500" : "text-red-500"}`}>
                    {d.valueChange >= 0 ? "+" : ""}{formatCurrency(d.valueChange, "SGD")}
                  </span>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground mb-2">{d.historyPoints.length} snapshots</p>
              <PortfolioHistoryChart data={d.historyPoints} />
            </div>
          )}

          {/* 2045 goal + contribution countdown */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-border bg-card p-4 card-elevated">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">2045 Base Case</p>
              <p className="text-lg font-black tabular-nums gradient-text leading-tight">
                {d.base2045 >= 1_000_000
                  ? `S$${(d.base2045 / 1_000_000).toFixed(1)}M`
                  : `S$${(d.base2045 / 1_000).toFixed(0)}K`}
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">10% p.a. · {d.yearsTo2045} yr</p>
              <div className="mt-2 h-1 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full bg-primary/60" style={{ width: `${d.base2045 > 0 ? Math.min(100, (d.totalValue / d.base2045) * 100) : 0}%` }} />
              </div>
            </div>
            <div className="rounded-xl border border-border bg-card p-4 card-elevated">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Next Contribution</p>
              <p className="text-lg font-black tabular-nums leading-tight">
                {d.daysToContribution === 0 ? "Today" : `${d.daysToContribution}d`}
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">{d.nextContributionLabel} · {formatCurrency(d.monthlyContribution, "SGD")}</p>
              <div className="mt-2 h-1 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full bg-primary/60" style={{ width: `${Math.max(5, 100 - (d.daysToContribution / 31) * 100)}%` }} />
              </div>
            </div>
          </div>

          {/* Shock buffer */}
          {d.hasBalance && (
            <BufferStatus
              currentPct={d.cycleInstruments.sgov.currentPct}
              targetLow={d.bufferTargetLow}
              targetHigh={d.bufferTargetHigh}
              monthsToBand={d.bufferMonthsToBand}
              yieldPct={d.sgovYieldPct}
              secYieldPct={d.sgovSecYieldPct}
              monthlyContribution={d.monthlyContribution}
              stale={d.sgovStale}
            />
          )}

          {/* Health methodology */}
          {d.hasBalance && (
            <HealthMethodology
              structural={d.health.structural.score}
              behavioural={d.health.behavioural.score}
              concentration={d.health.concentration.score}
              execution={d.health.execution.score}
              hardBreaches={d.hardBreaches}
              softBreaches={d.softBreaches}
              maxDrift={d.maxDrift}
              activeRules={d.activeRules}
              totalRules={d.totalRules}
              snapshotAgeDays={d.snapshotAgeDays}
            />
          )}
        </div>
      </div>
    </Shell>
  )
}
