"use client"

import { useState } from "react"
import { AlertTriangle, CheckCircle2, XCircle, Zap, TrendingDown } from "lucide-react"
import { computeMarketAwareDca, type PositionInput, type EngineMarket } from "@/lib/next-best-move"

type ActionStatus = "healthy" | "soft" | "hard"

type Position = {
  ticker: string
  name: string
  color: string
  value: number
  actualPct: number
  targetPct: number
  driftPct: number
  status: ActionStatus
  instruction: string
  hardCapPct?: number | null
  toleranceBand?: number
  latestPrice?: number
}

type Props = {
  positions: Position[]
  totalValue: number
  hasBalance: boolean
  allocOrder: string[]
  hasAnyAlert: boolean
  defaultContribution?: number
  annualLumpSum?: number
  marketOverride?: EngineMarket
}

// Market-aware DCA: routes monthly money considering drift AND market conditions
// (skips overbought positions at 52-week highs, deploys into confirmed dips via the
// three-tranche rule, accumulates underweight conviction holdings toward target, and
// never feeds an overweight position). Falls back to drift-only logic for positions
// with no market overlay.
function calculateSuggestedAllocations(
  positions: Position[],
  totalMonthly: number,
  market?: EngineMarket
): { amounts: Record<string, number>; overlayNote: string | null; marketOverlayActive: boolean } {
  const inputs: PositionInput[] = positions.map(p => ({
    ticker: p.ticker, name: p.name, color: p.color, value: p.value,
    actualPct: p.actualPct, targetPct: p.targetPct,
    hardCapPct: p.hardCapPct ?? null, toleranceBand: p.toleranceBand ?? 2.5,
    latestPrice: p.latestPrice ?? 0,
  }))
  const plan = computeMarketAwareDca(inputs, totalMonthly, market ? { market } : undefined)
  const amounts: Record<string, number> = {}
  positions.forEach(p => { amounts[p.ticker] = 0 })
  for (const a of plan.allocations) amounts[a.ticker] = a.amount
  return { amounts, overlayNote: plan.overlayNote, marketOverlayActive: plan.marketOverlayActive }
}

export function ExecutionPlan({
  positions,
  totalValue,
  hasBalance,
  allocOrder,
  hasAnyAlert: initialHasAnyAlert,
  defaultContribution = 3000,
  annualLumpSum = 20000,
  marketOverride,
}: Props) {
  const [contribution, setContribution] = useState(defaultContribution)
  const [inputVal, setInputVal] = useState(String(defaultContribution))

  function handleInputChange(raw: string) {
    setInputVal(raw)
    const n = parseInt(raw.replace(/[^0-9]/g, ""), 10)
    if (!isNaN(n) && n >= 0) setContribution(n)
  }

  function handleBlur() {
    setInputVal(String(contribution))
  }

  // Recalculate all allocation data client-side based on current contribution
  const dcaPlan = calculateSuggestedAllocations(positions, contribution, marketOverride)
  const suggested = dcaPlan.amounts
  const newTotalValue = totalValue + contribution

  // Standard amounts: proportional to target % of total contribution
  const standardAlloc: Record<string, number> = {}
  positions.forEach(p => {
    standardAlloc[p.ticker] = Math.round((p.targetPct / 100) * contribution / 10) * 10
  })

  const positionsWithAlloc = positions.map(p => {
    const amount = suggested[p.ticker] ?? 0
    const standard = standardAlloc[p.ticker] ?? 0
    const tag: "standard" | "boosted" | "zeroed" =
      amount === 0 ? "zeroed" : amount > standard ? "boosted" : "standard"
    const projectedValue = p.value + amount
    const projectedPct = newTotalValue > 0 ? (projectedValue / newTotalValue) * 100 : 0
    const driftBefore = Math.abs(p.driftPct)
    const driftAfter = Math.abs(projectedPct - p.targetPct)
    const driftImprovement = driftBefore - driftAfter
    return { ...p, suggestedAmount: amount, allocationTag: tag, projectedPct, driftImprovement, standardAmount: standard }
  })

  const hasAnyAlert = positionsWithAlloc.some(p => p.status !== "healthy")

  if (!hasBalance) {
    return (
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-8 text-center">
          <p className="text-sm font-semibold mb-1">No snapshot yet</p>
          <p className="text-xs text-muted-foreground">
            Enter your holdings on the{" "}
            <a href="/portfolio" className="underline text-primary font-semibold">Portfolio page</a>{" "}
            to generate your personalised monthly plan.
          </p>
        </div>
      </div>
    )
  }

  if (positions.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-8 text-center text-xs text-muted-foreground">
          No holdings found. Seed the database to generate instructions.
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">

      {/* Contribution input */}
      <div className="px-5 py-3 border-b border-border bg-muted/30 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Monthly contribution to deploy — all amounts below update instantly:
        </p>
        <div className="flex items-center gap-2">
          <div className="flex items-center border border-border rounded-lg bg-card px-3 py-1.5 focus-within:ring-1 focus-within:ring-primary transition-shadow">
            <span className="text-sm font-semibold text-muted-foreground mr-1">$</span>
            <input
              type="text"
              inputMode="numeric"
              value={inputVal}
              onChange={e => handleInputChange(e.target.value)}
              onBlur={handleBlur}
              className="w-24 text-sm font-black tabular-nums bg-transparent focus:outline-none"
            />
            <span className="text-[11px] text-muted-foreground ml-1.5">USD</span>
          </div>
          {contribution !== defaultContribution && (
            <button
              onClick={() => { setContribution(defaultContribution); setInputVal(String(defaultContribution)) }}
              className="text-[11px] text-muted-foreground hover:text-foreground transition-colors underline"
            >
              Reset to ${defaultContribution.toLocaleString()}
            </button>
          )}
        </div>
      </div>

      {/* Market overlay note — explains why the plan adapted to conditions */}
      {dcaPlan.marketOverlayActive && dcaPlan.overlayNote && (
        <div className="px-5 py-3 border-b border-indigo-500/20 bg-indigo-500/[0.05] flex gap-2.5">
          <TrendingDown className="h-4 w-4 text-indigo-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wide mb-0.5">
              Plan adjusted for market conditions
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">{dcaPlan.overlayNote}</p>
          </div>
        </div>
      )}

      {/* Position rows */}
      <div className="divide-y divide-border">
        {positionsWithAlloc.map((p) => {
          const isHard    = p.status === "hard"
          const isSoft    = p.status === "soft"
          const isHealthy = p.status === "healthy"

          const StatusIcon = isHealthy ? CheckCircle2 : isSoft ? AlertTriangle : XCircle
          const under = p.driftPct < 0
          const iconWrapCls = isHard ? "pulse-red" : ""
          const iconCls = isHealthy
            ? "text-green-500"
            : isSoft
            ? (under ? "text-yellow-400" : "text-orange-500")
            : "text-red-500"

          const rowCls = isHard
            ? "border-l-[4px] border-red-500 bg-red-500/[0.025] dark:bg-red-500/[0.05]"
            : isSoft
            ? under
              ? "border-l-[3px] border-yellow-400 bg-yellow-400/[0.02] dark:bg-yellow-400/[0.04]"
              : "border-l-[3px] border-orange-500 bg-orange-500/[0.02] dark:bg-orange-500/[0.04]"
            : "border-l-4 border-transparent"

          const badgeCls = isHealthy
            ? "bg-green-500/10 text-green-600 dark:text-green-400 ring-1 ring-green-500/20"
            : isSoft
            ? under
              ? "bg-yellow-400/15 text-yellow-700 dark:text-yellow-400 ring-1 ring-yellow-400/30"
              : "bg-orange-500/15 text-orange-700 dark:text-orange-400 ring-1 ring-orange-500/30"
            : "bg-red-500/15 text-red-700 dark:text-red-400 ring-1 ring-red-500/30"

          const badgeLabel = isHealthy
            ? "On track"
            : isSoft
            ? (under ? "A bit small" : "A bit big")
            : (under ? "Buy now" : "Stop buying")

          const badgeTip = isHealthy
            ? `${p.ticker} is within its target range of ${p.targetPct}% (±${Math.abs(p.driftPct).toFixed(1)}%). No action needed.`
            : isSoft
            ? `${p.ticker} has drifted ${Math.abs(p.driftPct).toFixed(1)}% ${p.driftPct > 0 ? "above" : "below"} its ${p.targetPct}% target — outside the tolerance band. Redirect contributions over the next 2–3 months to correct this.`
            : `${p.ticker} has drifted ${Math.abs(p.driftPct).toFixed(1)}% ${p.driftPct > 0 ? "above" : "below"} its ${p.targetPct}% target — a hard breach. You need to act: ${p.driftPct > 0 ? `sell some ${p.ticker} to bring it back down` : `put all new money into ${p.ticker} until it recovers`} before this month's contribution.`

          const amountStr = p.suggestedAmount === 0 ? "$0" : `$${p.suggestedAmount.toLocaleString()}`
          const amountCls = p.allocationTag === "zeroed"
            ? "text-muted-foreground/60 line-through"
            : isHard
            ? "text-red-600 dark:text-red-400"
            : p.allocationTag === "boosted"
            ? (under ? "text-yellow-600 dark:text-yellow-400" : "text-orange-600 dark:text-orange-400")
            : "text-foreground"
          const amountSub = p.allocationTag === "zeroed"
            ? "paused"
            : p.allocationTag === "boosted"
            ? `↑ from $${p.standardAmount.toLocaleString()}`
            : "standard"

          const isAlert = isHard || isSoft

          const targetBarW  = Math.min(100, (p.targetPct / 70) * 100)
          const currentBarW = Math.min(100, (p.actualPct / 70) * 100)
          const projBarW    = Math.min(100, (p.projectedPct / 70) * 100)
          const impvSign    = p.driftImprovement > 0.05 ? "+" : p.driftImprovement < -0.05 ? "−" : "≈"
          const impvCls     = p.driftImprovement > 0.05 ? "text-green-500" : p.driftImprovement < -0.05 ? "text-red-500" : "text-muted-foreground"

          const rowContent = (
            <>
              <div className={`shrink-0 mt-0.5 ${iconWrapCls}`}>
                <StatusIcon className={`h-4 w-4 ${iconCls}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1.5">
                  <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: p.color, boxShadow: `0 0 6px ${p.color}80` }} />
                  <span className={`text-sm font-extrabold tracking-tight ${iconCls}`}>{p.ticker}</span>
                  <span className="text-xs text-muted-foreground hidden sm:inline">{p.name}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold cursor-help ${badgeCls}`} title={badgeTip}>{badgeLabel}</span>
                </div>
                <p className={`text-xs leading-relaxed mb-2.5 ${isHard || isSoft ? "text-foreground/70" : "text-muted-foreground"}`}>
                  {p.instruction}
                </p>

                {/* Before / after allocation bars */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground w-14 shrink-0">Now</span>
                    <div className="relative flex-1 h-2 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${currentBarW}%`, backgroundColor: p.color, opacity: 0.6 }} />
                      <div className="absolute inset-y-0 w-0.5 bg-foreground/30" style={{ left: `${targetBarW}%` }} />
                    </div>
                    <span className="text-[10px] tabular-nums font-semibold w-10 text-right">{p.actualPct.toFixed(1)}%</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground w-14 shrink-0">After</span>
                    <div className="relative flex-1 h-2 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${projBarW}%`, backgroundColor: p.color, opacity: 0.9 }} />
                      <div className="absolute inset-y-0 w-0.5 bg-foreground/30" style={{ left: `${targetBarW}%` }} />
                    </div>
                    <span className="text-[10px] tabular-nums font-bold w-10 text-right">{p.projectedPct.toFixed(1)}%</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground w-14 shrink-0">Target</span>
                    <div className="relative flex-1 h-1 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full opacity-30" style={{ width: `${targetBarW}%`, backgroundColor: p.color }} />
                      <div className="absolute inset-y-0 w-0.5 bg-foreground/50" style={{ left: `${targetBarW}%` }} />
                    </div>
                    <span className="text-[10px] tabular-nums text-muted-foreground w-10 text-right">{p.targetPct.toFixed(1)}%</span>
                  </div>
                </div>
              </div>
              <div className="shrink-0 text-right min-w-[5.5rem] ml-2">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Invest</p>
                <p className={`text-base font-black tabular-nums ${amountCls}`}>{amountStr}</p>
                <p className="text-[10px] text-muted-foreground mb-2">{amountSub}</p>
                {p.suggestedAmount > 0 && (
                  <div className={`text-[10px] font-bold ${impvCls}`}>
                    {impvSign}{Math.abs(p.driftImprovement).toFixed(1)}% to target
                  </div>
                )}
                {p.suggestedAmount > 0 && (
                  <div className="text-[10px] text-muted-foreground">
                    {p.driftImprovement > 0.05 ? "closer to target" : p.driftImprovement < -0.05 ? "further from target" : "no change"}
                  </div>
                )}
              </div>
            </>
          )

          return isAlert ? (
            <a key={p.ticker} href={`/portfolio#holding-${p.ticker}`}
              className={`flex items-start gap-4 px-5 py-4 transition-colors ${rowCls} cursor-pointer hover:brightness-[1.04] group`}>
              {rowContent}
            </a>
          ) : (
            <div key={p.ticker} className={`flex items-start gap-4 px-5 py-4 transition-colors ${rowCls}`}>
              {rowContent}
            </div>
          )
        })}
      </div>

      {/* Allocation plan footer */}
      <div className={`border-t ${hasAnyAlert
        ? "border-amber-400/40 bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-500/[0.07] dark:to-orange-500/[0.05] dark:border-amber-500/20"
        : "border-border bg-muted/20"
      }`}>
        {/* Top row — amounts */}
        <div className="px-5 pt-4 pb-3 flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-3">
              <Zap className={`h-3.5 w-3.5 shrink-0 ${hasAnyAlert ? "text-amber-500" : "text-muted-foreground"}`} />
              <p className={`text-xs font-bold uppercase tracking-wide ${hasAnyAlert ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>
                {hasAnyAlert ? "Adjusted Plan — Invest This Much This Month" : "Standard Monthly Investment Plan"}
              </p>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {allocOrder.map(ticker => {
                const pos = positionsWithAlloc.find(p => p.ticker === ticker)
                const amount = pos?.suggestedAmount ?? 0
                const standard = pos?.standardAmount ?? 0
                const isZeroed  = amount === 0
                const isBoosted = amount > standard
                return (
                  <div key={ticker} className="flex flex-col items-start">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-0.5">{ticker}</span>
                    <span className={`text-base font-black tabular-nums ${
                      isZeroed  ? "text-muted-foreground/50 line-through" :
                      isBoosted ? "text-amber-600 dark:text-amber-400" :
                      "text-foreground"
                    }`}>
                      ${amount.toLocaleString()}
                    </span>
                    {isBoosted && <span className="text-[9px] text-amber-600 dark:text-amber-500 font-semibold">↑ boosted</span>}
                    {isZeroed  && <span className="text-[9px] text-muted-foreground font-semibold">paused</span>}
                  </div>
                )
              })}
            </div>
          </div>
          <div className="shrink-0 text-right pl-4 border-l border-border/50">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Deploy</p>
            <p className="text-xl font-black tabular-nums">${contribution.toLocaleString()}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">this month</p>
          </div>
        </div>

        {/* Bottom row — impact summary */}
        <div className="px-5 pb-4 pt-3 border-t border-border/40 flex flex-wrap items-center gap-x-6 gap-y-2">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">Portfolio after</p>
            <p className="text-sm font-black tabular-nums">
              S${newTotalValue.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>
          <div className="h-8 w-px bg-border/50 hidden sm:block" />
          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">Positions improving</p>
            <p className="text-sm font-black tabular-nums text-green-500">
              {positionsWithAlloc.filter(p => p.driftImprovement > 0.05).length} / {positionsWithAlloc.length}
            </p>
          </div>
          <div className="h-8 w-px bg-border/50 hidden sm:block" />
          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">Avg move toward target</p>
            <p className="text-sm font-black tabular-nums text-green-500">
              {(() => {
                const improving = positionsWithAlloc.filter(p => p.suggestedAmount > 0)
                if (improving.length === 0) return "—"
                const avg = improving.reduce((s, p) => s + p.driftImprovement, 0) / improving.length
                return `${avg >= 0 ? "+" : ""}${avg.toFixed(2)}%`
              })()}
            </p>
          </div>
          <p className="text-[10px] text-muted-foreground ml-auto hidden md:block italic">
            Projections assume market prices unchanged
          </p>
        </div>
      </div>

      {/* Annual lump sum section */}
      {annualLumpSum > 0 && (
        <div className="border-t border-border bg-indigo-500/[0.03] px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
                <p className="text-xs font-bold uppercase tracking-wide text-indigo-700 dark:text-indigo-400">Annual Lump Sum — ${annualLumpSum.toLocaleString()} USD</p>
              </div>
              <p className="text-xs text-muted-foreground mb-3">Deploy as a single batch. Allocate proportionally — boost the most underweight positions first.</p>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {allocOrder.map(ticker => {
                  const pos = positions.find(p => p.ticker === ticker)
                  if (!pos) return null
                  const lumpSuggested = calculateSuggestedAllocations(positions, annualLumpSum, marketOverride).amounts
                  const amount = lumpSuggested[ticker] ?? 0
                  const standard = Math.round((pos.targetPct / 100) * annualLumpSum / 100) * 100
                  const isZeroed = amount === 0
                  const isBoosted = amount > standard
                  return (
                    <div key={ticker} className="flex flex-col items-start">
                      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-0.5">{ticker}</span>
                      <span className={`text-sm font-black tabular-nums ${isZeroed ? "text-muted-foreground/50 line-through" : isBoosted ? "text-indigo-600 dark:text-indigo-400" : "text-foreground"}`}>
                        ${amount.toLocaleString()}
                      </span>
                      {isBoosted && <span className="text-[9px] text-indigo-600 dark:text-indigo-500 font-semibold">boosted</span>}
                      {isZeroed && <span className="text-[9px] text-muted-foreground font-semibold">skip</span>}
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="shrink-0 text-right pl-4 border-l border-border/50">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Deploy</p>
              <p className="text-xl font-black tabular-nums">${annualLumpSum.toLocaleString()}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">once a year</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
