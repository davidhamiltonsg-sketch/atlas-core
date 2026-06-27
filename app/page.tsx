import { Shell } from "@/components/shell"
import { TrendingUp, ShieldCheck, AlertTriangle, Activity, XCircle } from "lucide-react"
import { db } from "@/lib/db"
import { formatCurrency } from "@/lib/utils"
import { getSession } from "@/lib/session"
import { redirect } from "next/navigation"
import { AllocationDonut } from "@/components/charts/allocation-donut"
import { HealthGauge } from "@/components/charts/health-gauge"
import { PortfolioHistoryChart } from "@/components/charts/portfolio-history-chart"
import { computePortfolioHealth } from "@/lib/health"
import { ExecutionPlan } from "@/components/dashboard/execution-plan"
import { CollapsibleSection } from "@/components/dashboard/collapsible-section"
import { HealthMethodology } from "@/components/health-methodology"
import { HARD_THRESHOLDS } from "@/lib/constants"
import { computeNextBestMove, BITCOIN_SLEEVE_TARGET_PCT, type PositionInput } from "@/lib/next-best-move"
import { NextBestMove } from "@/components/dashboard/next-best-move"
import { ActionPlan } from "@/components/dashboard/action-plan"
import { BufferStatus } from "@/components/dashboard/buffer-status"
import { getLiveMarketPositions, getSgovYield } from "@/lib/finnhub"
import { computeLookThrough, worstLookThroughBreach, largestContributor } from "@/lib/look-through"
import { evaluateGovernance } from "@/lib/governance-status"
import { GovernanceAlignment } from "@/components/dashboard/governance-alignment"
import { isUsSited, isInScope } from "@/lib/approved-alternatives"
import { getLastMonthlyCheck } from "@/lib/monthly-check-actions"
import { MonthlyCheck } from "@/components/dashboard/monthly-check"
import { HoldingsTable } from "@/components/dashboard/holdings-table"
import { RefreshPricesButton } from "@/components/portfolio/refresh-prices-button"
import { PortfolioUpdateButton } from "@/components/portfolio-update-button"

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
    value += annualLumpSum // annual top-up applied every year (incl. the first)
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

  // Weighted-average cost basis per ticker (SGD for P&L, USD for avg cost/unit) — from trades.
  const avgCost: Record<string, { units: number; sgd: number; usd: number }> = {}
  for (const t of trades) {
    if (!avgCost[t.ticker]) avgCost[t.ticker] = { units: 0, sgd: 0, usd: 0 }
    const a = avgCost[t.ticker]
    if (t.type === "BUY") { a.units += t.units; a.sgd += t.amount; a.usd += t.units * t.price }
    else { const su = a.units > 0 ? a.sgd / a.units : 0; const uu = a.units > 0 ? a.usd / a.units : 0; const rem = Math.max(0, a.units - t.units); a.units = rem; a.sgd = rem * su; a.usd = rem * uu }
  }

  // Build portfolio value history — deduplicate by date, align across holdings
  // (index-based alignment breaks when holdings have different snapshot counts;
  //  multiple syncs on the same day also inflate the total if summed naively)
  const holdingDateMaps = new Map<string, Map<string, number>>()
  for (const h of holdings) {
    const dm = new Map<string, number>()
    for (const s of h.snapshots) {
      dm.set(s.date.toISOString().split("T")[0], s.value)
    }
    holdingDateMaps.set(h.id, dm)
  }
  const holdingsWithData = holdings.filter(h => holdingDateMaps.get(h.id)!.size > 0)
  const allDates = [...new Set(
    holdingsWithData.flatMap(h => [...holdingDateMaps.get(h.id)!.keys()])
  )].sort()
  // Keep last 8 complete dates (all holdings present)
  const completeDates = allDates.filter(date =>
    holdingsWithData.every(h => holdingDateMaps.get(h.id)!.has(date))
  ).slice(-8)
  const historyPoints: Array<{ label: string; value: number }> = completeDates.map(date => ({
    label: new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
    value: holdingsWithData.reduce((sum, h) => sum + holdingDateMaps.get(h.id)!.get(date)!, 0),
  }))

  const totalValue = holdings.reduce((sum, h) => sum + (h.snapshots[0]?.value ?? 0), 0)
  const hasBalance = totalValue > 0
  // Compare the last two complete-date sparkline points (both deduplicated) for a
  // consistent value-change figure that matches what the sparkline shows
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
    // When portfolio has no balance yet, suppress all drift alerts
    const isHardDrift = totalValue > 0 && (overCap ||
      (ht?.low !== undefined && actualPct < ht.low) ||
      (ht !== undefined && actualPct > ht.high))
    const isSoftDrift = totalValue > 0 && !isHardDrift && absDrift > h.toleranceBand

    let status: ActionStatus
    let instruction: string

    if (isHardDrift) {
      status = "hard"
      instruction = driftPct < 0
        ? `${h.ticker} is too small — it's at ${actualPct.toFixed(1)}% but should be ${h.targetPct}%. Put all of this month's investment money into ${h.ticker} until it's back on track.`
        : `${h.ticker} has grown too large — it's at ${actualPct.toFixed(1)}% but should be ${h.targetPct}%. Stop buying ${h.ticker} immediately. You may need to sell a small amount at your next opportunity.`
    } else if (isSoftDrift) {
      status = "soft"
      instruction = driftPct < 0
        ? `${h.ticker} is a little small at ${actualPct.toFixed(1)}% (target: ${h.targetPct}%). Boost it by adding extra contributions for the next 2–3 months.`
        : `${h.ticker} has grown slightly above its ${h.targetPct}% target to ${actualPct.toFixed(1)}%. Skip buying it this month — put that money into smaller positions instead.`
    } else {
      status = "healthy"
      instruction = `${h.ticker} is right on track at ${actualPct.toFixed(1)}% (target: ${h.targetPct}%). Keep investing your normal amount each month.`
    }

    // Stock performance — price move since the previous snapshot + a price trend series
    const latestPrice = h.snapshots[0]?.price ?? 0
    const prevPrice = h.snapshots[1]?.price ?? 0
    const priceChangePct = prevPrice > 0 ? ((latestPrice - prevPrice) / prevPrice) * 100 : null
    const priceHistory = [...h.snapshots].reverse().map(s => s.price).filter(p => p > 0)

    // Cost basis & unrealised gain (from the trade log)
    const cb = avgCost[h.ticker]
    const costBasisSgd = cb ? cb.sgd : 0
    const avgCostUsd = cb && cb.units > 0 ? cb.usd / cb.units : null
    const unrealisedSgd = costBasisSgd > 0 ? value - costBasisSgd : null
    const unrealisedPct = costBasisSgd > 0 ? (unrealisedSgd! / costBasisSgd) * 100 : null

    return { ticker: h.ticker, name: h.name, color: h.color, value, actualPct, targetPct: h.targetPct, driftPct, status, instruction, hardCapPct: h.hardCapPct, toleranceBand: h.toleranceBand, latestPrice, priceChangePct, priceHistory, avgCostUsd, costBasisSgd, unrealisedSgd, unrealisedPct, units: h.snapshots[0]?.units ?? 0 }
  })

  // ── Bitcoin sleeve consolidation — BTC + IBIT are ONE sleeve (7% target) ──────
  // BTC is in run-off (held, never bought/sold — a paper loss is not a sell signal); IBIT is
  // the accumulation vehicle. Recompute effective targets/status so the app never says
  // "buy more BTC" while you're transitioning into IBIT, and routes new Bitcoin money to IBIT.
  {
    const btcPos = positions.find(p => p.ticker === "BTC")
    const ibitPos = positions.find(p => p.ticker === "IBIT")
    if (btcPos && ibitPos && totalValue > 0) {
      const sleevePct = btcPos.actualPct + ibitPos.actualPct
      const sleeveCap = HARD_THRESHOLDS["IBIT"]?.high ?? 8
      // BTC — held, transitioning out. No buy/sell pressure.
      btcPos.targetPct = btcPos.actualPct
      btcPos.driftPct = 0
      btcPos.status = "healthy"
      btcPos.instruction = `Held as part of your Bitcoin sleeve. BTC + IBIT is ${sleevePct.toFixed(1)}% of a ${BITCOIN_SLEEVE_TARGET_PCT}% target. You're transitioning into IBIT — hold BTC (don't buy or sell it); new Bitcoin money goes to IBIT.`
      // IBIT — accumulation vehicle. Effective target fills the rest of the sleeve.
      const ibitTarget = Math.max(0, BITCOIN_SLEEVE_TARGET_PCT - btcPos.actualPct)
      const ibitBand = ibitPos.toleranceBand ?? 1
      ibitPos.targetPct = ibitTarget
      ibitPos.driftPct = ibitPos.actualPct - ibitTarget
      ibitPos.status = sleevePct > sleeveCap ? "hard" : Math.abs(ibitPos.driftPct) > ibitBand ? "soft" : "healthy"
      ibitPos.instruction = sleevePct > sleeveCap
        ? `Your Bitcoin sleeve (BTC + IBIT) is ${sleevePct.toFixed(1)}%, over its ${sleeveCap}% cap. Trim Bitcoin back toward ${BITCOIN_SLEEVE_TARGET_PCT}% at your next dealing window.`
        : ibitPos.driftPct < -0.05
        ? `Your Bitcoin sleeve (BTC + IBIT) is ${sleevePct.toFixed(1)}%, below its ${BITCOIN_SLEEVE_TARGET_PCT}% target. Add to IBIT — the tax-effective vehicle you're transitioning into — to bring the sleeve toward ${BITCOIN_SLEEVE_TARGET_PCT}%.`
        : ibitPos.driftPct > 0.05
        ? `Your Bitcoin sleeve (BTC + IBIT) is ${sleevePct.toFixed(1)}%, at/above its ${BITCOIN_SLEEVE_TARGET_PCT}% target. Hold IBIT — no new Bitcoin buys needed this month.`
        : `Your Bitcoin sleeve (BTC + IBIT) is on target at ${sleevePct.toFixed(1)}%. Keep IBIT steady.`
    }
  }

  const hasAnyAlert = positions.some(p => p.status !== "healthy")

  // Sort by severity for display
  const order: Record<ActionStatus, number> = { hard: 0, soft: 1, healthy: 2 }
  positions.sort((a, b) => order[a.status] - order[b.status])

  const driftAlerts   = positions.filter(p => p.status !== "healthy").length
  // Suppress maxDrift for zero-balance portfolios (all positions technically at -100% drift)
  const maxDrift      = hasBalance ? positions.reduce((max, p) => Math.max(max, Math.abs(p.driftPct)), 0) : 0

  // Stale data detection (must be before health score)
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
  const hardBreaches  = positions.filter(p => p.status === "hard").length
  const softBreaches  = positions.filter(p => p.status === "soft").length
  const snapshotAgeDays = daysSinceUpdate ?? 999
  const health = computePortfolioHealth({ hardBreaches, softBreaches, maxDrift, activeRules, totalRules, snapshotAgeDays })
  const healthScore = health.overall
  const healthLabel = health.overallLabel

  const monthlyContribution = user?.monthlyContribution ?? DEFAULT_MONTHLY
  const annualLumpSum = user?.annualLumpSum ?? DEFAULT_ANNUAL_LUMP_SUM
  const contributionGrowthRate = user?.contributionGrowthRate ?? DEFAULT_GROWTH_RATE

  // 2045 forecast (base case 10%, 19 years remaining from 2026)
  const yearsTo2045 = Math.max(1, 2045 - new Date().getFullYear())
  const base2045 = projectPortfolio(totalValue, monthlyContribution, annualLumpSum, 0.10, yearsTo2045, contributionGrowthRate)

  // Goal tracking: where should the portfolio be right now if on the base-case trajectory?
  // Project the START-OF-YEAR value forward by the months elapsed (the old code passed a
  // fractional year into an integer-year loop, so the loop never ran and on-track was always
  // 100%). If there is no pre-Jan-1 snapshot (account opened this year) on-track is null.
  const startOfYear = new Date(new Date().getFullYear(), 0, 1)
  const dayOfYear = Math.floor((Date.now() - startOfYear.getTime()) / 86_400_000)
  const monthsElapsed = Math.min(12, Math.max(0, Math.round(dayOfYear / 30.44)))
  const soySnaps = await Promise.all(
    holdings.map((h) => db.snapshot.findFirst({ where: { holdingId: h.id, date: { lt: startOfYear } }, orderBy: { date: "desc" } }))
  )
  const startOfYearValue = soySnaps.reduce((s, snap) => s + (snap?.value ?? 0), 0)
  let targetNow: number | null = null
  if (startOfYearValue > 0 && monthsElapsed > 0) {
    let v = startOfYearValue
    const mRate = 0.10 / 12
    for (let m = 0; m < monthsElapsed; m++) v = v * (1 + mRate) + monthlyContribution
    targetNow = v
  }
  const onTrackPct = targetNow && targetNow > 0 ? (totalValue / targetNow) * 100 : null

  // Next contribution countdown (15th of each month)
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

  // ── Next Best Move — the single highest-priority action across all signals ──
  // Market-aware: considers drift, concentration, opportunity (dips), and risk.
  const moveInputs: PositionInput[] = positions.map(p => ({
    ticker: p.ticker, name: p.name, color: p.color, value: p.value,
    actualPct: p.actualPct, targetPct: p.targetPct,
    hardCapPct: p.hardCapPct ?? null, toleranceBand: p.toleranceBand ?? 2.5,
    latestPrice: p.latestPrice ?? 0,
  }))
  // F1 — live market overlay (price/52w) replaces hardcoded figures in the engine.
  // Degrades gracefully to verified constants (marked stale) if Finnhub is unavailable.
  const [marketSnapshot, sgov] = await Promise.all([getLiveMarketPositions(), getSgovYield()])

  // §4 — live look-through concentration (effective company/sector exposure across all funds)
  const lookThrough = computeLookThrough(positions)
  const ltBreach = worstLookThroughBreach(lookThrough)
  const lookThroughBreach = ltBreach
    ? {
        label: ltBreach.label, pct: ltBreach.pct, hard: ltBreach.hard,
        trimTicker: largestContributor(ltBreach.key, lookThrough.companies.includes(ltBreach) ? "company" : "sector", positions),
      }
    : undefined

  // Slow-grind drawdown (§1.2 condition 2): peak → current over the tracked history.
  let portfolioDrawdownPct: number | undefined
  let drawdownDays: number | undefined
  if (historyPoints.length >= 2) {
    let peakIdx = 0
    for (let i = 1; i < historyPoints.length; i++) if (historyPoints[i].value > historyPoints[peakIdx].value) peakIdx = i
    const peak = historyPoints[peakIdx].value
    const current = historyPoints[historyPoints.length - 1].value
    if (peak > 0 && current < peak) {
      portfolioDrawdownPct = ((current - peak) / peak) * 100
      drawdownDays = Math.floor((Date.now() - new Date(completeDates[peakIdx]).getTime()) / 86_400_000)
    }
  }

  const nextBestMove = computeNextBestMove(moveInputs, totalValue, { market: marketSnapshot.positions, lookThroughBreach, portfolioDrawdownPct, drawdownDays })

  // F2 — buffer status: SGOV as % of NAV vs the 8–10% band.
  const sgovPos = positions.find(p => ["SGOV", "AGG", "CASH"].includes(p.ticker))
  const bufferPct = sgovPos ? sgovPos.actualPct : 0
  const bufferTargetLow = 8, bufferTargetHigh = 10
  const sgovValue = (bufferPct / 100) * totalValue
  const bufferNeeded = Math.max(0, (bufferTargetLow / 100) * totalValue - sgovValue)
  const bufferMonthsToBand = bufferNeeded > 0 && monthlyContribution > 0
    ? Math.ceil(bufferNeeded / monthlyContribution) : 0

  // US estate-tax exposure: value of US-domiciled ETFs in USD (excludes Irish-UCITS alts).
  const usSitedValueUsd = usdSgdRate > 0
    ? positions.filter(p => isUsSited(p.ticker)).reduce((s, p) => s + p.value / usdSgdRate, 0)
    : 0

  // Out-of-scope holdings: tickers held but outside the policy universe (e.g. a stock or ETF
  // bought in IBKR that the plan doesn't govern). Surfaced as an action + alert to triage.
  const outOfScopeTickers = positions.filter((p) => p.value > 0 && !isInScope(p.ticker)).map((p) => p.ticker.toUpperCase())

  // Governance alignment — are we inside our own rules right now?
  const govAlignment = evaluateGovernance({ positions, bufferPct, lookThrough, usSitedValueUsd })

  // Monthly 5-minute check cadence
  const lastMonthlyCheck = await getLastMonthlyCheck(userId)

  return { totalValue, hasBalance, positions, driftAlerts, maxDrift, activeRules, totalRules, snapshotAgeDays, healthScore, healthLabel, health, hasAnyAlert, hardBreaches, softBreaches, donutData, daysSinceUpdate, latestSnapshotDate: latestSnapshotDate?.toISOString() ?? null, base2045, yearsTo2045, daysToContribution, nextContributionLabel, historyPoints, valueChange, monthlyContribution, annualLumpSum, contributionGrowthRate, usdSgdRate, onTrackPct, nextBestMove,
    marketAsOf: marketSnapshot.asOf, marketStale: marketSnapshot.stale, marketNote: marketSnapshot.note,
    marketOverride: marketSnapshot.positions,
    bufferPct, bufferTargetLow, bufferTargetHigh, bufferMonthsToBand,
    sgovYieldPct: sgov.dividendYieldPct, sgovSecYieldPct: sgov.secYieldPct, sgovStale: sgov.stale,
    govAlignment, lastMonthlyCheck, outOfScopeTickers,
    updateHoldings: holdings.map((h) => ({
      id: h.id, ticker: h.ticker, name: h.name,
      latestUnits: h.snapshots[0]?.units ?? 0, latestPrice: h.snapshots[0]?.price ?? 0,
    })) }
}

const sections = [
  { title: "Your Holdings",     desc: "Your funds, the target for each, and their limits.", href: "/portfolio" },
  { title: "Your Rules",        desc: "The rules that keep you on track and where this month's money should go.", href: "/governance" },
  { title: "Staying Calm",      desc: "Resist panic-selling and over-tweaking. Read this before any big move.", href: "/behaviour" },
  { title: "What You Really Own", desc: "Look through your funds to the actual companies and sectors you hold.", href: "/reports" },
  { title: "2045 Projection",   desc: "How your money could grow by your 2045 retirement target.", href: "/forecast" },
]

export default async function Dashboard() {
  const session = await getSession()
  if (!session) redirect("/login")
  const {
    totalValue, hasBalance, positions, driftAlerts, maxDrift, activeRules, totalRules, snapshotAgeDays,
    healthScore, healthLabel, health, hasAnyAlert, hardBreaches, softBreaches, donutData,
    daysSinceUpdate, latestSnapshotDate, base2045, yearsTo2045, daysToContribution,
    nextContributionLabel, historyPoints, valueChange, monthlyContribution, annualLumpSum,
    contributionGrowthRate, usdSgdRate, onTrackPct, nextBestMove,
    marketAsOf, marketStale, marketOverride,
    bufferPct, bufferTargetLow, bufferTargetHigh, bufferMonthsToBand,
    sgovYieldPct, sgovSecYieldPct, sgovStale, govAlignment, lastMonthlyCheck, outOfScopeTickers,
    updateHoldings,
  } = await getDashboardData(session.userId)

  // Derive ticker order by target % descending (largest allocation first in footer summary)
  const allocOrder = [...positions].sort((a, b) => b.targetPct - a.targetPct).map(p => p.ticker)

  return (
    <Shell title="Dashboard" subtitle="Your investment operating system" userName={session.name} isAdmin={session.role === "admin"}>

      {/* Refresh toolbar — live prices + live holdings, right from the dashboard */}
      <div className="mb-5 flex flex-wrap items-start gap-2">
        <RefreshPricesButton />
        <PortfolioUpdateButton label="Update Holdings" holdings={updateHoldings} />
      </div>

      {/* New user welcome — no balance yet */}
      {!hasBalance && (
        <div className="mb-5 flex items-center gap-4 rounded-xl border border-primary/30 bg-primary/[0.06] px-5 py-4">
          <div className="shrink-0 flex h-10 w-10 items-center justify-center rounded-full bg-primary/15">
            <TrendingUp className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-primary">Portfolio configured — ready for your first snapshot</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Target allocations are set. Head to <a href="/portfolio" className="underline font-semibold">Portfolio</a> and enter your holdings to start tracking drift and health.
            </p>
          </div>
        </div>
      )}

      {/* Hard breach banner */}
      {hasBalance && hardBreaches > 0 && (
        <a href="#execution" className="mb-5 flex items-center gap-4 rounded-xl border-2 border-red-500/50 bg-red-500/10 dark:bg-red-500/[0.12] px-5 py-4 glow-red flash-red cursor-pointer hover:bg-red-500/[0.16] transition-colors group">
          <div className="shrink-0 flex h-10 w-10 items-center justify-center rounded-full bg-red-500/20 pulse-red">
            <XCircle className="h-5 w-5 text-red-500" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-extrabold text-red-600 dark:text-red-400 uppercase tracking-wide">
              Hard Drift Alert — {hardBreaches} position{hardBreaches > 1 ? "s" : ""} breached
            </p>
            <p className="text-xs text-red-600/80 dark:text-red-400/80 mt-0.5">
              Hard thresholds exceeded. Review next execution instructions below and take action at your next dealing window.
            </p>
          </div>
          <span className="shrink-0 text-xs font-semibold text-red-500/70 group-hover:text-red-500 transition-colors">View steps ↓</span>
        </a>
      )}

      {/* Soft drift banner */}
      {hasBalance && softBreaches > 0 && hardBreaches === 0 && (
        <a href="#execution" className="mb-5 flex items-center gap-4 rounded-xl border border-amber-400/40 bg-amber-400/10 dark:bg-amber-400/[0.08] px-5 py-3.5 glow-amber cursor-pointer hover:bg-amber-400/[0.14] transition-colors group">
          <div className="shrink-0 flex h-9 w-9 items-center justify-center rounded-full bg-amber-500/20 pulse-amber">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-amber-700 dark:text-amber-400">
              Soft Drift — {softBreaches} position{softBreaches > 1 ? "s" : ""} outside tolerance
            </p>
            <p className="text-xs text-amber-700/80 dark:text-amber-400/80 mt-0.5">
              Redirect next month&apos;s contributions according to the allocation plan below.
            </p>
          </div>
          <span className="shrink-0 text-xs font-semibold text-amber-500/70 group-hover:text-amber-500 transition-colors">View steps ↓</span>
        </a>
      )}

      {/* Out-of-scope holding alert — a ticker is held but outside the plan */}
      {hasBalance && outOfScopeTickers.length > 0 && (
        <a href="/portfolio" className="mb-5 flex items-center gap-4 rounded-xl border border-amber-400/40 bg-amber-400/10 dark:bg-amber-400/[0.08] px-5 py-3.5 hover:bg-amber-400/[0.14] transition-colors group">
          <div className="shrink-0 flex h-9 w-9 items-center justify-center rounded-full bg-amber-500/20">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-amber-700 dark:text-amber-400">
              {outOfScopeTickers.join(", ")} {outOfScopeTickers.length > 1 ? "are" : "is"} held but not in your plan
            </p>
            <p className="text-xs text-amber-700/80 dark:text-amber-400/80 mt-0.5">
              Imported so your totals stay accurate. Decide what to do: keep it and set a target, switch to an approved alternative, or sell it.
            </p>
          </div>
          <span className="shrink-0 text-xs font-semibold text-amber-500/70 group-hover:text-amber-500 transition-colors">Review →</span>
        </a>
      )}

      {/* Stale data warning — only when portfolio has balance */}
      {hasBalance && daysSinceUpdate !== null && daysSinceUpdate >= 3 && (
        <a href="/portfolio" className={`mb-5 flex items-center gap-3 rounded-xl border px-5 py-3 transition-colors group ${
          daysSinceUpdate >= 7
            ? "border-red-500/30 bg-red-500/[0.07] hover:bg-red-500/[0.11]"
            : "border-amber-400/30 bg-amber-400/[0.07] hover:bg-amber-400/[0.11]"
        }`}>
          <Activity className={`h-4 w-4 shrink-0 ${daysSinceUpdate >= 7 ? "text-red-500" : "text-amber-500"}`} />
          <p className={`text-xs flex-1 ${daysSinceUpdate >= 7 ? "text-red-600 dark:text-red-400" : "text-amber-700 dark:text-amber-400"}`}>
            <span className="font-bold">Prices last updated {daysSinceUpdate} day{daysSinceUpdate !== 1 ? "s" : ""} ago</span>
            {" — "}
            {latestSnapshotDate ? new Date(latestSnapshotDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : ""}
            {daysSinceUpdate >= 7 ? ". Portfolio values may be significantly out of date." : ". Consider updating your prices."}
          </p>
          <span className={`shrink-0 text-xs font-semibold transition-colors ${daysSinceUpdate >= 7 ? "text-red-500/70 group-hover:text-red-500" : "text-amber-500/70 group-hover:text-amber-500"}`}>
            Update now →
          </span>
        </a>
      )}

      {/* Main layout: left = content, right = health + donut */}
      <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
        <div className="space-y-5 min-w-0">

          {/* Monthly 5-minute check cadence */}
          {hasBalance && <MonthlyCheck lastCheckIso={lastMonthlyCheck} />}

          {/* Next Best Move — the single clearest action, always present */}
          {hasBalance && <NextBestMove move={nextBestMove} dataAsOf={marketAsOf} stale={marketStale} />}

          {/* KPI strip */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <a href="/ytd" className="rounded-xl border border-border bg-card p-4 card-elevated flex flex-col gap-2 hover:border-primary/30 hover:bg-accent/40 transition-colors group">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Portfolio Value</span>
                <TrendingUp className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              <p className="text-2xl font-black tabular-nums">{formatCurrency(totalValue, "SGD")}</p>
              <p className="text-[11px] text-muted-foreground">
                SGD · USD/SGD {usdSgdRate.toFixed(4)}
              </p>
            </a>

            <a href="/governance" className="rounded-xl border border-border bg-card p-4 card-elevated flex flex-col gap-2 hover:border-primary/30 hover:bg-accent/40 transition-colors group">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Active Rules</span>
                <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              <p className="text-2xl font-black tabular-nums">{activeRules}</p>
              <p className="text-[11px] text-muted-foreground">{activeRules}/{totalRules} governance rules active</p>
            </a>

            <a href="/portfolio" className={`rounded-xl border bg-card p-4 card-elevated flex flex-col gap-2 hover:bg-accent/40 transition-colors group ${driftAlerts > 0 ? "border-amber-400/40" : "border-border hover:border-primary/30"}`}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Off Target</span>
                <AlertTriangle className={`h-3.5 w-3.5 ${driftAlerts > 0 ? "text-amber-500" : "text-muted-foreground group-hover:text-primary transition-colors"}`} />
              </div>
              <p className={`text-2xl font-black tabular-nums ${driftAlerts > 0 ? (hardBreaches > 0 ? "text-red-500" : "text-amber-500") : "text-green-500"}`}>
                {driftAlerts}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {driftAlerts === 0 ? "All on target" : `${driftAlerts} holding${driftAlerts > 1 ? "s" : ""} off target`}
              </p>
            </a>

            <a href="/forecast" className={`rounded-xl border bg-card p-4 card-elevated flex flex-col gap-2 hover:bg-accent/40 transition-colors group ${
              onTrackPct === null ? "border-border hover:border-primary/30" :
              onTrackPct >= 95 ? "border-green-500/30" :
              onTrackPct >= 80 ? "border-yellow-400/30" : "border-red-500/30"
            }`}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">On Track</span>
                <Activity className={`h-3.5 w-3.5 ${
                  onTrackPct === null ? "text-muted-foreground group-hover:text-primary transition-colors" :
                  onTrackPct >= 95 ? "text-green-500" :
                  onTrackPct >= 80 ? "text-yellow-400" : "text-red-500"
                }`} />
              </div>
              <p className={`text-2xl font-black tabular-nums ${
                onTrackPct === null ? "text-muted-foreground" :
                onTrackPct >= 95 ? "text-green-500" :
                onTrackPct >= 80 ? "text-yellow-400" : "text-red-500"
              }`}>
                {onTrackPct !== null ? `${onTrackPct.toFixed(0)}%` : "—"}
              </p>
              <p className="text-[11px] text-muted-foreground">vs your plan for 2045</p>
            </a>
          </div>

          {/* Rule check — alignment with governance rules, plain English */}
          {hasBalance && govAlignment && <GovernanceAlignment data={govAlignment} />}

          {/* Your Holdings — first-page table: price trend · price · your cost · unrealised gain
              (approved alternatives, e.g. VWRA for VT, are labelled where held) */}
          {hasBalance && <HoldingsTable positions={positions} totalValue={totalValue} />}

          {/* Next Execution Instructions */}
          <div id="execution">
            <CollapsibleSection
              title="What To Do This Month"
              defaultOpen={true}
              badge={
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                  {daysToContribution === 0 ? "Contribution due today" : `${daysToContribution}d to next contribution`}
                </span>
              }
            >
              <ExecutionPlan
                positions={positions}
                totalValue={totalValue}
                hasBalance={hasBalance}
                allocOrder={allocOrder}
                hasAnyAlert={hasAnyAlert}
                defaultContribution={monthlyContribution}
                annualLumpSum={annualLumpSum}
                marketOverride={marketOverride}
              />
            </CollapsibleSection>
          </div>

          {/* Your Action Plan — the staged, step-by-step sequence (source of truth,
              shared with the Command Centre "When to Act" calendar) */}
          {hasBalance && (
            <CollapsibleSection
              title="Your Action Plan — Step by Step"
              defaultOpen={true}
              badge={
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                  Do these in order
                </span>
              }
            >
              <ActionPlan />
            </CollapsibleSection>
          )}

          {/* How to use Atlas */}
          <CollapsibleSection title="How to Use Atlas" defaultOpen={false}>
            <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
              {[
                {
                  step: "1",
                  title: "Update your portfolio",
                  body: "Go to the Portfolio page and enter your current units and price for each holding. You can type them in manually, upload a screenshot from IBKR, or use the live price refresh. Do this at least once a month — ideally after your monthly contribution.",
                  href: "/portfolio",
                  cta: "Go to Portfolio →",
                },
                {
                  step: "2",
                  title: "Read the dashboard alerts",
                  body: "When positions drift outside their target bands, alerts appear at the top. Red = hard breach (urgent action — check badge for Buy now or Halt buys). Yellow = soft underweight (add more over 2–3 months). Orange = soft overweight (slow contributions). Green = on track.",
                  href: null,
                  cta: null,
                },
                {
                  step: "3",
                  title: "Follow the monthly plan",
                  body: "The \"What To Do This Month\" section tells you exactly how to split your $3,000 monthly contribution. Follow the suggested amounts — they are calculated to reduce drift and move your portfolio toward targets. Never deviate based on short-term market noise.",
                  href: "#execution",
                  cta: "See this month's plan ↓",
                },
                {
                  step: "4",
                  title: "Check the health score",
                  body: "The health gauge in the sidebar scores your portfolio across four dimensions: Structural (drift integrity), Behavioural (governance rule compliance), Concentration (hard-cap exposure), and Execution (how fresh your data is). Aim to stay above 80.",
                  href: null,
                  cta: null,
                },
                {
                  step: "5",
                  title: "Review reports monthly",
                  body: "The Reports page shows your look-through exposure to individual companies (Nvidia, Microsoft, Apple, etc.) and sectors (semiconductor, digital economy). Check that no company or sector has breached its hard cap before each contribution.",
                  href: "/reports",
                  cta: "Open Reports →",
                },
                {
                  step: "6",
                  title: "Never sell on emotion",
                  body: "Atlas is a long-horizon system (2045). It is designed to keep you disciplined through volatility. If you feel the urge to sell, go to the Behaviour page and read the red-flag checklist before doing anything.",
                  href: "/behaviour",
                  cta: "Read Behaviour System →",
                },
              ].map(({ step, title, body, href, cta }) => (
                <div key={step} className="flex items-start gap-4 px-5 py-4">
                  <div className="shrink-0 flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-[11px] font-black text-primary mt-0.5">{step}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold mb-1">{title}</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">{body}</p>
                    {href && cta && (
                      <a href={href} className="inline-block mt-2 text-[11px] font-semibold text-primary hover:underline">{cta}</a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CollapsibleSection>

          {/* System overview */}
          <CollapsibleSection title="System Overview" defaultOpen={false}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {sections.map(({ title, desc, href }) => (
                <a
                  key={href}
                  href={href}
                  className="group rounded-xl border border-border bg-card p-4 transition-all hover:border-primary/30 hover:bg-accent/40 hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-semibold group-hover:text-primary transition-colors">{title}</h3>
                    <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-green-500/10 text-green-600 dark:text-green-400 ring-1 ring-green-500/20">Active</span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground leading-relaxed">{desc}</p>
                </a>
              ))}
            </div>
          </CollapsibleSection>
        </div>

        {/* Right sidebar — health + allocation */}
        <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">

          {/* Health gauge */}
          <div className="rounded-xl border border-border bg-card p-5 card-elevated">
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">Portfolio Health</h2>
            <div className="flex justify-center">
              <HealthGauge score={healthScore} label={healthLabel} />
            </div>
            <div className="mt-4 pt-4 border-t border-border space-y-3">
              {[health.structural, health.behavioural, health.concentration, health.execution].map((dim) => {
                const barColor =
                  dim.status === "excellent" ? "bg-green-500" :
                  dim.status === "good"      ? "bg-emerald-400" :
                  dim.status === "caution"   ? "bg-amber-400" :
                                               "bg-red-500"
                const textColor =
                  dim.status === "excellent" ? "text-green-500" :
                  dim.status === "good"      ? "text-emerald-400" :
                  dim.status === "caution"   ? "text-amber-400" :
                                               "text-red-500"
                return (
                  <div key={dim.label}>
                    <div className="flex items-center justify-between mb-1">
                      <div>
                        <span className="text-[11px] font-semibold">{dim.label}</span>
                        <span className="text-[10px] text-muted-foreground ml-1.5">{dim.description}</span>
                      </div>
                      <span className={`text-[11px] font-bold tabular-nums ${textColor}`}>{dim.score}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${dim.score}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
            <HealthMethodology
              structural={health.structural.score}
              behavioural={health.behavioural.score}
              concentration={health.concentration.score}
              execution={health.execution.score}
              hardBreaches={hardBreaches}
              softBreaches={softBreaches}
              maxDrift={maxDrift}
              activeRules={activeRules}
              totalRules={totalRules}
              snapshotAgeDays={snapshotAgeDays}
            />
          </div>

          {/* Shock buffer status (F2) */}
          {hasBalance && (
            <BufferStatus
              currentPct={bufferPct}
              targetLow={bufferTargetLow}
              targetHigh={bufferTargetHigh}
              monthsToBand={bufferMonthsToBand}
              yieldPct={sgovYieldPct}
              secYieldPct={sgovSecYieldPct}
              monthlyContribution={monthlyContribution}
              stale={sgovStale}
            />
          )}

          {/* Portfolio value history */}
          {historyPoints.length >= 2 && (
            <div className="rounded-xl border border-border bg-card p-4 card-elevated">
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Value History</h2>
                {valueChange !== null && (
                  <span className={`text-[11px] font-bold tabular-nums ${valueChange >= 0 ? "text-green-500" : "text-red-500"}`}>
                    {valueChange >= 0 ? "+" : ""}{formatCurrency(valueChange, "SGD")}
                  </span>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground mb-2">{historyPoints.length} snapshots</p>
              <PortfolioHistoryChart data={historyPoints} />
            </div>
          )}

          {/* 2045 Goal + Contribution countdown */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-border bg-card p-4 card-elevated">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">2045 Base Case</p>
              <p className="text-lg font-black tabular-nums gradient-text leading-tight">
                {base2045 >= 1_000_000
                  ? `$${(base2045 / 1_000_000).toFixed(1)}M`
                  : `$${(base2045 / 1_000).toFixed(0)}K`}
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">10% p.a. · {yearsTo2045} yr</p>
              <div className="mt-2 h-1 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary/60"
                  style={{ width: `${Math.min(100, (totalValue / base2045) * 100)}%` }}
                />
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">{((totalValue / base2045) * 100).toFixed(1)}% of goal</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4 card-elevated">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Next Contribution</p>
              <p className="text-lg font-black tabular-nums leading-tight">
                {daysToContribution === 0 ? "Today" : `${daysToContribution}d`}
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">{nextContributionLabel} · $3,000</p>
              <div className="mt-2 h-1 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary/60"
                  style={{ width: `${Math.max(5, 100 - (daysToContribution / 31) * 100)}%` }}
                />
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">monthly schedule</p>
            </div>
          </div>

          {/* Allocation donut */}
          <div className="rounded-xl border border-border bg-card p-5 card-elevated">
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-1">Allocation</h2>
            <p className="text-[11px] text-muted-foreground mb-3">Outer = actual · Inner = target</p>
            <AllocationDonut
              data={donutData}
              totalValue={totalValue}
            />
          </div>
        </div>
      </div>
    </Shell>
  )
}
