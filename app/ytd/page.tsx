import { Shell } from "@/components/shell"
import { db } from "@/lib/db"
import { formatCurrency, formatPercent } from "@/lib/utils"
import { getSession } from "@/lib/session"
import { redirect } from "next/navigation"
import { TrendingUp, TrendingDown, DollarSign, BarChart3, Info } from "lucide-react"

// ─── Data ──────────────────────────────────────────────────────────────────────

async function getYtdData(userId: string) {
  const now = new Date()
  const ytdStart = new Date(now.getFullYear(), 0, 1) // Jan 1 this year

  const [holdings, trades, dividends] = await Promise.all([
    db.holding.findMany({
      where: { userId },
      include: { snapshots: { orderBy: { date: "asc" } } },
      orderBy: { targetPct: "desc" },
    }),
    db.trade.findMany({
      where: { userId },
      orderBy: { date: "asc" },
    }),
    db.dividend.findMany({
      where: { userId },
      orderBy: { paymentDate: "desc" },
    }),
  ])

  // ── Cost Basis (FIFO from all-time trades) ───────────────────────────────────
  // Track cost basis per ticker using weighted average cost method
  type AvgCostEntry = { units: number; totalCost: number } // totalCost in SGD
  const avgCost: Record<string, AvgCostEntry> = {}

  const sortedTrades = [...trades].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

  for (const t of sortedTrades) {
    if (!avgCost[t.ticker]) avgCost[t.ticker] = { units: 0, totalCost: 0 }
    if (t.type === "BUY") {
      avgCost[t.ticker].units += t.units
      avgCost[t.ticker].totalCost += t.amount // SGD
    } else if (t.type === "SELL") {
      const avgPerUnit = avgCost[t.ticker].units > 0
        ? avgCost[t.ticker].totalCost / avgCost[t.ticker].units
        : 0
      avgCost[t.ticker].units = Math.max(0, avgCost[t.ticker].units - t.units)
      avgCost[t.ticker].totalCost = avgCost[t.ticker].units * avgPerUnit
    }
  }

  // ── Current portfolio values ─────────────────────────────────────────────────
  const holdingData = holdings.map(h => {
    const latestSnap = h.snapshots[h.snapshots.length - 1]
    const firstSnap = h.snapshots[0]

    // Value at start of year (closest snapshot before ytdStart)
    const snapsBefore = h.snapshots.filter(s => s.date < ytdStart)
    const ytdStartSnap = snapsBefore[snapsBefore.length - 1]

    // YTD start: first snap of year if no snap before
    const snapsInYear = h.snapshots.filter(s => s.date >= ytdStart)
    const firstYtdSnap = snapsInYear[0]

    const startValue = ytdStartSnap?.value ?? firstYtdSnap?.value ?? 0
    const currentValue = latestSnap?.value ?? 0
    const units = latestSnap?.units ?? 0
    const currentPrice = latestSnap?.price ?? 0

    const cb = avgCost[h.ticker]
    const costBasisTotal = cb ? cb.totalCost : 0
    const avgCostPerUnit = cb && cb.units > 0 ? cb.totalCost / cb.units : null

    // Unrealised P&L = current market value - cost basis
    const unrealisedPnl = costBasisTotal > 0 ? currentValue - costBasisTotal : null
    const unrealisedPct = costBasisTotal > 0 && costBasisTotal > 0 ? (unrealisedPnl! / costBasisTotal) * 100 : null

    // YTD return
    const ytdReturn = startValue > 0 ? currentValue - startValue : null
    const ytdReturnPct = startValue > 0 ? ((currentValue - startValue) / startValue) * 100 : null

    return {
      ticker: h.ticker,
      name: h.name,
      color: h.color,
      targetPct: h.targetPct,
      units,
      currentPrice,
      currentValue,
      costBasisTotal,
      avgCostPerUnit,
      unrealisedPnl,
      unrealisedPct,
      ytdReturn,
      ytdReturnPct,
      hasData: latestSnap !== undefined,
    }
  })

  const totalCurrentValue = holdingData.reduce((s, h) => s + h.currentValue, 0)
  const totalCostBasis = holdingData.reduce((s, h) => s + h.costBasisTotal, 0)
  const totalUnrealisedPnl = totalCostBasis > 0 ? totalCurrentValue - totalCostBasis : null
  const totalUnrealisedPct = totalCostBasis > 0 ? ((totalCurrentValue - totalCostBasis) / totalCostBasis) * 100 : null

  // ── YTD portfolio return ─────────────────────────────────────────────────────
  // Sum of per-holding ytd returns (SGD)
  const ytdReturns = holdingData.filter(h => h.ytdReturn !== null)
  const totalYtdReturn = ytdReturns.length > 0 ? ytdReturns.reduce((s, h) => s + (h.ytdReturn ?? 0), 0) : null

  // YTD start value = sum of start values
  const startValues = holdings.map(h => {
    const snapsBefore = h.snapshots.filter(s => s.date < ytdStart)
    const ytdStartSnap = snapsBefore[snapsBefore.length - 1]
    const snapsInYear = h.snapshots.filter(s => s.date >= ytdStart)
    const firstYtdSnap = snapsInYear[0]
    return ytdStartSnap?.value ?? firstYtdSnap?.value ?? 0
  })
  const totalStartValue = startValues.reduce((s, v) => s + v, 0)
  const totalYtdPct = totalStartValue > 0 && totalYtdReturn !== null
    ? (totalYtdReturn / totalStartValue) * 100
    : null

  // ── Realised P&L (from SELLs this year) ─────────────────────────────────────
  // Simplified: sell amount minus cost basis at time of sale
  const ytdSells = sortedTrades.filter(t => t.type === "SELL" && new Date(t.date) >= ytdStart)
  // We track avg cost up to each sell by replaying trades up to that point
  let realisedPnl = 0
  const tempAvgCost: Record<string, AvgCostEntry> = {}
  for (const t of sortedTrades) {
    const isYtdSell = t.type === "SELL" && new Date(t.date) >= ytdStart
    if (!tempAvgCost[t.ticker]) tempAvgCost[t.ticker] = { units: 0, totalCost: 0 }
    if (t.type === "BUY") {
      tempAvgCost[t.ticker].units += t.units
      tempAvgCost[t.ticker].totalCost += t.amount
    } else if (t.type === "SELL") {
      const avgPU = tempAvgCost[t.ticker].units > 0
        ? tempAvgCost[t.ticker].totalCost / tempAvgCost[t.ticker].units
        : 0
      if (isYtdSell) realisedPnl += t.amount - avgPU * t.units
      tempAvgCost[t.ticker].units = Math.max(0, tempAvgCost[t.ticker].units - t.units)
      tempAvgCost[t.ticker].totalCost = tempAvgCost[t.ticker].units * avgPU
    }
  }

  // ── YTD Dividends ────────────────────────────────────────────────────────────
  const ytdDividends = dividends.filter(d => new Date(d.paymentDate) >= ytdStart)
  const ytdDividendTotal = ytdDividends.reduce((s, d) => s + d.amount, 0)

  // ── YTD Contributions ────────────────────────────────────────────────────────
  const contributions = await db.contributionRecord.findMany({ where: { userId } })
  const ytdContributions = contributions.filter(c => new Date(c.date) >= ytdStart)
  const ytdContribTotal = ytdContributions.reduce((s, c) => s + c.amount, 0)

  const hasCostBasis = totalCostBasis > 0

  return {
    holdingData,
    totalCurrentValue,
    totalCostBasis,
    totalUnrealisedPnl,
    totalUnrealisedPct,
    totalYtdReturn,
    totalYtdPct,
    realisedPnl: ytdSells.length > 0 ? realisedPnl : null,
    ytdDividendTotal,
    ytdContribTotal,
    hasCostBasis,
    year: now.getFullYear(),
    tradeCount: trades.length,
  }
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default async function YtdPage() {
  const session = await getSession()
  if (!session) redirect("/login")

  const data = await getYtdData(session.userId)

  return (
    <Shell title="YTD Performance" subtitle={`Year-to-date returns and cost basis — ${data.year}`} userName={session.name} isAdmin={session.role === "admin"}>
      <div className="space-y-5">

        {/* Cost basis notice */}
        {!data.hasCostBasis && (
          <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-4 flex gap-3">
            <Info className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-blue-400">No trades recorded yet</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Log your buy/sell transactions in the{" "}
                <a href="/trades" className="underline hover:text-foreground transition-colors">Trade Log</a>{" "}
                to see cost basis and unrealised P&L. YTD snapshot returns are shown where available.
              </p>
            </div>
          </div>
        )}

        {/* Summary KPIs */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-border bg-card p-4 card-elevated">
            <p className="text-xs text-muted-foreground mb-1">YTD Return</p>
            {data.totalYtdReturn !== null ? (
              <>
                <p className={`text-2xl font-black tabular-nums ${data.totalYtdReturn >= 0 ? "text-green-500" : "text-red-500"}`}>
                  {data.totalYtdReturn >= 0 ? "+" : ""}{formatCurrency(data.totalYtdReturn, "SGD")}
                </p>
                <p className={`text-[11px] font-semibold mt-0.5 ${data.totalYtdPct !== null && data.totalYtdPct >= 0 ? "text-green-500" : "text-red-500"}`}>
                  {data.totalYtdPct !== null ? (data.totalYtdPct >= 0 ? "+" : "") + formatPercent(data.totalYtdPct, 2, false) : "—"}
                </p>
              </>
            ) : (
              <p className="text-2xl font-black text-muted-foreground">—</p>
            )}
          </div>

          <div className="rounded-xl border border-border bg-card p-4 card-elevated">
            <p className="text-xs text-muted-foreground mb-1">Unrealised P&L</p>
            {data.totalUnrealisedPnl !== null ? (
              <>
                <p className={`text-2xl font-black tabular-nums ${data.totalUnrealisedPnl >= 0 ? "text-green-500" : "text-red-500"}`}>
                  {data.totalUnrealisedPnl >= 0 ? "+" : ""}{formatCurrency(data.totalUnrealisedPnl, "SGD")}
                </p>
                <p className={`text-[11px] font-semibold mt-0.5 ${data.totalUnrealisedPct !== null && data.totalUnrealisedPct >= 0 ? "text-green-500" : "text-red-500"}`}>
                  {data.totalUnrealisedPct !== null ? (data.totalUnrealisedPct >= 0 ? "+" : "") + formatPercent(data.totalUnrealisedPct, 2, false) + " vs cost" : "—"}
                </p>
              </>
            ) : (
              <p className="text-2xl font-black text-muted-foreground">—</p>
            )}
          </div>

          <div className="rounded-xl border border-border bg-card p-4 card-elevated">
            <p className="text-xs text-muted-foreground mb-1">YTD Dividends</p>
            <p className={`text-2xl font-black tabular-nums ${data.ytdDividendTotal > 0 ? "text-green-500" : "text-muted-foreground"}`}>
              {data.ytdDividendTotal > 0 ? formatCurrency(data.ytdDividendTotal, "SGD") : "—"}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Income received {data.year}</p>
          </div>

          <div className="rounded-xl border border-border bg-card p-4 card-elevated">
            <p className="text-xs text-muted-foreground mb-1">YTD Contributions</p>
            <p className={`text-2xl font-black tabular-nums ${data.ytdContribTotal > 0 ? "text-indigo-400" : "text-muted-foreground"}`}>
              {data.ytdContribTotal > 0 ? formatCurrency(data.ytdContribTotal, "USD") : "—"}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Capital added {data.year}</p>
          </div>
        </div>

        {/* Realised P&L (only if any sells) */}
        {data.realisedPnl !== null && (
          <div className={`rounded-xl border p-4 flex items-center gap-4 ${data.realisedPnl >= 0 ? "border-green-500/30 bg-green-500/5" : "border-red-500/30 bg-red-500/5"}`}>
            <DollarSign className={`h-5 w-5 shrink-0 ${data.realisedPnl >= 0 ? "text-green-500" : "text-red-500"}`} />
            <div>
              <p className="text-xs text-muted-foreground">{data.year} Realised P&L (from sell transactions)</p>
              <p className={`text-xl font-black tabular-nums ${data.realisedPnl >= 0 ? "text-green-500" : "text-red-500"}`}>
                {data.realisedPnl >= 0 ? "+" : ""}{formatCurrency(data.realisedPnl, "SGD")}
              </p>
            </div>
          </div>
        )}

        {/* Per-holding table */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-5 py-4 border-b border-border">
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Holdings — Cost Basis &amp; Returns</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-5 py-2.5 text-left font-semibold text-muted-foreground">Holding</th>
                  <th className="px-5 py-2.5 text-right font-semibold text-muted-foreground">Current Value</th>
                  <th className="px-5 py-2.5 text-right font-semibold text-muted-foreground">Cost Basis</th>
                  <th className="px-5 py-2.5 text-right font-semibold text-muted-foreground">Avg Cost / Unit</th>
                  <th className="px-5 py-2.5 text-right font-semibold text-muted-foreground">Unrealised P&L</th>
                  <th className="px-5 py-2.5 text-right font-semibold text-muted-foreground">YTD Return</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.holdingData.map(h => (
                  <tr key={h.ticker} className="hover:bg-accent/30 transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-2 rounded-full shrink-0" style={{ background: h.color }} />
                        <span className="font-bold">{h.ticker}</span>
                        <span className="text-muted-foreground hidden sm:inline">{h.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums font-semibold">
                      {h.hasData ? formatCurrency(h.currentValue, "SGD") : "—"}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                      {h.costBasisTotal > 0 ? formatCurrency(h.costBasisTotal, "SGD") : "—"}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                      {h.avgCostPerUnit !== null
                        ? `$${h.avgCostPerUnit.toFixed(4)} USD`
                        : "—"}
                    </td>
                    <td className={`px-5 py-3 text-right tabular-nums font-semibold ${
                      h.unrealisedPnl === null ? "text-muted-foreground"
                      : h.unrealisedPnl >= 0 ? "text-green-500" : "text-red-500"
                    }`}>
                      {h.unrealisedPnl !== null ? (
                        <>
                          {h.unrealisedPnl >= 0 ? "+" : ""}{formatCurrency(h.unrealisedPnl, "SGD")}
                          <span className="text-[10px] font-normal ml-1">
                            ({h.unrealisedPct !== null ? (h.unrealisedPct >= 0 ? "+" : "") + formatPercent(h.unrealisedPct, 1, false) : ""})
                          </span>
                        </>
                      ) : "—"}
                    </td>
                    <td className={`px-5 py-3 text-right tabular-nums font-semibold ${
                      h.ytdReturn === null ? "text-muted-foreground"
                      : h.ytdReturn >= 0 ? "text-green-500" : "text-red-500"
                    }`}>
                      {h.ytdReturn !== null ? (
                        <>
                          {h.ytdReturn >= 0 ? "+" : ""}{formatCurrency(h.ytdReturn, "SGD")}
                          <span className="text-[10px] font-normal ml-1">
                            ({h.ytdReturnPct !== null ? (h.ytdReturnPct >= 0 ? "+" : "") + formatPercent(h.ytdReturnPct, 1, false) : ""})
                          </span>
                        </>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
              {data.hasCostBasis && (
                <tfoot>
                  <tr className="border-t border-border bg-muted/20">
                    <td className="px-5 py-3 font-semibold text-muted-foreground">Total</td>
                    <td className="px-5 py-3 text-right font-black tabular-nums">{formatCurrency(data.totalCurrentValue, "SGD")}</td>
                    <td className="px-5 py-3 text-right font-semibold tabular-nums text-muted-foreground">{formatCurrency(data.totalCostBasis, "SGD")}</td>
                    <td className="px-5 py-3" />
                    <td className={`px-5 py-3 text-right font-black tabular-nums ${
                      data.totalUnrealisedPnl !== null && data.totalUnrealisedPnl >= 0 ? "text-green-500" : "text-red-500"
                    }`}>
                      {data.totalUnrealisedPnl !== null
                        ? (data.totalUnrealisedPnl >= 0 ? "+" : "") + formatCurrency(data.totalUnrealisedPnl, "SGD")
                        : "—"}
                    </td>
                    <td className={`px-5 py-3 text-right font-black tabular-nums ${
                      data.totalYtdReturn !== null && data.totalYtdReturn >= 0 ? "text-green-500" : "text-red-500"
                    }`}>
                      {data.totalYtdReturn !== null
                        ? (data.totalYtdReturn >= 0 ? "+" : "") + formatCurrency(data.totalYtdReturn, "SGD")
                        : "—"}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        {/* Notes */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Notes</h2>
          <div className="space-y-1.5 text-xs text-muted-foreground">
            <p>Cost basis uses the <span className="font-semibold text-foreground">weighted average cost method</span> — recalculated each time units are added. All values in SGD.</p>
            <p>YTD return compares current snapshot value to the last snapshot before 1 Jan {data.year}. Where no prior-year snapshot exists, the first snapshot of the year is used as the baseline.</p>
            <p>Unrealised P&L = current market value minus total cost basis. This reflects the gain/loss if you sold your entire position today.</p>
            <p>Dividend income and contribution records must be entered in their respective sections to appear here.</p>
          </div>
        </div>

      </div>
    </Shell>
  )
}
