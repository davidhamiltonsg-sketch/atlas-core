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

const SBR_FUND_TICKERS = SBR.funds.map(f => f.ticker)

// Phase thresholds as fractions of the 120k target
const PHASE_MARKS = [
  { label: "I",   endFrac: 72000  / 120000 },
  { label: "II",  endFrac: 102000 / 120000 },
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

async function getSbrData(userId: string) {
  const [holdings, market, recentExec] = await Promise.all([
    // Filter to SBR tickers only — prevents Atlas Core holdings from bleeding into SBR views
    db.holding.findMany({ where: { userId, ticker: { in: SBR_FUND_TICKERS } }, include: { snapshots: { orderBy: { date: "desc" }, take: 8 } } }),
    getSbrMarketData(),
    getRecentExecutions(userId, 1),
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

  return {
    totalValue, valueChange, phase, nextMove, dca, holdingsRows, govAlignment, health,
    marketStale: market.stale, marketAsOf: market.asOf, lastDone: recentExec[0] ?? null,
    historyPoints, complianceBands, donutData, growthRates, monthsToGoal,
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
    <Shell title="Your Plan" subtitle="Silicon Brick Road — saving toward your HDB deposit" userName={name} isAdmin={isAdmin}>

      {/* Constitution banner */}
      <a href="/silicon-brick-road.html" target="_blank" rel="noopener noreferrer"
        className="rounded-xl border border-sky-500/40 bg-gradient-to-r from-sky-500/[0.10] via-blue-500/[0.07] to-cyan-500/[0.06] p-4 mb-5 flex items-center gap-3 hover:from-sky-500/[0.12] transition-colors group">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/20 shrink-0"><FileText className="h-4 w-4 text-sky-400" /></div>
        <div className="flex-1">
          <p className="text-xs font-bold text-sky-400">Silicon Brick Road — Investment Constitution (v2.2)</p>
          <p className="text-xs text-muted-foreground">The complete written plan — four funds, monthly decision steps, phase rules, and how to buy the property when you&apos;re ready.</p>
        </div>
        <span className="text-xs font-semibold text-sky-400 group-hover:text-sky-300 shrink-0">Open ↗</span>
      </a>

      {/* Progress bar — the primary SBR KPI */}
      <div className="rounded-2xl card-lux p-5 mb-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Progress to target</p>
            <p className="text-2xl font-black tabular-nums mt-0.5">
              {hasBalance ? <AnimatedNumber value={d.totalValue} currency="SGD" /> : <span className="text-muted-foreground">—</span>}
              <span className="text-sm font-normal text-muted-foreground ml-2">of {formatCurrency(target, "SGD")}</span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-4xl font-black tabular-nums gradient-text"><AnimatedNumber value={progress} suffix="%" /></p>
            <p className="text-xs text-muted-foreground">{d.phase.label.split("—")[0].trim()}</p>
          </div>
        </div>
        <div className="relative h-4 rounded-full bg-muted overflow-hidden">
          {PHASE_MARKS.map((pm, i) => {
            const start = i === 0 ? 0 : PHASE_MARKS[i - 1].endFrac * 100
            const width = pm.endFrac * 100 - start
            const isCurrent = pm.label === d.phase.key
            return (
              <div key={pm.label} className={`absolute top-0 h-full border-r border-background/40 ${isCurrent ? "bg-sky-500/20" : "bg-transparent"}`}
                style={{ left: `${start}%`, width: `${width}%` }} />
            )
          })}
          {hasBalance && (
            <div className="absolute top-0 left-0 h-full rounded-full bg-gradient-to-r from-sky-400 via-blue-500 to-cyan-400 bar-fill transition-all duration-700"
              style={{ width: `${Math.min(100, valueFrac * 100)}%` }} />
          )}
        </div>
        <div className="flex mt-1.5">
          {PHASE_MARKS.map((pm, i) => {
            const start = i === 0 ? 0 : PHASE_MARKS[i - 1].endFrac * 100
            const width = pm.endFrac * 100 - start
            const isCurrent = pm.label === d.phase.key
            return (
              <div key={pm.label} className="text-center" style={{ width: `${width}%` }}>
                <span className={`text-[10px] font-bold ${isCurrent ? "text-sky-400" : "text-muted-foreground/50"}`}>{pm.label}</span>
              </div>
            )
          })}
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground/40 mt-0.5 -mx-0.5">
          <span>SGD 0</span><span>72k</span><span>102k</span><span>114k</span><span>120k</span>
        </div>
        {hasBalance && (
          <p className="mt-3 pt-3 border-t border-border text-[11px] text-muted-foreground leading-relaxed">
            At SGD {SBR.monthlyContribution.toLocaleString()}/month and your current fund mix ({(d.growthRates.base * 100).toFixed(1)}% growth a year, blended from what you actually hold),
            {" "}projected to reach your goal around <span className="font-semibold text-foreground">{monthsToLabel(d.monthsToGoal.base)}</span>
            {" "}— could be as early as {monthsToLabel(d.monthsToGoal.aggressive)} or as late as {monthsToLabel(d.monthsToGoal.conservative)} depending on returns.
          </p>
        )}
      </div>

      {/* Empty-state welcome — covers both "nothing entered yet" and "funds set but showing S$0" */}
      {!hasBalance && (
        <div className="mb-5 rounded-xl border border-sky-500/30 bg-sky-500/[0.06] px-5 py-4">
          <p className="text-sm font-bold text-sky-400">Your four funds are set up — let&apos;s add what you hold</p>
          <p className="text-xs text-muted-foreground mt-0.5">Your plan is ready (VWRA 50 · QQQM 25 · SMH 15 · A35 10), but the portfolio is still showing S$0. Add what you currently own on the <a href="/portfolio" className="underline font-semibold">Portfolio</a> page, and this page will tell you what to buy each month.</p>
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
                {d.dca.allocations.map((a) => (
                  <div key={a.ticker} className="px-5 py-3 flex items-center gap-3">
                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: a.color }} />
                    <span className="font-bold text-sm w-14">{a.ticker}</span>
                    <span className="flex-1 text-xs text-muted-foreground">{a.reason}</span>
                    <span className={`text-sm font-bold tabular-nums ${a.amount > 0 ? "text-green-500" : "text-muted-foreground"}`}>
                      {a.amount > 0 ? `+${formatCurrency(a.amount, "SGD")}` : formatCurrency(0, "SGD")}
                    </span>
                  </div>
                ))}
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
              <span className="text-xs font-medium text-muted-foreground">Phase</span>
              <p className="text-xl font-black tabular-nums text-sky-400">{d.phase.key}</p>
              <p className="text-[11px] text-muted-foreground">{d.phase.range}</p>
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

          {/* ── COMPLIANCE DETAILS — below the fold (progressive disclosure) ── */}

          {/* 4. Health score — constitution scorecard with rule-level warning */}
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

          {/* 5. Compliance Board — position bands */}
          {hasBalance && (
            <ComplianceBoard positions={d.complianceBands} totalValue={d.totalValue} />
          )}

          {/* 6. Governance rules checklist */}
          {hasBalance && <GovernanceAlignment data={d.govAlignment} />}

          {/* 7. Phase detail */}
          <div className="rounded-xl border border-sky-500/30 bg-sky-500/[0.04] p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-sky-400">Phase {d.phase.key} — Active</span>
                  <span className="text-[10px] text-muted-foreground">· {d.phase.range}</span>
                  {d.phase.selling && <span className="rounded-full bg-amber-500/15 text-amber-500 px-2 py-0.5 text-[9px] font-bold uppercase">sells</span>}
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{d.phase.body}</p>
              </div>
              <a href="/governance" className="flex items-center gap-1 text-[11px] font-semibold text-sky-400 hover:text-sky-300 shrink-0">
                All phases <ChevronRight className="h-3 w-3" />
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
