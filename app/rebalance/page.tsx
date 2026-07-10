import { Shell } from "@/components/shell"
import { db } from "@/lib/db"
import { formatCurrency } from "@/lib/utils"
import { getSession } from "@/lib/session"
import { redirect } from "next/navigation"
import { GitCompare, ArrowUp, ArrowDown, Minus } from "lucide-react"
import { HARD_THRESHOLDS } from "@/lib/constants"
import { applyBitcoinSleeve } from "@/lib/next-best-move"
import { constitutionIdForEmail } from "@/lib/constitutions"

async function getRebalanceData(userId: string, isSbr: boolean) {
  const [holdings, user] = await Promise.all([
    db.holding.findMany({
      where: { userId },
      include: { snapshots: { orderBy: { date: "desc" }, take: 1 } },
      orderBy: { targetPct: "desc" },
    }),
    db.user.findUnique({ where: { id: userId }, select: { monthlyContribution: true } }),
  ])
  const monthlyContribution = user?.monthlyContribution ?? 3000

  const totalValue = holdings.reduce((sum, h) => sum + (h.snapshots[0]?.value ?? 0), 0)

  // Effective targets with the Bitcoin sleeve applied: BTC runs off (hold-in-place, no
  // buy/sell), IBIT is the accumulation vehicle. So rebalance never says "buy BTC / sell IBIT".
  const effTarget: Record<string, number> = {}
  const sleeved = applyBitcoinSleeve(holdings.map(h => ({
    ticker: h.ticker,
    actualPct: totalValue > 0 ? ((h.snapshots[0]?.value ?? 0) / totalValue) * 100 : 0,
    targetPct: h.targetPct,
  })))
  for (const p of sleeved) effTarget[p.ticker] = p.targetPct

  const positions = holdings.map(h => {
    const value = h.snapshots[0]?.value ?? 0
    const actualPct = totalValue > 0 ? (value / totalValue) * 100 : 0
    const tgt = effTarget[h.ticker] ?? h.targetPct
    const driftPct = actualPct - tgt
    const absDrift = Math.abs(driftPct)
    // Hard-breach test: Atlas Core uses its §3 drift triggers; other constitutions (Silicon
    // Brick Road) use the holding's own §2 cap and comfortable band, which are stored per-user.
    const ht = HARD_THRESHOLDS[h.ticker]
    const isHard = totalValue > 0 && (
      isSbr
        ? ((h.hardCapPct !== null && actualPct > h.hardCapPct) || actualPct < Math.max(0, tgt - h.toleranceBand * 2))
        : ((ht?.low !== undefined && actualPct < ht.low) || (ht !== undefined && actualPct > ht.high))
    )
    const isSoft = totalValue > 0 && !isHard && absDrift > h.toleranceBand

    // Target value = effective target% of total
    const targetValue = (tgt / 100) * totalValue
    const deviation = value - targetValue // positive = overweight in SGD

    // Contribution-based: how many months to correct via contributions alone?
    // Uses the user's actual monthly contribution (not a hardcoded figure).
    const correctionMonths = Math.abs(deviation) > 0 ? Math.ceil(Math.abs(deviation) / monthlyContribution) : 0

    return {
      ticker: h.ticker,
      name: h.name,
      color: h.color,
      value,
      actualPct,
      targetPct: tgt,
      hardCapPct: h.hardCapPct,
      driftPct,
      isHard,
      isSoft,
      targetValue,
      deviation,
      correctionMonths,
    }
  })

  return { positions, totalValue }
}

export default async function RebalancePage() {
  const session = await getSession()
  if (!session) redirect("/login")

  const isSbr = constitutionIdForEmail(session.email) === "silicon-brick-road"
  const { positions, totalValue } = await getRebalanceData(session.userId, isSbr)
  const hasBalance = totalValue > 0

  const hardBreaches = positions.filter(p => p.isHard).length
  const softBreaches = positions.filter(p => p.isSoft).length

  return (
    <Shell title="Rebalance Calculator" subtitle="How much to sell or buy to restore target allocations" userName={session.name} isAdmin={session.role === "admin"}>

      {!hasBalance ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <GitCompare className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm font-medium">No portfolio data yet</p>
          <p className="text-xs text-muted-foreground mt-1">Enter your holdings on the Portfolio page first.</p>
        </div>
      ) : (
        <>
          {/* Status */}
          <div className="grid grid-cols-3 gap-3 mb-6">
            <div className="rounded-xl border border-border bg-card p-4 card-elevated">
              <p className="text-xs text-muted-foreground">Portfolio Value</p>
              <p className="text-2xl font-black tabular-nums mt-1">{formatCurrency(totalValue, "SGD")}</p>
            </div>
            <div className={`rounded-xl border bg-card p-4 card-elevated ${hardBreaches > 0 ? "border-red-500/30" : "border-border"}`}>
              <p className="text-xs text-muted-foreground">Hard Breaches</p>
              <p className={`text-2xl font-black tabular-nums mt-1 ${hardBreaches > 0 ? "text-red-500" : "text-green-500"}`}>{hardBreaches}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{hardBreaches > 0 ? "Require immediate action" : "None — all within caps"}</p>
            </div>
            <div className={`rounded-xl border bg-card p-4 card-elevated ${softBreaches > 0 ? "border-yellow-400/30" : "border-border"}`}>
              <p className="text-xs text-muted-foreground">Soft Breaches</p>
              <p className={`text-2xl font-black tabular-nums mt-1 ${softBreaches > 0 ? "text-yellow-400" : "text-green-500"}`}>{softBreaches}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{softBreaches > 0 ? "Redirect contributions" : "All within tolerance"}</p>
            </div>
          </div>

          {/* Rebalancing priority */}
          <div className="mb-5 rounded-xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              <span className="font-bold text-foreground">Rebalancing priority order (per governance rules):</span>{" "}
              1. Redirect contributions to underweight positions.{" "}
              2. Halt accumulation of overweight positions.{" "}
              3. Sell only when hard thresholds are breached and contribution-based correction would take more than 6 months.
            </p>
          </div>

          {/* Position table */}
          <div className="rounded-xl border border-border bg-card overflow-hidden mb-6">
            <div className="px-5 py-4 border-b border-border">
              <h2 className="text-sm font-semibold">Position Analysis</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Deviation from target · colour-coded by severity</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="px-5 py-2.5 text-left font-semibold text-muted-foreground">Position</th>
                    <th className="px-5 py-2.5 text-right font-semibold text-muted-foreground">Current</th>
                    <th className="px-5 py-2.5 text-right font-semibold text-muted-foreground">Target</th>
                    <th className="px-5 py-2.5 text-right font-semibold text-muted-foreground">Drift</th>
                    <th className="px-5 py-2.5 text-right font-semibold text-muted-foreground">Deviation (SGD)</th>
                    <th className="px-5 py-2.5 text-right font-semibold text-muted-foreground">Action</th>
                    <th className="px-5 py-2.5 text-right font-semibold text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {positions.map(p => {
                    const isOver = p.deviation > 0
                    const rowCls = p.isHard
                      ? "border-l-4 border-red-500"
                      : p.isSoft
                      ? isOver ? "border-l-[3px] border-orange-500" : "border-l-[3px] border-yellow-400"
                      : "border-l-4 border-transparent"

                    const driftCls = p.isHard
                      ? "text-red-500"
                      : p.isSoft
                      ? isOver ? "text-orange-500" : "text-yellow-400"
                      : "text-green-500"

                    const action = p.isHard
                      ? isOver ? "SELL excess" : "BUY urgently"
                      : p.isSoft
                      ? isOver ? "Pause buys" : "Boost buys"
                      : "Hold"

                    const actionCls = p.isHard
                      ? "bg-red-500/15 text-red-600 dark:text-red-400 ring-1 ring-red-500/30"
                      : p.isSoft
                      ? isOver ? "bg-orange-500/15 text-orange-600 dark:text-orange-400 ring-1 ring-orange-500/30" : "bg-yellow-400/15 text-yellow-700 dark:text-yellow-400 ring-1 ring-yellow-400/30"
                      : "bg-green-500/10 text-green-600 dark:text-green-400 ring-1 ring-green-500/20"

                    return (
                      <tr key={p.ticker} className={`hover:bg-accent/30 transition-colors ${rowCls}`}>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
                            <span className="font-bold">{p.ticker}</span>
                            <span className="text-muted-foreground hidden sm:inline">{p.name}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3 text-right tabular-nums">{p.actualPct.toFixed(1)}%</td>
                        <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">{p.targetPct.toFixed(1)}%</td>
                        <td className={`px-5 py-3 text-right tabular-nums font-semibold ${driftCls}`}>
                          <span className="flex items-center justify-end gap-1">
                            {p.driftPct > 0.1 ? <ArrowUp className="h-3 w-3" /> : p.driftPct < -0.1 ? <ArrowDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
                            {p.driftPct >= 0 ? "+" : ""}{p.driftPct.toFixed(1)}%
                          </span>
                        </td>
                        <td className={`px-5 py-3 text-right tabular-nums font-semibold ${isOver ? "text-red-500" : p.deviation < 0 ? "text-yellow-400" : "text-muted-foreground"}`}>
                          {isOver ? "+" : ""}{formatCurrency(Math.abs(p.deviation), "SGD")}
                          {isOver ? " over" : p.deviation < 0 ? " under" : ""}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${actionCls}`}>{action}</span>
                        </td>
                        <td className="px-5 py-3 text-right text-muted-foreground">
                          {(p.isHard || p.isSoft) && p.correctionMonths > 0
                            ? `~${p.correctionMonths}mo via contributions`
                            : "On track"
                          }
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Sell scenario for hard breaches */}
          {positions.some(p => p.isHard && p.deviation > 0) && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/[0.04] overflow-hidden mb-4">
              <div className="px-5 py-4 border-b border-red-500/20">
                <h2 className="text-sm font-semibold text-red-600 dark:text-red-400">Hard Sell Scenario</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Exact amounts to sell to bring overweight hard-breached positions back to target</p>
              </div>
              <div className="divide-y divide-red-500/10">
                {positions.filter(p => p.isHard && p.deviation > 0).map(p => (
                  <div key={p.ticker} className="flex items-center justify-between px-5 py-3">
                    <span className="text-sm font-bold text-red-600 dark:text-red-400">{p.ticker}</span>
                    <div className="text-right">
                      <p className="text-sm font-black text-red-500">Sell {formatCurrency(p.deviation, "SGD")}</p>
                      <p className="text-[11px] text-muted-foreground">to reach {p.targetPct.toFixed(1)}% target</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Buy scenario for underweight */}
          {positions.some(p => p.isHard && p.deviation < 0) && (
            <div className="rounded-xl border border-yellow-400/30 bg-yellow-400/[0.04] overflow-hidden mb-4">
              <div className="px-5 py-4 border-b border-yellow-400/20">
                <h2 className="text-sm font-semibold text-yellow-700 dark:text-yellow-400">Underweight Hard Breach — Priority Buys</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Redirect all contributions to these positions until back within range</p>
              </div>
              <div className="divide-y divide-yellow-400/10">
                {positions.filter(p => p.isHard && p.deviation < 0).map(p => (
                  <div key={p.ticker} className="flex items-center justify-between px-5 py-3">
                    <span className="text-sm font-bold text-yellow-700 dark:text-yellow-400">{p.ticker}</span>
                    <div className="text-right">
                      <p className="text-sm font-black text-yellow-600 dark:text-yellow-400">Need {formatCurrency(Math.abs(p.deviation), "SGD")}</p>
                      <p className="text-[11px] text-muted-foreground">to reach {p.targetPct.toFixed(1)}% target</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </Shell>
  )
}
