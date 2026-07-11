import Link from "next/link"
import { Shell } from "@/components/shell"
import { db } from "@/lib/db"
import { formatCurrency } from "@/lib/utils"
import { FileText, ChevronRight, TrendingUp } from "lucide-react"
import { getSbrMarketData } from "@/lib/sbr-market"
import { buildPortfolioTimeline } from "@/lib/portfolio-metrics"
import { SILICON_BRICK_ROAD as SBR } from "@/lib/constitutions"
import { computeSbrNextMove, computeSbrDca, computeSbrHealth, sbrPhase, type SbrPosition } from "@/lib/sbr-engine"
import { sbrBlendedGrowthRate, monthsToTarget } from "@/lib/sbr-forecast"
import { evaluateSbrGovernance } from "@/lib/sbr-governance"
import { DownloadReportCard } from "@/components/reports/download-report-card"
import { HoldingsTable, type HoldingRow } from "@/components/dashboard/holdings-table"
import { GovernanceAlignment } from "@/components/dashboard/governance-alignment"
import { getRecentExecutions } from "@/lib/execution-actions"
import type { GovAlignment } from "@/lib/governance-status"
import { GovernanceSeal, type SealDimension } from "@/components/cockpit/governance-seal"
import { ComplianceBoard, type ComplianceBandPosition } from "@/components/cockpit/compliance-board"
import { PortfolioHistoryChart } from "@/components/charts/portfolio-history-chart"
import { AllocationDonut } from "@/components/charts/allocation-donut"
import { AnimatedNumber } from "@/components/animated-number"
import { getUsdSgdRate } from "@/lib/holdings-sync"
import { getDealingWindow, isInDealingWindow } from "@/lib/constitution"
import { CommitteeMinuteForm } from "@/components/sbr/committee-minute-form"
import { BrickRoad } from "@/components/sbr/brick-road"
import { sbrBrickRoadPhases } from "@/lib/spec-derived"
import { computeSbrLookThrough } from "@/lib/sbr-look-through"

const SBR_FUND_TICKERS = SBR.funds.map(f => f.ticker)

// Phase thresholds as fractions of the 120k target
const PHASE_MARKS = [
  { label: "I",   endFrac: 72000  / 120000 },
  { label: "II",  endFrac: 96000 / 120000 },
  { label: "III", endFrac: 114000 / 120000 },
  { label: "IV",  endFrac: 1.0              },
]

function dimStatus(score: number): SealDimension["status"] {
  return score >= 90 ? "excellent" : score >= 75 ? "good" : score >= 55 ? "caution" : "critical"
}

// Turns a month count into a plain "Mon YYYY" label — null means the search bound (50
// years) was hit without reaching the target; 0 means the target is already met.
function monthsToLabel(months: number | null): string {
  if (months === null) return "50+ years away at this rate"
  if (months === 0) return "already there"
  const d = new Date()
  d.setDate(1) // avoid month rollover quirks (e.g. Jan 31 + 1 month)
  d.setMonth(d.getMonth() + months)
  return d.toLocaleDateString("en-GB", { month: "short", year: "numeric" })
}

// Annual SGD/USD reference rate used to detect currency drift (Art. VI FX policy).
// Refresh this value annually from MAS or your brokerage's reference data.
const FX_REFERENCE_USDSGD = 1.35
const FX_BAND_PCT = 5 // ±5% from reference triggers a note

async function getSbrData(userId: string) {
  const [holdings, market, recentExec, usdSgdRate, recentPhaseLog, cashBank, recentMinute] = await Promise.all([
    // Filter to SBR tickers only — prevents Atlas Core holdings from bleeding into SBR views
    db.holding.findMany({ where: { userId, ticker: { in: SBR_FUND_TICKERS } }, include: { snapshots: { orderBy: { date: "desc" }, take: 8 } } }),
    getSbrMarketData(),
    getRecentExecutions(userId, 1),
    getUsdSgdRate(),
    db.behaviourLog.findFirst({
      where: { userId, type: "sbr-phase-transition", date: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      orderBy: { date: "desc" },
    }),
    db.dcaCashBank.findUnique({ where: { userId_constitutionId_currency: { userId, constitutionId: "silicon-brick-road", currency: "SGD" } } }),
    db.behaviourLog.findFirst({
      where: { userId, type: "committee-minute", date: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) } },
      orderBy: { date: "desc" },
    }),
  ])
  const fundOrder = SBR.funds.map((f) => f.ticker)
  const holdingsSorted = [...holdings].sort((a, b) => fundOrder.indexOf(a.ticker) - fundOrder.indexOf(b.ticker))
  const totalValue = holdings.reduce((s, h) => s + (h.snapshots[0]?.value ?? 0), 0)

  const priceMap = market.positions
  const positions: SbrPosition[] = holdingsSorted.map((h) => {
    const fund = SBR.funds.find((f) => f.ticker === h.ticker)
    const value = h.snapshots[0]?.value ?? 0
    const actualPct = totalValue > 0 ? (value / totalValue) * 100 : 0
    const live = priceMap[h.ticker]
    return {
      // Registry colour wins over the DB row so a palette rebrand applies without a reseed.
      ticker: h.ticker, name: h.name, color: fund?.color ?? h.color, value, actualPct,
      targetPct: h.targetPct, rangeLow: fund?.rangeLow ?? h.targetPct - h.toleranceBand,
      rangeHigh: fund?.rangeHigh ?? h.targetPct + h.toleranceBand, hardCap: h.hardCapPct,
      floor: fund?.floor, latestPrice: live?.price || h.snapshots[0]?.price || 0, hi52: live?.hi52 || 0,
    }
  })

  const timeline = buildPortfolioTimeline(holdings)
  let drawdownPct: number | undefined
  if (timeline.length >= 2) {
    const peak = Math.max(...timeline.map((t) => t.value))
    const current = timeline[timeline.length - 1].value
    if (peak > 0 && current < peak) drawdownPct = ((current - peak) / peak) * 100
  }
  const historyPoints = timeline.map(t => ({
    label: new Date(t.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
    value: t.value,
  }))
  const valueChange = timeline.length >= 2 ? timeline[timeline.length - 1].value - timeline[timeline.length - 2].value : null

  const phase = sbrPhase(totalValue)
  const nextMove = computeSbrNextMove(positions, totalValue, { drawdownPct })
  const dca = computeSbrDca(positions, SBR.monthlyContribution, { drawdownPct })
  const dcaByTicker = new Map(dca.allocations.map((a) => [a.ticker, a]))

  // Time to goal — blended from the ACTUAL current fund mix (not target weights), so a
  // drifted portfolio's projection reflects what's really held, same as everywhere else.
  const allocMap: Record<string, number> = {}
  for (const p of positions) allocMap[p.ticker] = p.actualPct
  const growthRates = sbrBlendedGrowthRate(allocMap)
  const target = SBR.targetValue ?? 120000
  const monthsToGoal = {
    conservative: monthsToTarget(totalValue, SBR.monthlyContribution, growthRates.conservative, target),
    base:         monthsToTarget(totalValue, SBR.monthlyContribution, growthRates.base, target),
    aggressive:   monthsToTarget(totalValue, SBR.monthlyContribution, growthRates.aggressive, target),
  }

  // Governance status — shared with the PDF report so both surfaces agree.
  const govAlignment: GovAlignment = evaluateSbrGovernance(positions, totalValue)
  const lookThrough = computeSbrLookThrough(positions)

  // Holdings rows
  const statusOf = (p: SbrPosition): HoldingRow["status"] => {
    const hard = (p.hardCap !== null && p.actualPct > p.hardCap) || (p.floor !== undefined && p.actualPct < p.floor)
    const soft = !hard && (p.actualPct < p.rangeLow || p.actualPct > p.rangeHigh)
    return hard ? "hard" : soft ? "soft" : "healthy"
  }
  const holdingsRows: HoldingRow[] = holdingsSorted.map((h) => {
    const p = positions.find((x) => x.ticker === h.ticker)!
    const cb = h.snapshots[0]
    const a = dcaByTicker.get(h.ticker)
    return {
      ticker: h.ticker, name: h.name, color: p.color, units: cb?.units ?? 0, value: p.value,
      latestPrice: cb?.price ?? 0, priceChangePct: null, priceHistory: [],
      avgCostUsd: null, unrealisedSgd: null, unrealisedPct: null,
      actualPct: p.actualPct, targetPct: h.targetPct, toleranceBand: h.toleranceBand,
      hardCapPct: h.hardCapPct, status: statusOf(p),
      thisMonth: a ? { amount: a.amount, tag: a.tag, reason: a.reason } : null,
    }
  })

  // Compliance Board bands
  const complianceBands: ComplianceBandPosition[] = positions.map((p) => ({
    ticker: p.ticker, name: p.name, color: p.color, value: p.value,
    actualPct: p.actualPct, targetPct: p.targetPct,
    softLow: p.rangeLow, softHigh: p.rangeHigh,
    hardHigh: p.hardCap ?? p.rangeHigh + 5,
    status: statusOf(p),
  }))

  // Donut data
  const donutData = holdingsSorted.map((h) => {
    const value = h.snapshots[0]?.value ?? 0
    const actualPct = totalValue > 0 ? (value / totalValue) * 100 : 0
    const fundColor = SBR.funds.find((f) => f.ticker === h.ticker)?.color ?? h.color
    return { ticker: h.ticker, name: h.name, actualPct, targetPct: h.targetPct, color: fundColor, value }
  })

  const latest = holdings.reduce<Date | null>((d, h) => { const s = h.snapshots[0]?.date; return s && (!d || s > d) ? s : d }, null)
  const snapshotAgeDays = latest ? Math.floor((Date.now() - new Date(latest).getTime()) / 86_400_000) : 999
  const health = computeSbrHealth(positions, totalValue, snapshotAgeDays)

  // FX strip — live rate vs annual reference
  const fxDeviation = ((usdSgdRate - FX_REFERENCE_USDSGD) / FX_REFERENCE_USDSGD) * 100
  const fxOutOfBand = Math.abs(fxDeviation) > FX_BAND_PCT

  // Dealing window — tells Dami when she needs to act and when she's done
  const now = new Date()
  const dealingWindow = getDealingWindow(now)
  const windowOpen = isInDealingWindow(now)
  const nextWindowOpens = windowOpen ? null : getDealingWindow(new Date(now.getFullYear(), now.getMonth() + 1, 1)).opens

  // Exceptional Market Event detection — portfolio down ≥30% from peak
  const EME_THRESHOLD = -30
  const emeActive = drawdownPct !== undefined && drawdownPct <= EME_THRESHOLD
  const emeMinuteFiled = recentMinute !== null

  // Phase crossing — fired in last 7 days by the daily digest cron
  const phaseCrossedRecently = recentPhaseLog !== null && !recentPhaseLog.note.includes("initial phase baseline")
  const newPhaseFromLog = recentPhaseLog?.note?.match(/from Phase ([IVX]+) to Phase ([IVX]+)/)?.[2] ?? null

  // Accrual carry-forward map (SGD banked toward next whole share/lot)
  const accrualMap: Record<string, number> = {}
  for (const h of holdings) accrualMap[h.ticker] = h.accrualBalanceSgd ?? 0

  return {
    totalValue, valueChange, phase, nextMove, dca, holdingsRows, govAlignment, health,
    marketStale: market.stale, marketAsOf: market.asOf, lastDone: recentExec[0] ?? null,
    historyPoints, complianceBands, donutData, growthRates, monthsToGoal,
    usdSgdRate, fxDeviation, fxOutOfBand,
    dealingWindow, windowOpen, nextWindowOpens,
    emeActive, emeMinuteFiled, drawdownPct,
    phaseCrossedRecently, newPhaseFromLog,
    accrualMap, cashBankBalance: cashBank?.balance ?? 0, lookThrough,
  }
}

export async function SbrDashboard({ userId, name, isAdmin }: { userId: string; name: string; isAdmin: boolean }) {
  const d = await getSbrData(userId)
  const target = SBR.targetValue ?? 120000
  const valueFrac = target > 0 ? Math.min(1, d.totalValue / target) : 0
  const progress = Math.round(valueFrac * 100)
  const hasBalance = d.totalValue > 0

  // Convert SBR health dimensions to SealDimension format (weighted points)
  const sealDimensions: SealDimension[] = [
    { label: "Governance",   score: Math.round(d.health.governance    * 0.25), maxScore: 25, status: dimStatus(d.health.governance) },
    { label: "Risk",         score: Math.round(d.health.risk          * 0.20), maxScore: 20, status: dimStatus(d.health.risk) },
    { label: "Allocation",   score: Math.round(d.health.allocation    * 0.15), maxScore: 15, status: dimStatus(d.health.allocation) },
    { label: "Contribution", score: Math.round(d.health.contribution  * 0.15), maxScore: 15, status: dimStatus(d.health.contribution) },
    { label: "Behaviour",    score: Math.round(d.health.behavioural   * 0.10), maxScore: 10, status: dimStatus(d.health.behavioural) },
    { label: "Liquidity",    score: Math.round(d.health.liquidity     * 0.10), maxScore: 10, status: dimStatus(d.health.liquidity) },
    { label: "Docs",         score: Math.round(d.health.documentation * 0.05), maxScore: 5,  status: dimStatus(d.health.documentation) },
  ]

  return (
    <Shell title="Your Plan" subtitle="Silicon Brick Road — flexible medium-term growth" userName={name} isAdmin={isAdmin}>

      {/* Constitution banner */}
      <a href="/silicon-brick-road.html" target="_blank" rel="noopener noreferrer"
        className="rounded-xl border border-sky-500/40 bg-gradient-to-r from-sky-500/[0.10] via-blue-500/[0.07] to-cyan-500/[0.06] p-4 mb-5 flex items-center gap-3 hover:from-sky-500/[0.12] transition-colors group">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/20 shrink-0"><FileText className="h-4 w-4 text-sky-400" /></div>
        <div className="flex-1">
          <p className="text-xs font-bold text-sky-400">Silicon Brick Road — Investment Constitution (v3.2)</p>
          <p className="text-xs text-muted-foreground">The complete flexible-horizon plan — four funds, whole-share cash bank, concentration rules and future exit protocol.</p>
        </div>
        <span className="text-xs font-semibold text-sky-400 group-hover:text-sky-300 shrink-0">Open ↗</span>
      </a>

      {/* Flexible-horizon runway — no invented property target or automatic phase. */}
      <div className="rounded-2xl card-lux p-5 mb-5">
        <p className="text-[10px] font-bold uppercase tracking-widest text-sky-400">Where we are going</p>
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mt-2">
          <div><p className="text-2xl font-black tabular-nums">{hasBalance ? <AnimatedNumber value={d.totalValue} currency="SGD" /> : "S$0 invested"}</p><p className="text-xs text-muted-foreground mt-1">Flexible medium-term compounding · no required end date</p></div>
          <div className="text-left sm:text-right"><p className="text-xl font-black text-sky-400">9–10%</p><p className="text-[10px] text-muted-foreground">planning ambition, not a promise</p></div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-muted/25 p-2"><p className="text-[10px] text-muted-foreground">Now</p><p className="text-xs font-bold">Growth mode</p></div>
          <div className="rounded-lg bg-muted/25 p-2"><p className="text-[10px] text-muted-foreground">During a fall</p><p className="text-xs font-bold">Stay invested</p></div>
          <div className="rounded-lg bg-muted/25 p-2"><p className="text-[10px] text-muted-foreground">Real use appears</p><p className="text-xs font-bold">Write exit plan</p></div>
        </div>
      </div>

      {/* Phase crossing celebration — fires for 7 days after the cron logs a transition */}
      {hasBalance && d.phaseCrossedRecently && d.newPhaseFromLog && (
        <div className="mb-5 rounded-xl border border-green-500/30 bg-green-500/[0.06] px-5 py-4">
          <p className="text-sm font-bold text-green-400">You&apos;ve entered Phase {d.newPhaseFromLog}!</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            The rules change as you move up. Check the Phase details below and the Decision Engine output — the plan updates automatically.
          </p>
        </div>
      )}

      {/* Exceptional Market Event — EME detected (portfolio down ≥30% from peak) */}
      {hasBalance && d.emeActive && (
        <div className="mb-5 rounded-xl border border-red-500/40 bg-red-500/[0.06] px-5 py-4 space-y-3">
          <div>
            <p className="text-sm font-bold text-red-400">
              Exceptional Market Event — portfolio down {d.drawdownPct !== undefined ? Math.abs(d.drawdownPct).toFixed(0) : "30"}% from peak
            </p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              The EME circuit breaker is active. The monthly contribution still follows the Decision Engine.
              But no discretionary sell is permitted until a committee minute is filed (both parties must agree in writing).
            </p>
          </div>
          {d.emeMinuteFiled
            ? <p className="text-xs text-green-400 font-semibold">✓ Committee minute on file — circuit breaker satisfied for this period.</p>
            : <CommitteeMinuteForm defaultArticle="EME protocol — panic circuit breaker" />
          }
        </div>
      )}

      {/* Terminal state — shown when the dealing window is closed (Dami is done for this month) */}
      {hasBalance && !d.windowOpen && d.nextWindowOpens && (
        <div className="mb-5 rounded-xl border border-sky-500/30 bg-sky-500/[0.06] px-5 py-4">
          <p className="text-sm font-bold text-sky-400">
            You&apos;re done for {d.dealingWindow.contributionDay.toLocaleDateString("en-SG", { month: "long" })}.
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            The road doesn&apos;t need you until{" "}
            <span className="font-semibold text-foreground">
              {d.nextWindowOpens.toLocaleDateString("en-SG", { day: "numeric", month: "long" })}
            </span>
            . Your next buying window opens then — come back and run the Decision Engine.
          </p>
        </div>
      )}

      {/* Dealing window open — remind Dami to act before the window closes */}
      {hasBalance && d.windowOpen && (
        <div className="mb-5 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-5 py-4">
          <p className="text-sm font-bold text-amber-400">
            Buying window is open — act before{" "}
            {d.dealingWindow.closes.toLocaleDateString("en-SG", { day: "numeric", month: "long" })}.
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Follow &ldquo;This month&rdquo; below. Once you&apos;ve bought, you&apos;re done until next month.
          </p>
        </div>
      )}

      {/* Empty-state welcome — covers both "nothing entered yet" and "funds set but showing S$0" */}
      {!hasBalance && (
        <div className="mb-5 rounded-xl border border-sky-500/30 bg-sky-500/[0.06] px-5 py-4">
          <p className="text-sm font-bold text-sky-400">SBR currently holds no securities</p>
          <p className="text-xs text-muted-foreground mt-0.5">The approved target is IMID 80 · EQAC 10 · SMH 5 · IB01 5. Current exposure remains zero until an IBKR purchase settles; the first contribution routes to IMID.</p>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
        <div className="space-y-5 min-w-0 reveal-stack">

          {/* 1. This month — the single decision Dami needs, first on the page */}
          {hasBalance && (
            <div className="rounded-2xl ring-hero overflow-hidden">
              <div className="px-5 py-3.5 border-b border-border flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-sky-400">This month</p>
                  <p className="text-base font-semibold mt-0.5">{d.nextMove.action}</p>
                </div>
                <span className={`shrink-0 text-[10px] font-bold px-2.5 py-1 rounded-full border ${
                  d.nextMove.severity === "critical" || d.nextMove.severity === "high" ? "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400" :
                  d.nextMove.severity === "medium" ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400" :
                  "border-green-500/40 bg-green-500/10 text-green-600 dark:text-green-400"
                }`}>
                  {d.nextMove.severity === "none" ? "On track" :
                   d.nextMove.severity === "medium" ? "Heads up" :
                   d.nextMove.severity === "high" ? "Important" : "Act now"}
                </span>
              </div>

              {/* Where the money goes this month */}
              {d.dca.overlayNote && (
                <p className="px-5 pt-3 text-[11px] text-amber-500 leading-relaxed">{d.dca.overlayNote}</p>
              )}
              <div className="divide-y divide-border/60">
                {d.dca.allocations.map((a) => {
                  const accrual = d.accrualMap[a.ticker] ?? 0
                  return (
                    <div key={a.ticker} className="px-5 py-3 flex items-center gap-3">
                      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: a.color }} />
                      <span className="font-bold text-sm w-14">{a.ticker}</span>
                      <div className="flex-1 min-w-0">
                        <span className="text-xs text-muted-foreground block">{a.reason}</span>
                        {accrual > 0 && (
                          <span className="text-[10px] text-sky-400 mt-0.5 block">
                            {a.ticker === "A35"
                              ? `Banking ${formatCurrency(accrual, "SGD")} of ~SGD 1,180 needed — buys next lot`
                              : `Banking ${formatCurrency(accrual, "SGD")} toward next share`
                            }
                          </span>
                        )}
                      </div>
                      <span className={`text-sm font-bold tabular-nums ${a.amount > 0 ? "text-green-500" : "text-muted-foreground"}`}>
                        {a.amount > 0 ? `+${formatCurrency(a.amount, "SGD")}` : formatCurrency(0, "SGD")}
                      </span>
                    </div>
                  )
                })}
              </div>

              {/* Why, in plain English */}
              <div className="m-4 rounded-lg border border-border bg-muted/30 p-4">
                <p className="text-xs leading-relaxed mb-1.5">{d.nextMove.what}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{d.nextMove.why}</p>
                {d.nextMove.when && (
                  <p className="text-[11px] text-muted-foreground/70 mt-2 pt-2 border-t border-border">{d.nextMove.when}</p>
                )}
              </div>
            </div>
          )}

          {/* 2. KPI strip — portfolio snapshot above the fold, before compliance details */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <a href="/ytd" className="rounded-2xl card-lux p-4 flex flex-col gap-2 group">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Portfolio Value</span>
                <TrendingUp className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              <p className="text-xl font-black tabular-nums gradient-text"><AnimatedNumber value={d.totalValue} currency="SGD" /></p>
              {d.valueChange !== null
                ? <p className={`text-[11px] tabular-nums font-medium ${d.valueChange >= 0 ? "text-green-500" : "text-red-500"}`}>{d.valueChange >= 0 ? "▲" : "▼"} {formatCurrency(Math.abs(d.valueChange), "SGD")}</p>
                : <p className="text-[11px] text-muted-foreground">SGD · base currency</p>}
            </a>
            <div className="rounded-2xl card-lux p-4 flex flex-col gap-2">
              <span className="text-xs font-medium text-muted-foreground">Health Score</span>
              <p className={`text-xl font-black tabular-nums ${d.health.overall >= 80 ? "text-green-500" : d.health.overall >= 65 ? "text-amber-500" : "text-red-500"}`}><AnimatedNumber value={d.health.overall} /></p>
              <p className="text-[11px] text-muted-foreground">{d.health.overallLabel}</p>
            </div>
            <div className="rounded-2xl card-lux p-4 flex flex-col gap-2">
              <span className="text-xs font-medium text-muted-foreground">DCA cash bank</span>
              <p className="text-xl font-black tabular-nums text-sky-400">{formatCurrency(d.cashBankBalance, "SGD")}</p>
              <p className="text-[11px] text-muted-foreground">Carries forward to whole shares</p>
            </div>
            <a href="/governance" className={`rounded-2xl border bg-card/75 backdrop-blur-md p-4 card-elevated flex flex-col gap-2 hover:bg-accent/40 hover:-translate-y-0.5 transition-all group ${
              d.govAlignment.overall === "breach" ? "border-red-500/30" : d.govAlignment.overall === "watch" ? "border-amber-400/40" : "border-border hover:border-primary/30"
            }`}>
              <span className="text-xs font-medium text-muted-foreground">Governance</span>
              <p className={`text-xl font-black tabular-nums ${d.govAlignment.overall === "breach" ? "text-red-500" : d.govAlignment.overall === "watch" ? "text-amber-500" : "text-green-500"}`}>
                {d.govAlignment.breaches + d.govAlignment.watches === 0 ? "OK" : <AnimatedNumber value={d.govAlignment.breaches + d.govAlignment.watches} />}
              </p>
              <p className="text-[11px] text-muted-foreground">{d.govAlignment.breaches} breach · {d.govAlignment.watches} watch</p>
            </a>
          </div>

          {/* 3. What is held — above the fold, before compliance instrumentation */}
          {hasBalance && <HoldingsTable positions={d.holdingsRows} totalValue={d.totalValue} priceStale={d.marketStale} contributionCurrency="SGD" plainEnglish />}

          {/* ── COMPLIANCE DETAILS — admin/governance view only ── */}
          {/* Governance instrumentation (Seal, Compliance Board, full rule checklist)    */}
          {/* is shown only to the admin operator (David). Dami sees the plain-English    */}
          {/* ritual surface above and the condensed health summary in the sidebar.        */}
          {isAdmin && (
            <>
              {/* Committee minute — quarterly record of any rule-triggered decision */}
              {!d.emeActive && (
                <div className="rounded-xl border border-border bg-card/50 p-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Decision Journal</p>
                  <p className="text-[11px] text-muted-foreground mb-3 leading-relaxed">
                    File a committee minute any time a rule-triggered decision is made (quarterly de-risk sells, rule changes, drawdown response).
                    This is the audit trail required by the constitution.
                  </p>
                  <CommitteeMinuteForm />
                </div>
              )}
              <GovernanceSeal
                overall={d.health.overall}
                overallLabel={d.health.overallLabel}
                dimensions={sealDimensions}
                constitutionLabel="Your plan — health score"
                lowScoreWarning="⛔ Sort out the flagged rule before your next buy or sell."
                narrative={
                  hasBalance
                    ? `Phase ${d.phase.key} active (${d.phase.range}). ${d.govAlignment.breaches > 0 ? d.govAlignment.breaches + " rule breached" + (d.govAlignment.breaches > 1 ? "" : "") + ". " : ""}${d.govAlignment.watches > 0 ? d.govAlignment.watches + " thing" + (d.govAlignment.watches > 1 ? "s" : "") + " to watch. " : ""}${d.govAlignment.overall === "ok" ? "You're following all your rules." : ""}`
                    : "No portfolio balance yet. Enter your holdings to begin tracking."
                }
                href="/governance"
                hrefLabel="View plan →"
              />
              {hasBalance && <ComplianceBoard positions={d.complianceBands} totalValue={d.totalValue} />}
              {hasBalance && <GovernanceAlignment data={d.govAlignment} />}
            </>
          )}

          {/* Portfolio-level look-through — actual holdings only, never target weights. */}
          <div className="rounded-2xl card-lux p-5">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div><p className="text-[10px] font-bold uppercase tracking-widest text-sky-400">Risk look-through</p><h3 className="text-base font-semibold mt-1">What SBR owns underneath</h3></div>
              <span className={`text-[10px] rounded-full border px-2.5 py-1 ${d.lookThrough.stale ? "border-red-500/40 text-red-400" : "border-green-500/40 text-green-400"}`}>{d.lookThrough.stale ? "STALE" : `${d.lookThrough.ageDays}D OLD`}</span>
            </div>
            {!hasBalance ? <p className="text-xs text-muted-foreground">No securities are held, so company, country and industry exposure is not applicable. Targets are not substituted for actual holdings.</p> : <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ["Largest company", `${d.lookThrough.topCompany.name} ${d.lookThrough.topCompany.pct.toFixed(1)}%`],
                  ["Largest country", `${d.lookThrough.topCountry.name} ${d.lookThrough.topCountry.pct.toFixed(1)}%`],
                  ["Largest industry", `${d.lookThrough.topIndustry.name} ${d.lookThrough.topIndustry.pct.toFixed(1)}%`],
                  ["Equity assets", `${(d.lookThrough.assets.find(x => x.name === "Equity")?.pct ?? 0).toFixed(1)}%`],
                ].map(([label, value]) => <div key={label} className="rounded-xl border border-border bg-muted/20 p-3"><p className="text-[10px] text-muted-foreground">{label}</p><p className="text-sm font-bold mt-1">{value}</p></div>)}
              </div>
              {d.lookThrough.warnings.length > 0 && <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-3"><p className="text-[10px] font-bold uppercase tracking-widest text-amber-400 mb-1">Review queue</p>{d.lookThrough.warnings.map(w => <p key={w} className="text-xs text-muted-foreground">• {w}</p>)}</div>}
            </>}
          </div>

          {/* 7. Flexible-horizon mode */}
          <div className="rounded-xl border border-sky-500/30 bg-sky-500/[0.04] p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-sky-400">Flexible growth mode — active</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">There is no automatic value phase or property deadline. De-risk only after Dami records a real SGD use, amount and date.</p>
              </div>
              <a href="/governance" className="flex items-center gap-1 text-[11px] font-semibold text-sky-400 hover:text-sky-300 shrink-0">
                Read rules <ChevronRight className="h-3 w-3" />
              </a>
            </div>
          </div>

          {/* 8. Road Report — full analysis page */}
          <Link href="/reports" className="group flex items-center gap-3 rounded-2xl border border-border bg-card/75 backdrop-blur-md px-5 py-4 card-elevated hover:bg-accent/40 hover:border-sky-500/30 hover:-translate-y-0.5 transition-all">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/10 shrink-0">
              <TrendingUp className="h-4 w-4 text-sky-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold">Road Report</p>
              <p className="text-xs text-muted-foreground">Trajectory · phase progress · constitution checks · health scorecard</p>
            </div>
            <span className="text-xs font-semibold text-muted-foreground/60 group-hover:text-sky-500 transition-colors shrink-0">Open →</span>
          </Link>

          {/* 9. Download report */}
          {hasBalance && <DownloadReportCard endpoint="/api/reports/sbr" accent="sky" title="Download Your Plan Report" subtitle="A premium PDF — what's happening, what's changed, what's owned, and what to do next." />}

        </div>

        {/* Right sidebar */}
        <div className="space-y-5 reveal-stack">
          {/* Allocation donut */}
          <Link href="/portfolio" className="group block rounded-2xl card-lux p-5 relative overflow-hidden">
            <div className="flex items-start justify-between gap-2 mb-1">
              <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Allocation</h3>
              <span className="text-[11px] font-semibold text-primary opacity-0 group-hover:opacity-100 transition-opacity shrink-0">View →</span>
            </div>
            <p className="text-[11px] text-muted-foreground mb-3">Outer = actual · Inner = target</p>
            <AllocationDonut data={d.donutData} totalValue={d.totalValue} currency="SGD" />
          </Link>

          {/* Value history */}
          {d.historyPoints.length >= 2 && (
            <div className="rounded-2xl card-lux p-4">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Value History</h3>
                {d.valueChange !== null && (
                  <span className={`text-[11px] font-bold tabular-nums ${d.valueChange >= 0 ? "text-green-500" : "text-red-500"}`}>
                    {d.valueChange >= 0 ? "+" : ""}{formatCurrency(d.valueChange, "SGD")}
                  </span>
                )}
              </div>
              <PortfolioHistoryChart data={d.historyPoints} />
            </div>
          )}

          {/* FX strip — SGD/USD vs annual reference rate */}
          <div className="rounded-2xl card-lux p-4">
            <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">SGD / USD Rate</h3>
            <div className="flex items-end justify-between mb-2">
              <div>
                <p className="text-xl font-black tabular-nums">{d.usdSgdRate.toFixed(4)}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">1 USD = {d.usdSgdRate.toFixed(4)} SGD</p>
              </div>
              <div className="text-right">
                <p className={`text-sm font-bold tabular-nums ${d.fxOutOfBand ? "text-amber-500" : "text-green-500"}`}>
                  {d.fxDeviation >= 0 ? "+" : ""}{d.fxDeviation.toFixed(1)}%
                </p>
                <p className="text-[10px] text-muted-foreground">vs {FX_REFERENCE_USDSGD} ref</p>
              </div>
            </div>
            {/* ±5% band bar */}
            <div className="relative h-1.5 rounded-full bg-muted overflow-visible mb-1">
              <div className="absolute inset-y-0 left-[calc(50%-1px)] w-0.5 bg-muted-foreground/30 rounded-full" />
              <div className={`absolute top-0 h-full rounded-full transition-all ${d.fxOutOfBand ? "bg-amber-500" : "bg-green-500"}`}
                style={{
                  left: d.fxDeviation < 0 ? `${Math.max(0, 50 + d.fxDeviation * 5)}%` : "50%",
                  width: `${Math.min(50, Math.abs(d.fxDeviation) * 5)}%`,
                }} />
            </div>
            <div className="flex justify-between text-[9px] text-muted-foreground/40">
              <span>−5%</span><span>ref {FX_REFERENCE_USDSGD}</span><span>+5%</span>
            </div>
            {d.fxOutOfBand && (
              <p className="mt-2 text-[10px] text-amber-500 leading-relaxed">
                Rate is outside the ±5% band. De-risk sale proceeds should still convert to SGD promptly per the FX policy — do not wait for a &quot;better rate&quot;.
              </p>
            )}
          </div>

          {/* Health score breakdown */}
          {hasBalance && (
            <div className="rounded-2xl card-lux p-5 space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Score breakdown</h3>
              {[
                { label: "Governance",    value: d.health.governance,    weight: "25%" },
                { label: "Risk",          value: d.health.risk,          weight: "20%" },
                { label: "Allocation",    value: d.health.allocation,    weight: "15%" },
                { label: "Contribution",  value: d.health.contribution,  weight: "15%" },
                { label: "Behaviour",     value: d.health.behavioural,   weight: "10%" },
                { label: "Liquidity",     value: d.health.liquidity,     weight: "10%" },
                { label: "Documentation", value: d.health.documentation, weight: "5%"  },
              ].map(({ label, value, weight }) => (
                <div key={label}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] text-muted-foreground">{label}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground/50">{weight}</span>
                      <span className={`text-[11px] font-bold tabular-nums ${value >= 80 ? "text-green-500" : value >= 60 ? "text-amber-500" : "text-red-500"}`}>{value}</span>
                    </div>
                  </div>
                  <div className="h-1 rounded-full bg-muted overflow-hidden">
                    <div className={`h-full rounded-full bar-fill transition-all ${value >= 80 ? "bg-green-500" : value >= 60 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${value}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Shell>
  )
}
