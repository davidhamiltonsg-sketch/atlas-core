import { Shell } from "@/components/shell"
import { db } from "@/lib/db"
import { formatCurrency } from "@/lib/utils"
import { TrendingUp, Target, Layers, ShieldCheck, FileText } from "lucide-react"
import { getLiveMarketPositions } from "@/lib/finnhub"
import { buildPortfolioTimeline } from "@/lib/portfolio-metrics"
import { computePortfolioHealth } from "@/lib/health"
import { SILICON_BRICK_ROAD as SBR } from "@/lib/constitutions"
import { computeSbrNextMove, computeSbrDca, sbrPhase, type SbrPosition } from "@/lib/sbr-engine"
import { NextBestMove } from "@/components/dashboard/next-best-move"
import { HoldingsTable, type HoldingRow } from "@/components/dashboard/holdings-table"
import { GovernanceAlignment } from "@/components/dashboard/governance-alignment"
import { HealthGauge } from "@/components/charts/health-gauge"
import { getRecentExecutions } from "@/lib/execution-actions"
import type { GovAlignment, Align } from "@/lib/governance-status"

async function getSbrData(userId: string) {
  const [holdings, market, recentExec] = await Promise.all([
    db.holding.findMany({ where: { userId }, include: { snapshots: { orderBy: { date: "desc" }, take: 8 } } }),
    getLiveMarketPositions(["QQQM", "SMH", "VWRA"]),
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

  // Portfolio drawdown from month-end peak (from snapshot history).
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

  // Governance status (SBR-specific).
  const smh = positions.find((p) => p.ticker === "SMH")
  const combined = positions.filter((p) => ["QQQM", "SMH"].includes(p.ticker)).reduce((s, p) => s + p.actualPct, 0)
  const a35 = positions.find((p) => p.ticker === "A35")
  const equity = positions.filter((p) => ["VWRA", "QQQM", "SMH"].includes(p.ticker)).reduce((s, p) => s + p.actualPct, 0)
  const st = (breach: boolean, watch: boolean): Align => (breach ? "breach" : watch ? "watch" : "ok")
  const checks: GovAlignment["checks"] = totalValue > 0 ? [
    { id: "smh", label: "Chip fund (SMH) under its 20% cap", status: st((smh?.actualPct ?? 0) > 20, (smh?.actualPct ?? 0) > 19), detail: `SMH is ${(smh?.actualPct ?? 0).toFixed(1)}% (cap 20%, target 15%)` },
    { id: "combined", label: "Tech funds (QQQM + SMH) under 45%", status: st(combined > SBR.combined!.hard, combined >= SBR.combined!.warning), detail: `Combined ${combined.toFixed(1)}% (warning ${SBR.combined!.warning}%, limit ${SBR.combined!.hard}%)` },
    { id: "a35", label: "Safety floor (A35) at least 7%", status: st((a35?.actualPct ?? 0) < 7, (a35?.actualPct ?? 0) < 8), detail: `A35 is ${(a35?.actualPct ?? 0).toFixed(1)}% (floor 7%, target 10%)` },
    { id: "equity", label: "Total equity under 92%", status: st(equity > (SBR.totalEquityMaxPct ?? 92), equity > 90), detail: `Equities ${equity.toFixed(1)}% (max ${SBR.totalEquityMaxPct}%)` },
    { id: "ranges", label: "Every fund within its range", status: st(false, positions.some((p) => p.actualPct < p.rangeLow || p.actualPct > p.rangeHigh)), detail: positions.some((p) => p.actualPct < p.rangeLow || p.actualPct > p.rangeHigh) ? "A fund has drifted outside its comfortable range" : "All four funds are within range" },
  ] : []
  const breaches = checks.filter((c) => c.status === "breach").length
  const watches = checks.filter((c) => c.status === "watch").length
  const govAlignment: GovAlignment = { checks, breaches, watches, overall: breaches > 0 ? "breach" : watches > 0 ? "watch" : "ok" }

  // Holdings rows for the unified table.
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

  // Health score.
  const hardBreaches = holdingsRows.filter((r) => r.status === "hard").length
  const softBreaches = holdingsRows.filter((r) => r.status === "soft").length
  const maxDrift = totalValue > 0 ? Math.max(0, ...positions.map((p) => Math.abs(p.actualPct - p.targetPct))) : 0
  const latest = holdings.reduce<Date | null>((d, h) => { const s = h.snapshots[0]?.date; return s && (!d || s > d) ? s : d }, null)
  const snapshotAgeDays = latest ? Math.floor((Date.now() - new Date(latest).getTime()) / 86_400_000) : 999
  const health = computePortfolioHealth({ hardBreaches, softBreaches, maxDrift, activeRules: SBR.rules.length, totalRules: SBR.rules.length, snapshotAgeDays })

  return { totalValue, valueChange, phase, nextMove, dca, holdingsRows, govAlignment, health,
    marketStale: market.stale, marketAsOf: market.asOf, lastDone: recentExec[0] ?? null }
}

export async function SbrDashboard({ userId, name, isAdmin }: { userId: string; name: string; isAdmin: boolean }) {
  const d = await getSbrData(userId)
  const target = SBR.targetValue ?? 120000
  const progress = target > 0 ? Math.min(100, (d.totalValue / target) * 100) : 0
  const hasBalance = d.totalValue > 0

  return (
    <Shell title="Silicon Brick Road" subtitle="Investment Constitution v2.1 · toward an HDB deposit" userName={name} isAdmin={isAdmin}>
      {/* Constitution banner */}
      <a href="/silicon-brick-road.html" target="_blank" rel="noopener noreferrer"
        className="rounded-xl border border-teal-500/40 bg-gradient-to-r from-teal-500/[0.08] to-emerald-500/[0.06] p-4 mb-5 flex items-center gap-3 hover:from-teal-500/[0.12] transition-colors group">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-500/20 shrink-0"><FileText className="h-4 w-4 text-teal-400" /></div>
        <div className="flex-1">
          <p className="text-xs font-bold text-teal-400">Silicon Brick Road — Investment Constitution (v2.1)</p>
          <p className="text-xs text-muted-foreground"><span className="italic">Disciplina Supra Praedictio.</span> The full four-Book constitution — principles, decision engine, phases, registers, and scorecard.</p>
        </div>
        <span className="text-xs font-semibold text-teal-400 group-hover:text-teal-300 shrink-0">Open ↗</span>
      </a>

      {!hasBalance && (
        <div className="mb-5 rounded-xl border border-teal-500/30 bg-teal-500/[0.06] px-5 py-4">
          <p className="text-sm font-bold text-teal-400">Portfolio ready — add your first snapshot</p>
          <p className="text-xs text-muted-foreground mt-0.5">Targets are set (VWRA 50 · QQQM 25 · SMH 15 · A35 10). Enter your holdings on <a href="/portfolio" className="underline font-semibold">Portfolio</a> to start tracking.</p>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
        <div className="space-y-5 min-w-0">
          {hasBalance && <NextBestMove move={d.nextMove} dataAsOf={d.marketAsOf} stale={d.marketStale} lastDone={d.lastDone} />}

          {/* KPI strip */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-2">
              <div className="flex items-center justify-between"><span className="text-xs font-medium text-muted-foreground">Portfolio Value</span><TrendingUp className="h-3.5 w-3.5 text-muted-foreground" /></div>
              <p className="text-2xl font-black tabular-nums">{formatCurrency(d.totalValue, "SGD")}</p>
              {d.valueChange !== null ? <p className={`text-[11px] tabular-nums font-medium ${d.valueChange >= 0 ? "text-green-500" : "text-red-500"}`}>{d.valueChange >= 0 ? "▲" : "▼"} {formatCurrency(Math.abs(d.valueChange), "SGD")} since last update</p> : <p className="text-[11px] text-muted-foreground">SGD · base currency</p>}
            </div>
            <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-2">
              <div className="flex items-center justify-between"><span className="text-xs font-medium text-muted-foreground">Progress to target</span><Target className="h-3.5 w-3.5 text-muted-foreground" /></div>
              <p className="text-2xl font-black tabular-nums text-teal-400">{progress.toFixed(0)}%</p>
              <p className="text-[11px] text-muted-foreground">of {formatCurrency(target, "SGD")}</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-2">
              <div className="flex items-center justify-between"><span className="text-xs font-medium text-muted-foreground">Current phase</span><Layers className="h-3.5 w-3.5 text-muted-foreground" /></div>
              <p className="text-2xl font-black tabular-nums">{d.phase.key}</p>
              <p className="text-[11px] text-muted-foreground">{d.phase.label.split("—")[1]?.trim() ?? d.phase.label}</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-2">
              <div className="flex items-center justify-between"><span className="text-xs font-medium text-muted-foreground">Governance</span><ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" /></div>
              <p className={`text-2xl font-black tabular-nums ${d.govAlignment.overall === "breach" ? "text-red-500" : d.govAlignment.overall === "watch" ? "text-amber-500" : "text-green-500"}`}>{d.govAlignment.breaches + d.govAlignment.watches === 0 ? "OK" : `${d.govAlignment.breaches + d.govAlignment.watches}`}</p>
              <p className="text-[11px] text-muted-foreground">{d.govAlignment.breaches} breach · {d.govAlignment.watches} watch</p>
            </div>
          </div>

          {hasBalance && <GovernanceAlignment data={d.govAlignment} />}
          {hasBalance && <HoldingsTable positions={d.holdingsRows} totalValue={d.totalValue} priceStale={d.marketStale} />}

          {/* What to do this month */}
          {hasBalance && (
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                <div><h2 className="text-sm font-semibold">What To Do This Month</h2><p className="mt-0.5 text-xs text-muted-foreground">{d.dca.headline}</p></div>
                <span className="text-[11px] font-semibold text-muted-foreground">SGD {SBR.monthlyContribution.toLocaleString()}/mo</span>
              </div>
              {d.dca.overlayNote && <p className="px-5 pt-3 text-[11px] text-muted-foreground leading-relaxed">{d.dca.overlayNote}</p>}
              <div className="divide-y divide-border">
                {d.dca.allocations.map((a) => (
                  <div key={a.ticker} className="px-5 py-3 flex items-center gap-3">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ background: a.color }} />
                    <span className="font-bold text-sm w-14">{a.ticker}</span>
                    <span className="flex-1 text-xs text-muted-foreground">{a.reason}</span>
                    <span className={`text-sm font-bold tabular-nums ${a.amount > 0 ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}>{a.amount > 0 ? `+${formatCurrency(a.amount, "SGD")}` : "$0"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Phase framework */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-5 py-4 border-b border-border"><h2 className="text-sm font-semibold">Phase Framework (Article XII)</h2><p className="mt-0.5 text-xs text-muted-foreground">Operating mode shifts by portfolio value vs the {formatCurrency(target, "SGD")} target — not the calendar.</p></div>
            <div className="divide-y divide-border">
              {(SBR.phases ?? []).map((ph) => {
                const active = ph.key === d.phase.key
                return (
                  <div key={ph.key} className={`px-5 py-3 ${active ? "bg-teal-500/[0.06]" : ""}`}>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={`text-xs font-black ${active ? "text-teal-400" : "text-muted-foreground"}`}>{ph.label}</span>
                      <span className="text-[10px] text-muted-foreground">· {ph.range}</span>
                      {active && <span className="ml-auto rounded-full bg-teal-500/15 text-teal-400 px-2 py-0.5 text-[9px] font-bold uppercase">Current</span>}
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">{ph.body}</p>
                  </div>
                )
              })}
            </div>
          </div>

          <a href="/governance" className="block rounded-xl border border-border bg-card p-4 hover:bg-accent/40 transition-colors">
            <p className="text-sm font-semibold">Full Constitution & Decision Engine →</p>
            <p className="text-xs text-muted-foreground mt-0.5">The four funds, the 8-step decision ladder, combined ceiling, hidden-exposure register, and the governance scorecard.</p>
          </a>
        </div>

        {/* Right sidebar */}
        <div className="space-y-5">
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Governance Score</h3>
            <HealthGauge score={d.health.overall} label={d.health.overallLabel} />
          </div>
        </div>
      </div>
    </Shell>
  )
}
