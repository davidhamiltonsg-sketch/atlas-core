import { Shell } from "@/components/shell"
import { db } from "@/lib/db"
import { formatCurrency } from "@/lib/utils"
import { TrendingUp, Target, Layers, ShieldCheck, FileText, ChevronRight } from "lucide-react"
import { getSbrMarketData } from "@/lib/sbr-market"
import { buildPortfolioTimeline } from "@/lib/portfolio-metrics"
import { SILICON_BRICK_ROAD as SBR } from "@/lib/constitutions"
import { computeSbrNextMove, computeSbrDca, computeSbrHealth, sbrPhase, type SbrPosition } from "@/lib/sbr-engine"
import { NextBestMove } from "@/components/dashboard/next-best-move"
import { HoldingsTable, type HoldingRow } from "@/components/dashboard/holdings-table"
import { GovernanceAlignment } from "@/components/dashboard/governance-alignment"
import { HealthGauge } from "@/components/charts/health-gauge"
import { getRecentExecutions } from "@/lib/execution-actions"
import type { GovAlignment, Align } from "@/lib/governance-status"

const SBR_FUND_TICKERS = SBR.funds.map(f => f.ticker)

// Phase thresholds as fractions of the 120k target — used for the progress bar.
const PHASE_MARKS = [
  { label: "I",   endFrac: 72000  / 120000 }, // 60%
  { label: "II",  endFrac: 102000 / 120000 }, // 85%
  { label: "III", endFrac: 114000 / 120000 }, // 95%
  { label: "IV",  endFrac: 1.0               }, // 100%
]

async function getSbrData(userId: string) {
  const [holdings, market, recentExec] = await Promise.all([
    // Filter to SBR tickers only — prevents Atlas Core holdings from bleeding into SBR views
    // if ensureCoreHoldings() was accidentally called for this user.
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
      ticker: h.ticker, name: h.name, color: h.color, value, actualPct,
      targetPct: h.targetPct, rangeLow: fund?.rangeLow ?? h.targetPct - h.toleranceBand,
      rangeHigh: fund?.rangeHigh ?? h.targetPct + h.toleranceBand, hardCap: h.hardCapPct,
      floor: fund?.floor, latestPrice: live?.price || h.snapshots[0]?.price || 0, hi52: live?.hi52 || 0,
    }
  })

  // Portfolio drawdown from month-end peak
  const timeline = buildPortfolioTimeline(holdings)
  let drawdownPct: number | undefined
  if (timeline.length >= 2) {
    const peak = Math.max(...timeline.map((t) => t.value))
    const current = timeline[timeline.length - 1].value
    if (peak > 0 && current < peak) drawdownPct = ((current - peak) / peak) * 100
  }
  const valueChange = timeline.length >= 2 ? timeline[timeline.length - 1].value - timeline[timeline.length - 2].value : null

  const phase = sbrPhase(totalValue)
  const nextMove = computeSbrNextMove(positions, totalValue, { drawdownPct })
  const dca = computeSbrDca(positions, SBR.monthlyContribution, { drawdownPct })
  const dcaByTicker = new Map(dca.allocations.map((a) => [a.ticker, a]))

  // Governance status
  const smh = positions.find((p) => p.ticker === "SMH")
  const combined = positions.filter((p) => ["QQQM", "SMH"].includes(p.ticker)).reduce((s, p) => s + p.actualPct, 0)
  const a35 = positions.find((p) => p.ticker === "A35")
  const equity = positions.filter((p) => ["VWRA", "QQQM", "SMH"].includes(p.ticker)).reduce((s, p) => s + p.actualPct, 0)
  const st = (breach: boolean, watch: boolean): Align => (breach ? "breach" : watch ? "watch" : "ok")
  const checks: GovAlignment["checks"] = totalValue > 0 ? [
    { id: "smh",     label: "Chip fund (SMH) under its 20% cap",    status: st((smh?.actualPct ?? 0) > 20, (smh?.actualPct ?? 0) > 19), detail: `SMH is ${(smh?.actualPct ?? 0).toFixed(1)}% (cap 20%, target 15%)` },
    { id: "combined",label: "Tech funds (QQQM + SMH) under 45%",    status: st(combined > SBR.combined!.hard, combined >= SBR.combined!.warning), detail: `Combined ${combined.toFixed(1)}% (warning ${SBR.combined!.warning}%, limit ${SBR.combined!.hard}%)` },
    { id: "a35",     label: "Safety floor (A35) at least 7%",       status: st((a35?.actualPct ?? 0) < 7, (a35?.actualPct ?? 0) < 8), detail: `A35 is ${(a35?.actualPct ?? 0).toFixed(1)}% (floor 7%, target 10%)` },
    { id: "equity",  label: "Total equity under 92%",               status: st(equity > (SBR.totalEquityMaxPct ?? 92), equity > 90), detail: `Equities ${equity.toFixed(1)}% (max ${SBR.totalEquityMaxPct}%)` },
    { id: "ranges",  label: "Every fund within its range",          status: st(false, positions.some((p) => p.actualPct < p.rangeLow || p.actualPct > p.rangeHigh)), detail: positions.some((p) => p.actualPct < p.rangeLow || p.actualPct > p.rangeHigh) ? "A fund has drifted outside its comfortable range" : "All four funds are within range" },
  ] : []
  const breaches = checks.filter((c) => c.status === "breach").length
  const watches = checks.filter((c) => c.status === "watch").length
  const govAlignment: GovAlignment = { checks, breaches, watches, overall: breaches > 0 ? "breach" : watches > 0 ? "watch" : "ok" }

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
      ticker: h.ticker, name: h.name, color: h.color, units: cb?.units ?? 0, value: p.value,
      latestPrice: cb?.price ?? 0, priceChangePct: null, priceHistory: [],
      avgCostUsd: null, unrealisedSgd: null, unrealisedPct: null,
      actualPct: p.actualPct, targetPct: h.targetPct, toleranceBand: h.toleranceBand,
      hardCapPct: h.hardCapPct, status: statusOf(p),
      thisMonth: a ? { amount: a.amount, tag: a.tag, reason: a.reason } : null,
    }
  })

  const latest = holdings.reduce<Date | null>((d, h) => { const s = h.snapshots[0]?.date; return s && (!d || s > d) ? s : d }, null)
  const snapshotAgeDays = latest ? Math.floor((Date.now() - new Date(latest).getTime()) / 86_400_000) : 999
  const health = computeSbrHealth(positions, totalValue, snapshotAgeDays)

  return { totalValue, valueChange, phase, nextMove, dca, holdingsRows, govAlignment, health,
    marketStale: market.stale, marketAsOf: market.asOf, lastDone: recentExec[0] ?? null }
}

export async function SbrDashboard({ userId, name, isAdmin }: { userId: string; name: string; isAdmin: boolean }) {
  const d = await getSbrData(userId)
  const target = SBR.targetValue ?? 120000
  const valueFrac = target > 0 ? Math.min(1, d.totalValue / target) : 0
  const progress = Math.round(valueFrac * 100)
  const hasBalance = d.totalValue > 0

  return (
    <Shell title="Silicon Brick Road" subtitle="Investment Constitution v2.1 · toward an HDB deposit" userName={name} isAdmin={isAdmin}>

      {/* Constitution banner */}
      <a href="/silicon-brick-road.html" target="_blank" rel="noopener noreferrer"
        className="rounded-xl border border-teal-500/40 bg-gradient-to-r from-teal-500/[0.08] to-emerald-500/[0.06] p-4 mb-5 flex items-center gap-3 hover:from-teal-500/[0.12] transition-colors group">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-500/20 shrink-0"><FileText className="h-4 w-4 text-teal-400" /></div>
        <div className="flex-1">
          <p className="text-xs font-bold text-teal-400">Silicon Brick Road — Investment Constitution (v2.1)</p>
          <p className="text-xs text-muted-foreground">The complete written plan — four funds, monthly decision steps, phase rules, and how to buy the property when you&apos;re ready.</p>
        </div>
        <span className="text-xs font-semibold text-teal-400 group-hover:text-teal-300 shrink-0">Open ↗</span>
      </a>

      {/* Progress bar to SGD 120k target — most prominent KPI */}
      <div className="rounded-xl border border-border bg-card p-5 mb-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Progress to target</p>
            <p className="text-2xl font-black tabular-nums mt-0.5">
              {hasBalance ? formatCurrency(d.totalValue, "SGD") : <span className="text-muted-foreground">—</span>}
              <span className="text-sm font-normal text-muted-foreground ml-2">of {formatCurrency(target, "SGD")}</span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-black tabular-nums text-teal-400">{progress}%</p>
            <p className="text-xs text-muted-foreground">{d.phase.label.split("—")[0].trim()}</p>
          </div>
        </div>

        {/* Multi-phase progress bar */}
        <div className="relative h-4 rounded-full bg-muted overflow-hidden">
          {/* Phase segment backgrounds */}
          {PHASE_MARKS.map((pm, i) => {
            const start = i === 0 ? 0 : PHASE_MARKS[i - 1].endFrac * 100
            const width = pm.endFrac * 100 - start
            const isCurrent = pm.label === d.phase.key
            return (
              <div key={pm.label}
                className={`absolute top-0 h-full border-r border-background/40 ${isCurrent ? "bg-teal-500/20" : "bg-transparent"}`}
                style={{ left: `${start}%`, width: `${width}%` }}
              />
            )
          })}
          {/* Fill */}
          {hasBalance && (
            <div className="absolute top-0 left-0 h-full rounded-full bg-gradient-to-r from-teal-500 to-emerald-400 transition-all duration-700"
              style={{ width: `${Math.min(100, valueFrac * 100)}%` }} />
          )}
        </div>

        {/* Phase labels */}
        <div className="flex mt-1.5">
          {PHASE_MARKS.map((pm, i) => {
            const start = i === 0 ? 0 : PHASE_MARKS[i - 1].endFrac * 100
            const width = pm.endFrac * 100 - start
            const isCurrent = pm.label === d.phase.key
            return (
              <div key={pm.label} className="text-center" style={{ width: `${width}%` }}>
                <span className={`text-[10px] font-bold ${isCurrent ? "text-teal-400" : "text-muted-foreground/50"}`}>
                  {pm.label}
                </span>
              </div>
            )
          })}
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground/40 mt-0.5 -mx-0.5">
          <span>SGD 0</span>
          <span>72k</span>
          <span>102k</span>
          <span>114k</span>
          <span>120k</span>
        </div>
      </div>

      {/* Empty-state welcome */}
      {!hasBalance && (
        <div className="mb-5 rounded-xl border border-teal-500/30 bg-teal-500/[0.06] px-5 py-4">
          <p className="text-sm font-bold text-teal-400">Portfolio ready — add your first snapshot</p>
          <p className="text-xs text-muted-foreground mt-0.5">Targets are set (VWRA 50 · QQQM 25 · SMH 15 · A35 10). Enter your holdings on <a href="/portfolio" className="underline font-semibold">Portfolio</a> to start tracking.</p>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
        <div className="space-y-5 min-w-0">

          {/* Next Best Move */}
          {hasBalance && <NextBestMove move={d.nextMove} dataAsOf={d.marketAsOf} stale={d.marketStale} lastDone={d.lastDone} />}

          {/* What To Do This Month — DCA FIRST (most actionable after the move card) */}
          {hasBalance && (
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold">What To Do This Month</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">{d.dca.headline}</p>
                </div>
                <span className="text-[11px] font-semibold text-muted-foreground tabular-nums">SGD {SBR.monthlyContribution.toLocaleString()}/mo</span>
              </div>
              {d.dca.overlayNote && <p className="px-5 pt-3 text-[11px] text-amber-500 leading-relaxed">{d.dca.overlayNote}</p>}
              <div className="divide-y divide-border">
                {d.dca.allocations.map((a) => (
                  <div key={a.ticker} className="px-5 py-3 flex items-center gap-3">
                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: a.color }} />
                    <span className="font-bold text-sm w-14">{a.ticker}</span>
                    <span className="flex-1 text-xs text-muted-foreground">{a.reason}</span>
                    <span className={`text-sm font-bold tabular-nums ${a.amount > 0 ? "text-green-500" : "text-muted-foreground"}`}>
                      {a.amount > 0 ? `+${formatCurrency(a.amount, "SGD")}` : "$0"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* KPI strip */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <a href="/ytd" className="rounded-xl border border-border bg-card p-4 flex flex-col gap-2 hover:bg-accent/40 transition-colors">
              <div className="flex items-center justify-between"><span className="text-xs font-medium text-muted-foreground">Portfolio Value</span><TrendingUp className="h-3.5 w-3.5 text-muted-foreground" /></div>
              <p className="text-2xl font-black tabular-nums">{formatCurrency(d.totalValue, "SGD")}</p>
              {d.valueChange !== null
                ? <p className={`text-[11px] tabular-nums font-medium ${d.valueChange >= 0 ? "text-green-500" : "text-red-500"}`}>{d.valueChange >= 0 ? "▲" : "▼"} {formatCurrency(Math.abs(d.valueChange), "SGD")} since last update</p>
                : <p className="text-[11px] text-muted-foreground">SGD · base currency</p>}
            </a>
            <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-2">
              <div className="flex items-center justify-between"><span className="text-xs font-medium text-muted-foreground">Current phase</span><Layers className="h-3.5 w-3.5 text-muted-foreground" /></div>
              <p className="text-2xl font-black tabular-nums text-teal-400">{d.phase.key}</p>
              <p className="text-[11px] text-muted-foreground">{d.phase.range}</p>
            </div>
            <a href="/governance" className="rounded-xl border border-border bg-card p-4 flex flex-col gap-2 hover:bg-accent/40 transition-colors">
              <div className="flex items-center justify-between"><span className="text-xs font-medium text-muted-foreground">Governance</span><ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" /></div>
              <p className={`text-2xl font-black tabular-nums ${d.govAlignment.overall === "breach" ? "text-red-500" : d.govAlignment.overall === "watch" ? "text-amber-500" : "text-green-500"}`}>
                {d.govAlignment.breaches + d.govAlignment.watches === 0 ? "OK" : `${d.govAlignment.breaches + d.govAlignment.watches}`}
              </p>
              <p className="text-[11px] text-muted-foreground">{d.govAlignment.breaches} breach · {d.govAlignment.watches} watch</p>
            </a>
            <a href="/contributions" className="rounded-xl border border-border bg-card p-4 flex flex-col gap-2 hover:bg-accent/40 transition-colors">
              <div className="flex items-center justify-between"><span className="text-xs font-medium text-muted-foreground">Health score</span><Target className="h-3.5 w-3.5 text-muted-foreground" /></div>
              <p className={`text-2xl font-black tabular-nums ${d.health.overall >= 80 ? "text-green-500" : d.health.overall >= 65 ? "text-amber-500" : "text-red-500"}`}>{d.health.overall}</p>
              <p className="text-[11px] text-muted-foreground">{d.health.overallLabel}</p>
            </a>
          </div>

          {hasBalance && <GovernanceAlignment data={d.govAlignment} />}
          {hasBalance && <HoldingsTable positions={d.holdingsRows} totalValue={d.totalValue} priceStale={d.marketStale} />}

          {/* Current phase — simplified: only the active phase, link to full framework */}
          <div className="rounded-xl border border-teal-500/30 bg-teal-500/[0.04] p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-teal-400">Phase {d.phase.key} — Active</span>
                  <span className="text-[10px] text-muted-foreground">· {d.phase.range}</span>
                  {d.phase.selling && <span className="rounded-full bg-amber-500/15 text-amber-500 px-2 py-0.5 text-[9px] font-bold uppercase">sells</span>}
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{d.phase.body}</p>
              </div>
              <a href="/governance" className="flex items-center gap-1 text-[11px] font-semibold text-teal-400 hover:text-teal-300 shrink-0">
                All phases <ChevronRight className="h-3 w-3" />
              </a>
            </div>
          </div>

          <a href="/governance" className="block rounded-xl border border-border bg-card p-4 hover:bg-accent/40 transition-colors">
            <p className="text-sm font-semibold">Full Constitution & Decision Engine →</p>
            <p className="text-xs text-muted-foreground mt-0.5">All the rules in one place — the four funds, what to do each month, tech stock limits, what you actually own inside the funds, and the health check scorecard.</p>
          </a>
        </div>

        {/* Right sidebar */}
        <div className="space-y-5">
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Governance Score</h3>
            <HealthGauge score={d.health.overall} label={d.health.overallLabel} />
          </div>

          {/* Health score breakdown */}
          {hasBalance && (
            <div className="rounded-xl border border-border bg-card p-5 space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Score breakdown</h3>
              {[
                { label: "Governance",     value: d.health.governance,    weight: "25%" },
                { label: "Risk",           value: d.health.risk,          weight: "20%" },
                { label: "Allocation",     value: d.health.allocation,    weight: "15%" },
                { label: "Contribution",   value: d.health.contribution,  weight: "15%" },
                { label: "Behaviour",      value: d.health.behavioural,   weight: "10%" },
                { label: "Liquidity",      value: d.health.liquidity,     weight: "10%" },
                { label: "Documentation",  value: d.health.documentation, weight: "5%"  },
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
                    <div className={`h-full rounded-full transition-all ${value >= 80 ? "bg-green-500" : value >= 60 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${value}%` }} />
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
