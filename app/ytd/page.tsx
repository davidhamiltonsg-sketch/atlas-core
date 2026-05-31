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
  // Days elapsed in the year so far (minimum 1 to avoid division by zero on Jan 1)
  const totalDays = Math.max(1, Math.ceil((now.getTime() - ytdStart.getTime()) / 86400000))

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

  const sortedTrades = [...trades].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

  // ── Cost Basis — weighted average per ticker ─────────────────────────────────
  // Track SGD cost (for unrealised P&L vs current SGD value) AND
  // USD cost (for avgCostPerUnit display — price is USD/unit).
  type AvgCostEntry = { units: number; totalCostSgd: number; totalCostUsd: number }
  const avgCost: Record<string, AvgCostEntry> = {}

  for (const t of sortedTrades) {
    if (!avgCost[t.ticker]) avgCost[t.ticker] = { units: 0, totalCostSgd: 0, totalCostUsd: 0 }
    if (t.type === "BUY") {
      avgCost[t.ticker].units       += t.units
      avgCost[t.ticker].totalCostSgd += t.amount          // SGD: units × price × fxRate
      avgCost[t.ticker].totalCostUsd += t.units * t.price // USD: units × price
    } else if (t.type === "SELL") {
      const avgSgdPU = avgCost[t.ticker].units > 0 ? avgCost[t.ticker].totalCostSgd / avgCost[t.ticker].units : 0
      const avgUsdPU = avgCost[t.ticker].units > 0 ? avgCost[t.ticker].totalCostUsd / avgCost[t.ticker].units : 0
      const remaining = Math.max(0, avgCost[t.ticker].units - t.units)
      avgCost[t.ticker].units        = remaining
      avgCost[t.ticker].totalCostSgd = remaining * avgSgdPU
      avgCost[t.ticker].totalCostUsd = remaining * avgUsdPU
    }
  }

  // ── YTD trade cash-flows ─────────────────────────────────────────────────────
  const ytdBuys  = sortedTrades.filter(t => t.type === "BUY"  && new Date(t.date) >= ytdStart)
  const ytdSells = sortedTrades.filter(t => t.type === "SELL" && new Date(t.date) >= ytdStart)

  // Per-ticker net capital deployed YTD (SGD) — for stripping out contributions from returns
  const ytdNetBuysSgd:  Record<string, number> = {}
  const ytdNetSellsSgd: Record<string, number> = {}
  for (const t of ytdBuys)  ytdNetBuysSgd[t.ticker]  = (ytdNetBuysSgd[t.ticker]  ?? 0) + t.amount
  for (const t of ytdSells) ytdNetSellsSgd[t.ticker] = (ytdNetSellsSgd[t.ticker] ?? 0) + t.amount

  // Total YTD contributions in USD (BUY trades only; price is USD/unit)
  const ytdContribTotal = ytdBuys.reduce((s, t) => s + t.units * t.price, 0)

  // ── Realised P&L (SELL trades this year vs weighted-avg cost at time of sale) ─
  let realisedPnl = 0
  const tempAvgCost: Record<string, { units: number; totalCostSgd: number }> = {}
  for (const t of sortedTrades) {
    const isYtdSell = t.type === "SELL" && new Date(t.date) >= ytdStart
    if (!tempAvgCost[t.ticker]) tempAvgCost[t.ticker] = { units: 0, totalCostSgd: 0 }
    if (t.type === "BUY") {
      tempAvgCost[t.ticker].units        += t.units
      tempAvgCost[t.ticker].totalCostSgd += t.amount
    } else if (t.type === "SELL") {
      const avgPU = tempAvgCost[t.ticker].units > 0
        ? tempAvgCost[t.ticker].totalCostSgd / tempAvgCost[t.ticker].units : 0
      if (isYtdSell) realisedPnl += t.amount - avgPU * t.units
      const remaining = Math.max(0, tempAvgCost[t.ticker].units - t.units)
      tempAvgCost[t.ticker].units        = remaining
      tempAvgCost[t.ticker].totalCostSgd = remaining * avgPU
    }
  }

  // ── Per-holding data ─────────────────────────────────────────────────────────
  const holdingData = holdings.map(h => {
    const latestSnap = h.snapshots[h.snapshots.length - 1]

    const snapsBefore = h.snapshots.filter(s => s.date < ytdStart)
    const ytdStartSnap = snapsBefore[snapsBefore.length - 1]
    const snapsInYear  = h.snapshots.filter(s => s.date >= ytdStart)
    const firstYtdSnap = snapsInYear[0]

    const startValue   = ytdStartSnap?.value ?? firstYtdSnap?.value ?? 0
    const currentValue = latestSnap?.value ?? 0
    const units        = latestSnap?.units ?? 0
    const currentPrice = latestSnap?.price ?? 0

    const cb = avgCost[h.ticker]
    const costBasisTotal  = cb ? cb.totalCostSgd : 0
    // avgCostPerUnit = USD weighted-average purchase price (what you paid per share in USD)
    const avgCostPerUnit  = cb && cb.units > 0 ? cb.totalCostUsd / cb.units : null

    // Unrealised P&L: current SGD market value vs SGD cost basis
    const unrealisedPnl = costBasisTotal > 0 ? currentValue - costBasisTotal : null
    const unrealisedPct = costBasisTotal > 0 ? (unrealisedPnl! / costBasisTotal) * 100 : null

    // YTD market return: strip out capital deployed this year
    // marketReturn = EMV - BMV - ytdBuys + ytdSells (all SGD)
    const tickerBuys  = ytdNetBuysSgd[h.ticker]  ?? 0
    const tickerSells = ytdNetSellsSgd[h.ticker] ?? 0
    const hasActivity = startValue > 0 || tickerBuys > 0
    const ytdReturn   = hasActivity ? currentValue - startValue - tickerBuys + tickerSells : null

    // Per-holding Modified Dietz %
    // Denominator = BMV + Σ(Wi × buyAmount) - Σ(Wi × sellAmount)
    const mdBuys = ytdBuys.filter(t => t.ticker === h.ticker).reduce((s, t) => {
      const dayOfFlow = Math.max(0, Math.ceil((new Date(t.date).getTime() - ytdStart.getTime()) / 86400000))
      const wi = (totalDays - dayOfFlow) / totalDays
      return s + wi * t.amount
    }, 0)
    const mdSells = ytdSells.filter(t => t.ticker === h.ticker).reduce((s, t) => {
      const dayOfFlow = Math.max(0, Math.ceil((new Date(t.date).getTime() - ytdStart.getTime()) / 86400000))
      const wi = (totalDays - dayOfFlow) / totalDays
      return s + wi * t.amount
    }, 0)
    const mdDenominator = startValue + mdBuys - mdSells
    const ytdReturnPct  = ytdReturn !== null && mdDenominator > 0
      ? (ytdReturn / mdDenominator) * 100 : null

    return {
      ticker: h.ticker, name: h.name, color: h.color, targetPct: h.targetPct,
      units, currentPrice, currentValue,
      costBasisTotal, avgCostPerUnit,
      unrealisedPnl, unrealisedPct,
      ytdReturn, ytdReturnPct,
      hasData: latestSnap !== undefined,
    }
  })

  const totalCurrentValue  = holdingData.reduce((s, h) => s + h.currentValue, 0)
  const totalCostBasis     = holdingData.reduce((s, h) => s + h.costBasisTotal, 0)

  // Only aggregate unrealised P&L for holdings that have recorded trades.
  // If cost basis is partial (e.g. 2 of 5 holdings have trades), the portfolio-level
  // % becomes meaningless (current value >> partial cost) — suppress the % until complete.
  const holdingsWithBasis    = holdingData.filter(h => h.costBasisTotal > 0)
  const holdingsWithoutBasis = holdingData.filter(h => h.costBasisTotal === 0 && h.hasData)
  const hasCompleteCostBasis = holdingsWithoutBasis.length === 0 && holdingsWithBasis.length > 0

  // Unrealised uses only the subset with actual cost basis
  const basisSubsetCost    = holdingsWithBasis.reduce((s, h) => s + h.costBasisTotal, 0)
  const basisSubsetValue   = holdingsWithBasis.reduce((s, h) => s + h.currentValue, 0)
  const totalUnrealisedPnl = basisSubsetCost > 0 ? basisSubsetValue - basisSubsetCost : null
  const totalUnrealisedPct = hasCompleteCostBasis && basisSubsetCost > 0
    ? ((basisSubsetValue - basisSubsetCost) / basisSubsetCost) * 100
    : null // hide % when partial — SGD figure is still shown

  // ── Portfolio-level YTD (Modified Dietz) ────────────────────────────────────
  const totalStartValue = holdings.reduce((s, h) => {
    const snapsBefore = h.snapshots.filter(snap => snap.date < ytdStart)
    const ytdStartSnap = snapsBefore[snapsBefore.length - 1]
    const snapsInYear  = h.snapshots.filter(snap => snap.date >= ytdStart)
    const firstYtdSnap = snapsInYear[0]
    return s + (ytdStartSnap?.value ?? firstYtdSnap?.value ?? 0)
  }, 0)

  const totalYtdBuysSgd  = ytdBuys.reduce((s, t) => s + t.amount, 0)
  const totalYtdSellsSgd = ytdSells.reduce((s, t) => s + t.amount, 0)

  // Market return = EMV - BMV - net cash deployed
  const totalYtdReturn = (totalCurrentValue > 0 || totalStartValue > 0)
    ? totalCurrentValue - totalStartValue - totalYtdBuysSgd + totalYtdSellsSgd
    : null

  // Modified Dietz denominator = BMV + Σ(Wi × inflows) - Σ(Wi × outflows)
  const mdBuysDenom = ytdBuys.reduce((s, t) => {
    const dayOfFlow = Math.max(0, Math.ceil((new Date(t.date).getTime() - ytdStart.getTime()) / 86400000))
    const wi = (totalDays - dayOfFlow) / totalDays
    return s + wi * t.amount
  }, 0)
  const mdSellsDenom = ytdSells.reduce((s, t) => {
    const dayOfFlow = Math.max(0, Math.ceil((new Date(t.date).getTime() - ytdStart.getTime()) / 86400000))
    const wi = (totalDays - dayOfFlow) / totalDays
    return s + wi * t.amount
  }, 0)
  const mdDenominator = totalStartValue + mdBuysDenom - mdSellsDenom
  const totalYtdPct = totalYtdReturn !== null && mdDenominator > 0
    ? (totalYtdReturn / mdDenominator) * 100 : null

  // ── YTD Dividends ────────────────────────────────────────────────────────────
  const ytdDividends     = dividends.filter(d => new Date(d.paymentDate) >= ytdStart)
  const ytdDividendTotal = ytdDividends.reduce((s, d) => s + d.amount, 0)

  const hasCostBasis = totalCostBasis > 0

  return {
    holdingData,
    totalCurrentValue,
    totalCostBasis,
    totalUnrealisedPnl,
    totalUnrealisedPct,
    hasCompleteCostBasis,
    holdingsWithBasisCount: holdingsWithBasis.length,
    holdingsTotalCount: holdingData.filter(h => h.hasData).length,
    totalYtdReturn,
    totalYtdPct,
    realisedPnl: ytdSells.length > 0 ? realisedPnl : null,
    ytdDividendTotal,
    ytdContribTotal, // USD (from BUY trades this year)
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

        {/* Partial cost basis notice */}
        {data.hasCostBasis && !data.hasCompleteCostBasis && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 flex gap-3">
            <Info className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-amber-500">Partial cost basis — {data.holdingsWithBasisCount} of {data.holdingsTotalCount} holdings have trade records</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Unrealised P&L % is suppressed at the portfolio level until all holdings have logged trades — a partial basis
                makes the portfolio % meaningless. Individual holding rows show accurate figures where trades exist.
                Add remaining trades in the <a href="/trades" className="underline hover:text-foreground transition-colors">Trade Log</a>.
              </p>
            </div>
          </div>
        )}

        {/* Summary KPIs */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-border bg-card p-4 card-elevated">
            <p className="text-xs text-muted-foreground mb-1">YTD Market Return</p>
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
                {data.totalUnrealisedPct !== null ? (
                  <p className={`text-[11px] font-semibold mt-0.5 ${data.totalUnrealisedPct >= 0 ? "text-green-500" : "text-red-500"}`}>
                    {(data.totalUnrealisedPct >= 0 ? "+" : "") + formatPercent(data.totalUnrealisedPct, 2, false)} vs cost
                  </p>
                ) : (
                  <p className="text-[11px] text-amber-500 mt-0.5">
                    {data.holdingsWithBasisCount}/{data.holdingsTotalCount} holdings
                  </p>
                )}
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
            <p className="text-xs text-muted-foreground mb-1">YTD Capital Deployed</p>
            <p className={`text-2xl font-black tabular-nums ${data.ytdContribTotal > 0 ? "text-indigo-400" : "text-muted-foreground"}`}>
              {data.ytdContribTotal > 0 ? formatCurrency(data.ytdContribTotal, "USD") : "—"}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">From BUY trades {data.year}</p>
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
                  <th className="px-5 py-2.5 text-right font-semibold text-muted-foreground">YTD Market Return</th>
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
                    <td className="px-5 py-3 font-semibold text-muted-foreground">
                      Total
                      {!data.hasCompleteCostBasis && (
                        <span className="text-[10px] font-normal text-amber-500 ml-1">({data.holdingsWithBasisCount}/{data.holdingsTotalCount} w/ basis)</span>
                      )}
                    </td>
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
            <p>Cost basis uses the <span className="font-semibold text-foreground">weighted average cost method</span> — recalculated each time units are added. Cost basis is in SGD; avg cost/unit is the USD price paid per share.</p>
            <p><span className="font-semibold text-foreground">YTD Market Return</span> uses the <span className="font-semibold text-foreground">Modified Dietz method</span>: market gain = EMV − BMV − net capital deployed. The % denominator accounts for the timing of each BUY/SELL so contributions are not mistaken for returns.</p>
            <p>Unrealised P&L = current SGD market value minus SGD cost basis. This reflects the gain/loss if you sold your entire position today.</p>
            <p>YTD Capital Deployed = sum of BUY trade amounts in USD this year. BUY trades automatically create a linked contribution record for monthly tracking.</p>
          </div>
        </div>

      </div>
    </Shell>
  )
}
