import { Shell } from "@/components/shell"
import { db } from "@/lib/db"
import { formatCurrency, formatPercent } from "@/lib/utils"
import { getSession } from "@/lib/session"
import { redirect } from "next/navigation"
import { AlertTriangle, BarChart3, Shield, TrendingDown, Activity, Info } from "lucide-react"

// ─── Risk Math ─────────────────────────────────────────────────────────────────

function mean(arr: number[]): number {
  return arr.reduce((s, v) => s + v, 0) / arr.length
}

function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0
  const m = mean(arr)
  const variance = arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1)
  return Math.sqrt(variance)
}

// Annualise a periodic std deviation (assumes approx 252 trading days but we
// scale by snapshot frequency instead)
function annualise(sd: number, avgDaysBetween: number): number {
  const periodsPerYear = 365 / Math.max(avgDaysBetween, 1)
  return sd * Math.sqrt(periodsPerYear)
}

// ─── Concentration (Herfindahl–Hirschman Index) ───────────────────────────────

function hhi(weights: number[]): number {
  // weights are fractions (0-1). Result 0-1. Higher = more concentrated.
  return weights.reduce((s, w) => s + w * w, 0)
}

function hhiLabel(h: number): { label: string; color: string } {
  if (h < 0.15) return { label: "Diversified", color: "text-green-500" }
  if (h < 0.25) return { label: "Moderate", color: "text-yellow-400" }
  return { label: "Concentrated", color: "text-red-500" }
}

// ─── Data Fetching ─────────────────────────────────────────────────────────────

async function getRiskData(userId: string) {
  const holdings = await db.holding.findMany({
    where: { userId },
    include: { snapshots: { orderBy: { date: "asc" } } },
    orderBy: { targetPct: "desc" },
  })

  // ── Step 1: Deduplicate snapshots per holding per date ─────────────────────
  // Multiple syncs on the same day create duplicate snapshots. Summing all of
  // them inflates the portfolio total (3 syncs → 3× the actual value) and
  // produces a fake "ATH" followed by a 66% drawdown.
  // We keep the LATEST snapshot value for each holding on each calendar date.
  const holdingDateMaps = new Map<string, Map<string, number>>()
  for (const h of holdings) {
    const dm = new Map<string, number>()
    for (const s of h.snapshots) {
      // snapshots ordered asc — later ones overwrite earlier ones on the same date
      dm.set(s.date.toISOString().split("T")[0], s.value)
    }
    holdingDateMaps.set(h.id, dm)
  }

  const holdingsWithData = holdings.filter(h => holdingDateMaps.get(h.id)!.size > 0)

  // ── Step 2: Build portfolio timeline (complete dates only) ─────────────────
  // Only include dates where EVERY holding has exactly one value — partial dates
  // (some holdings synced, others not) create the same inflation problem.
  const allDates = [...new Set(
    holdingsWithData.flatMap(h => [...holdingDateMaps.get(h.id)!.keys()])
  )].sort()

  const timeline = allDates
    .map(date => {
      const values = holdingsWithData.map(h => holdingDateMaps.get(h.id)!.get(date))
      if (values.some(v => v === undefined)) return null
      return { date, value: values.reduce((s, v) => s + v!, 0) }
    })
    .filter((x): x is { date: string; value: number } => x !== null)

  // ── Step 3: Period returns on clean timeline ───────────────────────────────
  const periodReturns: number[] = []
  const daysBetween: number[] = []
  for (let i = 1; i < timeline.length; i++) {
    const prev = timeline[i - 1]
    const curr = timeline[i]
    if (prev.value > 0) periodReturns.push((curr.value - prev.value) / prev.value)
    daysBetween.push((new Date(curr.date).getTime() - new Date(prev.date).getTime()) / 86_400_000)
  }

  const avgDays = daysBetween.length > 0 ? mean(daysBetween) : 30
  const periodSd = stdDev(periodReturns)
  const annualisedVol = annualise(periodSd, avgDays)
  const avgPeriodReturn = periodReturns.length > 0 ? mean(periodReturns) : 0
  const annualisedReturn = avgPeriodReturn * (365 / Math.max(avgDays, 1))

  // Sharpe (risk-free = 4% annual — Singapore T-bill proxy)
  const riskFree = 0.04
  const sharpe = annualisedVol > 0 ? (annualisedReturn - riskFree) / annualisedVol : null

  // Max Drawdown
  let peak = 0, maxDrawdown = 0, drawdownStart = "", drawdownEnd = "", peakDate = "", currentDrawdown = 0
  for (const { date, value } of timeline) {
    if (value > peak) { peak = value; peakDate = date }
    const dd = (value - peak) / Math.max(peak, 1)
    if (dd < maxDrawdown) { maxDrawdown = dd; drawdownStart = peakDate; drawdownEnd = date }
  }
  const lastValue = timeline[timeline.length - 1]?.value ?? 0
  if (peak > 0) currentDrawdown = (lastValue - peak) / peak

  // VaR 95% parametric (1.645σ)
  const var95Daily   = annualisedVol / Math.sqrt(252) * 1.645 * lastValue
  const var95Monthly = annualisedVol / Math.sqrt(12)  * 1.645 * lastValue

  // ── Step 4: Per-holding stats using deduplicated snapshots ─────────────────
  const holdingStats = holdings.map(h => {
    const dm = holdingDateMaps.get(h.id) ?? new Map<string, number>()
    const sortedDates = [...dm.keys()].sort()
    const hReturns: number[] = []
    const hDaysBetween: number[] = []
    for (let i = 1; i < sortedDates.length; i++) {
      const prevVal = dm.get(sortedDates[i - 1])!
      const currVal = dm.get(sortedDates[i])!
      if (prevVal > 0) hReturns.push((currVal - prevVal) / prevVal)
      hDaysBetween.push(
        (new Date(sortedDates[i]).getTime() - new Date(sortedDates[i - 1]).getTime()) / 86_400_000
      )
    }
    const hAvgDays = hDaysBetween.length > 0 ? mean(hDaysBetween) : avgDays
    const latestDate = sortedDates[sortedDates.length - 1]
    return {
      ticker: h.ticker,
      name: h.name,
      color: h.color,
      targetPct: h.targetPct,
      latestValue: latestDate ? (dm.get(latestDate) ?? 0) : 0,
      annualisedVol: annualise(stdDev(hReturns), Math.max(hAvgDays, 1)),
      dataPoints: sortedDates.length,
    }
  })

  // Current weights for HHI
  const totalValue = holdingStats.reduce((s, h) => s + h.latestValue, 0)
  const weights = holdingStats.map(h => totalValue > 0 ? h.latestValue / totalValue : 0)
  const hhiScore = hhi(weights)

  return {
    timeline,
    periodReturns,
    annualisedVol,
    annualisedReturn,
    sharpe,
    maxDrawdown,
    drawdownStart,
    drawdownEnd,
    currentDrawdown,
    var95Daily,
    var95Monthly,
    holdingStats,
    hhiScore,
    totalValue,
    dataPoints: timeline.length,
    avgDays,
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function volLabel(v: number): { label: string; color: string } {
  if (v < 0.08) return { label: "Low", color: "text-green-500" }
  if (v < 0.15) return { label: "Moderate", color: "text-yellow-400" }
  if (v < 0.25) return { label: "Elevated", color: "text-orange-500" }
  return { label: "High", color: "text-red-500" }
}

function sharpeLabel(s: number): { label: string; color: string } {
  if (s >= 2)   return { label: "Excellent", color: "text-green-500" }
  if (s >= 1)   return { label: "Good", color: "text-green-400" }
  if (s >= 0.5) return { label: "Adequate", color: "text-yellow-400" }
  if (s >= 0)   return { label: "Weak", color: "text-orange-500" }
  return { label: "Negative", color: "text-red-500" }
}

function ddLabel(dd: number): { label: string; color: string } {
  const abs = Math.abs(dd)
  if (abs < 0.05)  return { label: "Minimal", color: "text-green-500" }
  if (abs < 0.15)  return { label: "Moderate", color: "text-yellow-400" }
  if (abs < 0.30)  return { label: "Significant", color: "text-orange-500" }
  return { label: "Severe", color: "text-red-500" }
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default async function RiskPage() {
  const session = await getSession()
  if (!session) redirect("/login")

  const data = await getRiskData(session.userId)

  const hasData = data.dataPoints >= 2
  const hasSufficientData = data.periodReturns.length >= 3

  const volInfo = hasData ? volLabel(data.annualisedVol) : null
  const sharpeInfo = data.sharpe !== null ? sharpeLabel(data.sharpe) : null
  const ddInfo = hasData ? ddLabel(data.maxDrawdown) : null
  const hhiInfo = hhiLabel(data.hhiScore)

  return (
    <Shell title="Risk Metrics" subtitle="Volatility, drawdown, and concentration analysis" userName={session.name} isAdmin={session.role === "admin"}>
      <div className="space-y-5">

        {/* Data quality notice */}
        {!hasSufficientData && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 flex gap-3">
            <Info className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-amber-500">Limited historical data</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Risk metrics improve with more snapshots. Currently {data.dataPoints} snapshot{data.dataPoints !== 1 ? "s" : ""} recorded.
                Add more portfolio updates over time for accurate volatility calculations.
              </p>
            </div>
          </div>
        )}

        {/* Key Risk KPIs */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-border bg-card p-4 card-elevated">
            <div className="flex items-center gap-2 mb-2">
              <Activity className="h-4 w-4 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">Annualised Volatility</p>
            </div>
            {hasData ? (
              <>
                <p className={`text-2xl font-black tabular-nums ${volInfo?.color}`}>
                  {formatPercent(data.annualisedVol * 100, 1, false)}
                </p>
                <p className={`text-[11px] font-semibold mt-0.5 ${volInfo?.color}`}>{volInfo?.label}</p>
              </>
            ) : (
              <p className="text-2xl font-black text-muted-foreground">—</p>
            )}
          </div>

          <div className="rounded-xl border border-border bg-card p-4 card-elevated">
            <div className="flex items-center gap-2 mb-2">
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">Sharpe Ratio</p>
            </div>
            {data.sharpe !== null ? (
              <>
                <p className={`text-2xl font-black tabular-nums ${sharpeInfo?.color}`}>
                  {data.sharpe.toFixed(2)}
                </p>
                <p className={`text-[11px] font-semibold mt-0.5 ${sharpeInfo?.color}`}>{sharpeInfo?.label}</p>
              </>
            ) : (
              <p className="text-2xl font-black text-muted-foreground">—</p>
            )}
          </div>

          <div className="rounded-xl border border-border bg-card p-4 card-elevated">
            <div className="flex items-center gap-2 mb-2">
              <TrendingDown className="h-4 w-4 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">Max Drawdown</p>
            </div>
            {hasData ? (
              <>
                <p className={`text-2xl font-black tabular-nums ${ddInfo?.color}`}>
                  {formatPercent(data.maxDrawdown * 100, 1, true)}
                </p>
                <p className={`text-[11px] font-semibold mt-0.5 ${ddInfo?.color}`}>{ddInfo?.label}</p>
              </>
            ) : (
              <p className="text-2xl font-black text-muted-foreground">—</p>
            )}
          </div>

          <div className="rounded-xl border border-border bg-card p-4 card-elevated">
            <div className="flex items-center gap-2 mb-2">
              <Shield className="h-4 w-4 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">Concentration (HHI)</p>
            </div>
            <p className={`text-2xl font-black tabular-nums ${hhiInfo.color}`}>
              {data.hhiScore.toFixed(3)}
            </p>
            <p className={`text-[11px] font-semibold mt-0.5 ${hhiInfo.color}`}>{hhiInfo.label}</p>
          </div>
        </div>

        {/* VaR */}
        {hasData && (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-orange-500" />
              <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Value at Risk (95% Confidence)</h2>
            </div>
            <div className="p-5 grid grid-cols-2 gap-6">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Daily VaR (1-day)</p>
                <p className="text-xl font-black tabular-nums text-orange-500">
                  {formatCurrency(data.var95Daily, "SGD")}
                </p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  5% chance of losing more than this in a single day (parametric, normal distribution)
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Monthly VaR (30-day)</p>
                <p className="text-xl font-black tabular-nums text-orange-500">
                  {formatCurrency(data.var95Monthly, "SGD")}
                </p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  5% chance of losing more than this in a single month
                </p>
              </div>
            </div>
            <div className="px-5 pb-4">
              <p className="text-[11px] text-muted-foreground">
                Based on annualised volatility of {formatPercent(data.annualisedVol * 100, 1, false)}.
                VaR assumes normally distributed returns — actual fat-tail risk may be higher.
                Portfolio value: {formatCurrency(data.totalValue, "SGD")}.
              </p>
            </div>
          </div>
        )}

        {/* Drawdown detail */}
        {hasData && (data.maxDrawdown < -0.001 || data.currentDrawdown < -0.001) && (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-5 py-4 border-b border-border">
              <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Drawdown Analysis</h2>
            </div>
            <div className="p-5 grid grid-cols-2 gap-6">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Maximum Drawdown (all-time)</p>
                <p className={`text-xl font-black tabular-nums ${ddInfo?.color}`}>
                  {formatPercent(data.maxDrawdown * 100, 2, true)}
                </p>
                {data.drawdownStart && data.drawdownEnd && (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Peak: {new Date(data.drawdownStart).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" })} →{" "}
                    Trough: {new Date(data.drawdownEnd).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" })}
                  </p>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Current Drawdown from ATH</p>
                <p className={`text-xl font-black tabular-nums ${data.currentDrawdown < -0.01 ? "text-red-500" : "text-green-500"}`}>
                  {data.currentDrawdown >= -0.001 ? "At ATH" : formatPercent(data.currentDrawdown * 100, 2, true)}
                </p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  {data.currentDrawdown >= -0.001
                    ? "Portfolio is at or near its all-time high"
                    : `${formatCurrency(Math.abs(data.currentDrawdown) * data.totalValue, "SGD")} below all-time high`}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Per-holding volatility */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-5 py-4 border-b border-border">
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Holding-Level Risk</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-5 py-2.5 text-left font-semibold text-muted-foreground">Holding</th>
                  <th className="px-5 py-2.5 text-right font-semibold text-muted-foreground">Target %</th>
                  <th className="px-5 py-2.5 text-right font-semibold text-muted-foreground">Current Value</th>
                  <th className="px-5 py-2.5 text-right font-semibold text-muted-foreground">Ann. Volatility</th>
                  <th className="px-5 py-2.5 text-right font-semibold text-muted-foreground">Snapshots</th>
                  <th className="px-5 py-2.5 text-right font-semibold text-muted-foreground">Risk</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.holdingStats.map(h => {
                  const hVol = volLabel(h.annualisedVol)
                  return (
                    <tr key={h.ticker} className="hover:bg-accent/30 transition-colors">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-2 rounded-full shrink-0" style={{ background: h.color }} />
                          <span className="font-bold">{h.ticker}</span>
                          <span className="text-muted-foreground hidden sm:inline">{h.name}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums">{h.targetPct}%</td>
                      <td className="px-5 py-3 text-right tabular-nums font-semibold">{formatCurrency(h.latestValue, "SGD")}</td>
                      <td className="px-5 py-3 text-right tabular-nums">
                        {h.dataPoints >= 2 ? formatPercent(h.annualisedVol * 100, 1, false) : "—"}
                      </td>
                      <td className="px-5 py-3 text-right text-muted-foreground">{h.dataPoints}</td>
                      <td className={`px-5 py-3 text-right font-semibold ${h.dataPoints >= 2 ? hVol.color : "text-muted-foreground"}`}>
                        {h.dataPoints >= 2 ? hVol.label : "Insufficient data"}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Concentration (HHI) */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-5 py-4 border-b border-border">
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Concentration Analysis</h2>
          </div>
          <div className="p-5 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Herfindahl–Hirschman Index (HHI)</p>
                <p className={`text-3xl font-black tabular-nums ${hhiInfo.color}`}>{data.hhiScore.toFixed(4)}</p>
                <p className={`text-xs font-semibold mt-1 ${hhiInfo.color}`}>{hhiInfo.label}</p>
              </div>
              <div className="text-right text-xs text-muted-foreground space-y-1">
                <p>&lt;0.15 — Diversified</p>
                <p>0.15–0.25 — Moderate</p>
                <p>&gt;0.25 — Concentrated</p>
              </div>
            </div>

            {/* Weight bars */}
            <div className="space-y-2">
              {data.holdingStats.map(h => {
                const w = data.totalValue > 0 ? h.latestValue / data.totalValue : 0
                return (
                  <div key={h.ticker}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold">{h.ticker}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">{formatPercent(w * 100, 1, false)} actual · {h.targetPct}% target</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${Math.min(w * 100, 100)}%`, background: h.color }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Risk Glossary */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Methodology Notes</h2>
          <div className="grid gap-3 sm:grid-cols-2 text-xs text-muted-foreground">
            <div>
              <p className="font-semibold text-foreground mb-0.5">Annualised Volatility</p>
              <p>Standard deviation of periodic returns between snapshots, scaled to annual frequency. Computed from portfolio-level values (SGD).</p>
            </div>
            <div>
              <p className="font-semibold text-foreground mb-0.5">Sharpe Ratio</p>
              <p>Excess return over risk-free rate (4% SGD proxy) divided by annualised volatility. Requires at least 3 data points.</p>
            </div>
            <div>
              <p className="font-semibold text-foreground mb-0.5">Value at Risk (VaR)</p>
              <p>Parametric VaR assuming normal distribution. The 95% VaR represents the loss not exceeded with 95% probability over the given horizon.</p>
            </div>
            <div>
              <p className="font-semibold text-foreground mb-0.5">HHI Concentration</p>
              <p>Sum of squared portfolio weights. Ranges 0–1. A perfectly equal 5-asset portfolio has HHI = 0.20; single-asset = 1.0.</p>
            </div>
          </div>
        </div>

      </div>
    </Shell>
  )
}
