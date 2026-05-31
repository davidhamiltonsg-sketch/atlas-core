import { Shell } from "@/components/shell"
import { db } from "@/lib/db"
import { formatCurrency } from "@/lib/utils"
import { getSession } from "@/lib/session"
import { redirect } from "next/navigation"
import { History, TrendingUp, TrendingDown } from "lucide-react"
import { PortfolioHistoryChart } from "@/components/charts/portfolio-history-chart"

async function getHistoryData(userId: string) {
  const holdings = await db.holding.findMany({
    where: { userId },
    include: {
      snapshots: { orderBy: { date: "asc" } },
    },
  })

  // Deduplicate: keep latest snapshot value per holding per calendar date
  // (Multiple IBKR syncs on the same day create duplicate records; summing them inflates the total)
  const holdingDateMaps = new Map<string, Map<string, { value: number; units: number; price: number }>>()
  for (const h of holdings) {
    const dm = new Map<string, { value: number; units: number; price: number }>()
    for (const s of h.snapshots) {
      // snapshots ordered asc — later ones naturally overwrite earlier ones on the same date
      dm.set(s.date.toISOString().split("T")[0], { value: s.value, units: s.units, price: s.price })
    }
    holdingDateMaps.set(h.id, dm)
  }

  const holdingsWithData = holdings.filter(h => holdingDateMaps.get(h.id)!.size > 0)

  // Portfolio timeline: only include dates where ALL holdings have data
  const allDates = [...new Set(
    holdingsWithData.flatMap(h => [...holdingDateMaps.get(h.id)!.keys()])
  )].sort()

  const sorted = allDates
    .map(date => {
      const values = holdingsWithData.map(h => holdingDateMaps.get(h.id)!.get(date)?.value)
      if (values.some(v => v === undefined)) return null
      return {
        date,
        label: new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" }),
        value: values.reduce<number>((s, v) => s + v!, 0),
      }
    })
    .filter((x): x is { date: string; label: string; value: number } => x !== null)

  // Per-holding history (deduplicated — one row per date)
  const holdingHistory = holdings.map(h => {
    const dm = holdingDateMaps.get(h.id) ?? new Map<string, { value: number; units: number; price: number }>()
    const dedupedSnaps = [...dm.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, s]) => ({
        date,
        label: new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
        value: s.value,
        units: s.units,
        price: s.price,
      }))
    return { ticker: h.ticker, name: h.name, color: h.color, snapshots: dedupedSnaps }
  })

  return { history: sorted, holdingHistory }
}

export default async function HistoryPage() {
  const session = await getSession()
  if (!session) redirect("/login")

  const { history, holdingHistory } = await getHistoryData(session.userId)

  const chartPoints = history.map(h => ({ label: h.label, value: h.value }))

  // Stats
  const first = history[0]
  const last = history[history.length - 1]
  const totalReturn = first && last ? last.value - first.value : null
  const totalReturnPct = first && last && first.value > 0 ? ((last.value - first.value) / first.value) * 100 : null
  const peak = history.reduce((max, h) => h.value > max ? h.value : max, 0)
  const current = last?.value ?? 0
  const drawdown = peak > 0 ? ((current - peak) / peak) * 100 : 0

  return (
    <Shell title="Portfolio History" subtitle="Value over time — all snapshots" userName={session.name} isAdmin={session.role === "admin"}>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-6">
        <div className="rounded-xl border border-border bg-card p-4 card-elevated flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">Current Value</p>
          <p className="text-2xl font-black tabular-nums">{formatCurrency(current, "SGD")}</p>
          <p className="text-[11px] text-muted-foreground">Latest snapshot</p>
        </div>
        <div className={`rounded-xl border bg-card p-4 card-elevated flex flex-col gap-2 ${totalReturn !== null && totalReturn >= 0 ? "border-green-500/30" : "border-red-500/30"}`}>
          <p className="text-xs text-muted-foreground">Total Return</p>
          <p className={`text-2xl font-black tabular-nums ${totalReturn !== null && totalReturn >= 0 ? "text-green-500" : "text-red-500"}`}>
            {totalReturn !== null ? formatCurrency(Math.abs(totalReturn), "SGD") : "—"}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {totalReturnPct !== null ? `${totalReturnPct >= 0 ? "+" : ""}${totalReturnPct.toFixed(1)}% all time` : "Insufficient data"}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 card-elevated flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">All-Time High</p>
          <p className="text-2xl font-black tabular-nums text-indigo-500">{formatCurrency(peak, "SGD")}</p>
          <p className="text-[11px] text-muted-foreground">Peak portfolio value</p>
        </div>
        <div className={`rounded-xl border bg-card p-4 card-elevated flex flex-col gap-2 ${drawdown < -10 ? "border-red-500/30" : drawdown < -5 ? "border-yellow-400/30" : "border-border"}`}>
          <p className="text-xs text-muted-foreground">From Peak</p>
          <p className={`text-2xl font-black tabular-nums ${drawdown < -10 ? "text-red-500" : drawdown < -5 ? "text-yellow-400" : "text-green-500"}`}>
            {drawdown.toFixed(1)}%
          </p>
          <p className="text-[11px] text-muted-foreground">Drawdown from ATH</p>
        </div>
      </div>

      {/* Portfolio value chart */}
      {chartPoints.length > 1 ? (
        <div className="rounded-xl border border-border bg-card overflow-hidden mb-6">
          <div className="px-5 py-4 border-b border-border">
            <h2 className="text-sm font-semibold">Portfolio Value Over Time</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{history.length} snapshots · SGD</p>
          </div>
          <div className="p-4">
            <PortfolioHistoryChart data={chartPoints} height={280} />
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card p-8 text-center mb-6">
          <History className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm font-medium">Not enough history yet</p>
          <p className="text-xs text-muted-foreground mt-1">Update your portfolio prices regularly to build a history timeline.</p>
        </div>
      )}

      {/* Per-holding history */}
      <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Holdings History</h2>
      <div className="space-y-4">
        {holdingHistory.map(h => (
          <div key={h.ticker} className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-3 border-b border-border">
              <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: h.color, boxShadow: `0 0 6px ${h.color}80` }} />
              <h3 className="text-sm font-bold">{h.ticker}</h3>
              <span className="text-xs text-muted-foreground">{h.name}</span>
              <span className="ml-auto text-[11px] text-muted-foreground">{h.snapshots.length} snapshots</span>
            </div>
            {h.snapshots.length === 0 ? (
              <p className="px-5 py-4 text-xs text-muted-foreground">No snapshots recorded.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="px-5 py-2.5 text-left font-semibold text-muted-foreground">Date</th>
                      <th className="px-5 py-2.5 text-right font-semibold text-muted-foreground">Units</th>
                      <th className="px-5 py-2.5 text-right font-semibold text-muted-foreground">Price (USD)</th>
                      <th className="px-5 py-2.5 text-right font-semibold text-muted-foreground">Value (SGD)</th>
                      <th className="px-5 py-2.5 text-right font-semibold text-muted-foreground">Change</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {[...h.snapshots].reverse().map((s, i, arr) => {
                      const prev = arr[i + 1]
                      const change = prev ? s.value - prev.value : null
                      const changePct = prev && prev.value > 0 ? ((s.value - prev.value) / prev.value) * 100 : null
                      return (
                        <tr key={s.date} className="hover:bg-accent/30 transition-colors">
                          <td className="px-5 py-3 font-medium">{s.label}</td>
                          <td className="px-5 py-3 text-right tabular-nums">{s.units.toLocaleString()}</td>
                          <td className="px-5 py-3 text-right tabular-nums">${s.price.toFixed(2)}</td>
                          <td className="px-5 py-3 text-right tabular-nums font-semibold">{formatCurrency(s.value, "SGD")}</td>
                          <td className="px-5 py-3 text-right">
                            {change !== null ? (
                              <span className={`flex items-center justify-end gap-1 font-semibold tabular-nums ${change >= 0 ? "text-green-500" : "text-red-500"}`}>
                                {change >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                                {changePct !== null ? `${change >= 0 ? "+" : ""}${changePct.toFixed(1)}%` : "—"}
                              </span>
                            ) : <span className="text-muted-foreground">—</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>
    </Shell>
  )
}
