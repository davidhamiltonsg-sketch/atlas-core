import { Shell } from "@/components/shell"
import { db } from "@/lib/db"
import { formatCurrency } from "@/lib/utils"
import { TrendingUp, TrendingDown, Minus } from "lucide-react"
import { getSession } from "@/lib/session"
import { redirect } from "next/navigation"
import { PortfolioUpdateButton } from "@/components/portfolio-update-button"

async function getPortfolioData(userId: string) {
  const holdings = await db.holding.findMany({
    where: { userId },
    include: {
      snapshots: {
        orderBy: { date: "desc" },
        take: 1,
      },
    },
    orderBy: { targetPct: "desc" },
  })

  const totalValue = holdings.reduce((sum, h) => {
    const latest = h.snapshots[0]
    return sum + (latest?.value ?? 0)
  }, 0)

  return { holdings: holdings.map((h) => {
    const latest = h.snapshots[0]
    const value = latest?.value ?? 0
    const actualPct = totalValue > 0 ? (value / totalValue) * 100 : 0
    const drift = actualPct - h.targetPct
    const withinBand = Math.abs(drift) <= h.toleranceBand
    const overCap = h.hardCapPct !== null && actualPct > h.hardCapPct
    return { ...h, latestSnapshot: latest ?? null, value, actualPct, drift, withinBand, overCap }
  }), totalValue }
}

export default async function Portfolio() {
  const session = await getSession()
  if (!session) redirect("/login")
  const { holdings, totalValue } = await getPortfolioData(session.userId)
  const snapshotDate = holdings[0]?.latestSnapshot
    ? new Date(holdings[0].latestSnapshot.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : "—"

  return (
    <Shell title="Portfolio Architecture" subtitle="Holdings, target allocations, and hard caps" userName={session.name}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 mb-6">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Total Value</p>
          <p className="mt-1 text-xl font-semibold">{formatCurrency(totalValue, "USD")}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Holdings</p>
          <p className="mt-1 text-xl font-semibold">{holdings.length}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Within Tolerance</p>
          <p className="mt-1 text-xl font-semibold">
            {holdings.filter((h) => h.withinBand && !h.overCap).length}/{holdings.length}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Cap Breaches</p>
          <p className={`mt-1 text-xl font-semibold ${holdings.some((h) => h.overCap) ? "text-red-500" : ""}`}>
            {holdings.filter((h) => h.overCap).length}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold">Holdings</h2>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">Snapshot: {snapshotDate}</span>
            <PortfolioUpdateButton holdings={holdings.map((h) => ({
              id: h.id,
              ticker: h.ticker,
              name: h.name,
              latestUnits: h.latestSnapshot?.units ?? 0,
              latestPrice: h.latestSnapshot?.price ?? 0,
            }))} />
          </div>
        </div>

        <div className="hidden md:grid grid-cols-[44px_1fr_100px_70px_80px_80px] gap-4 px-5 py-2 border-b border-border bg-muted/40">
          {["", "Name", "Value", "Actual", "Target", "Drift"].map((h, i) => (
            <span key={i} className="text-[11px] font-medium text-muted-foreground">{h}</span>
          ))}
        </div>

        <div className="divide-y divide-border">
          {holdings.map((h) => {
            const DriftIcon = h.drift > 0.05 ? TrendingUp : h.drift < -0.05 ? TrendingDown : Minus
            const driftColor = h.overCap ? "text-red-500" : !h.withinBand ? "text-amber-500" : "text-green-500"
            return (
              <div key={h.ticker} className="grid grid-cols-[44px_1fr] md:grid-cols-[44px_1fr_100px_70px_80px_80px] items-center gap-x-4 gap-y-0.5 px-5 py-3 hover:bg-accent/30 transition-colors">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: h.color }} />
                  <span className="text-xs font-bold">{h.ticker}</span>
                </div>
                <span className="text-xs text-muted-foreground truncate">{h.name}</span>
                <span className="text-xs font-semibold text-right hidden md:block">{formatCurrency(h.value, "USD")}</span>
                <span className="text-xs text-right hidden md:block">{h.actualPct.toFixed(1)}%</span>
                <span className="text-xs text-muted-foreground text-right hidden md:block">
                  {h.targetPct}%{h.hardCapPct && <span className="text-[10px] ml-1 opacity-60">cap {h.hardCapPct}%</span>}
                </span>
                <div className={`hidden md:flex items-center gap-1 justify-end text-xs font-medium ${driftColor}`}>
                  <DriftIcon className="h-3 w-3" />
                  {h.drift >= 0 ? "+" : ""}{h.drift.toFixed(1)}%
                  {h.overCap && <span className="text-[10px] font-normal ml-1 bg-red-500/15 px-1 rounded">CAP</span>}
                </div>
                <div className="col-span-2 flex items-center justify-between md:hidden text-xs mt-0.5">
                  <span className="font-semibold">{formatCurrency(h.value, "USD")}</span>
                  <span className={`font-medium ${driftColor}`}>{h.actualPct.toFixed(1)}% · {h.drift >= 0 ? "+" : ""}{h.drift.toFixed(1)}% drift</span>
                </div>
              </div>
            )
          })}
        </div>

        <div className="px-5 py-4 border-t border-border">
          <p className="text-[11px] text-muted-foreground mb-2">Allocation</p>
          <div className="flex h-2 rounded-full overflow-hidden gap-px bg-muted">
            {holdings.map((h) => (
              <div key={h.ticker} style={{ width: `${h.actualPct}%`, backgroundColor: h.color }} title={`${h.ticker}: ${h.actualPct.toFixed(1)}%`} />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
            {holdings.map((h) => (
              <div key={h.ticker} className="flex items-center gap-1.5">
                <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: h.color }} />
                <span className="text-[11px] text-muted-foreground">{h.ticker} {h.actualPct.toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Shell>
  )
}
