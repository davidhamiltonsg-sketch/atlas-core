import { Shell } from "@/components/shell"
import { TrendingUp, ShieldCheck, AlertTriangle, Activity, CheckCircle2, XCircle } from "lucide-react"
import { db } from "@/lib/db"
import { formatCurrency, formatPercent } from "@/lib/utils"
import { getSession } from "@/lib/session"
import { redirect } from "next/navigation"

// v5.2 hard drift thresholds
const HARD_THRESHOLDS: Record<string, { low?: number; high: number }> = {
  VT:   { low: 40, high: 62 },
  QQQM: { low: 16, high: 31 },
  SMH:  { high: 15 },
  VWO:  { low: 4,  high: 12 },
  BTC:  { high: 8  },
}

// v5.2 standard monthly allocation
const MONTHLY_ALLOC: Record<string, number> = {
  VT: 1560, QQQM: 690, SMH: 300, VWO: 240, BTC: 210,
}

const TOTAL_MONTHLY = 3000

type ActionStatus = "healthy" | "soft" | "hard"

// Computes drift-adjusted allocation for the next monthly contribution.
// Overweight positions (soft or hard) are zeroed; freed capital is redistributed
// to the remaining positions proportionally by target weight.
function calculateSuggestedAllocations(
  positions: Array<{ ticker: string; actualPct: number; targetPct: number; status: ActionStatus }>
): Record<string, number> {
  const isOverweight = (p: { actualPct: number; targetPct: number; status: ActionStatus }) =>
    p.actualPct > p.targetPct && p.status !== "healthy"

  const active = positions.filter(p => !isOverweight(p))

  const result: Record<string, number> = {}
  positions.forEach(p => { result[p.ticker] = 0 })

  if (active.length === 0) return result

  const activeTotalTarget = active.reduce((sum, p) => sum + p.targetPct, 0)

  // Proportional shares, rounded to nearest $10
  const rounded = active.map(p => ({
    ticker: p.ticker,
    amount: Math.round(((p.targetPct / activeTotalTarget) * TOTAL_MONTHLY) / 10) * 10,
  }))

  // Ensure exact total
  const diff = TOTAL_MONTHLY - rounded.reduce((s, a) => s + a.amount, 0)
  if (diff !== 0 && rounded.length > 0) {
    const maxIdx = rounded.reduce((mi, a, i, arr) => a.amount > arr[mi].amount ? i : mi, 0)
    rounded[maxIdx].amount += diff
  }

  rounded.forEach(a => { result[a.ticker] = a.amount })
  return result
}

async function getDashboardData(userId: string) {
  const holdings = await db.holding.findMany({
    where: { userId },
    include: { snapshots: { orderBy: { date: "desc" }, take: 1 } },
  })

  const totalValue = holdings.reduce((sum, h) => sum + (h.snapshots[0]?.value ?? 0), 0)

  const positions = holdings.map((h) => {
    const value = h.snapshots[0]?.value ?? 0
    const actualPct = totalValue > 0 ? (value / totalValue) * 100 : 0
    const driftPct = actualPct - h.targetPct
    const absDrift = Math.abs(driftPct)
    const overCap = h.hardCapPct !== null && actualPct > h.hardCapPct

    const ht = HARD_THRESHOLDS[h.ticker]
    const isHardDrift = overCap ||
      (ht?.low !== undefined && actualPct < ht.low) ||
      (ht !== undefined && actualPct > ht.high)
    const isSoftDrift = !isHardDrift && absDrift > h.toleranceBand

    let status: ActionStatus
    let instruction: string

    if (isHardDrift) {
      status = "hard"
      instruction = driftPct < 0
        ? `Hard drift — underweight at ${actualPct.toFixed(1)}% vs ${h.targetPct}% target. Redirect all contributions to ${h.ticker} until restored. Review at next dealing window.`
        : `Hard drift — overweight at ${actualPct.toFixed(1)}% vs ${h.targetPct}% target. Halt all accumulation immediately. Assess selective trim at next dealing window.`
    } else if (isSoftDrift) {
      status = "soft"
      instruction = driftPct < 0
        ? `Soft drift — underweight at ${actualPct.toFixed(1)}% vs ${h.targetPct}% target. Redirect contributions to ${h.ticker} for next 3 months until restored to healthy range.`
        : `Soft drift — overweight at ${actualPct.toFixed(1)}% vs ${h.targetPct}% target. Pause ${h.ticker} accumulation. Freed capital redirected to underweight positions.`
    } else {
      status = "healthy"
      instruction = `Within healthy range at ${actualPct.toFixed(1)}% vs ${h.targetPct}% target. Continue standard monthly allocation.`
    }

    return { ticker: h.ticker, name: h.name, color: h.color, actualPct, targetPct: h.targetPct, driftPct, status, instruction }
  })

  // Compute drift-adjusted suggested allocations
  const suggested = calculateSuggestedAllocations(positions)
  const hasAnyAlert = positions.some(p => p.status !== "healthy")

  const positionsWithAlloc = positions.map(p => {
    const amount = suggested[p.ticker] ?? 0
    const standard = MONTHLY_ALLOC[p.ticker] ?? 0
    const tag: "standard" | "boosted" | "zeroed" =
      amount === 0 ? "zeroed" : amount > standard ? "boosted" : "standard"
    return { ...p, suggestedAmount: amount, allocationTag: tag }
  })

  // Sort: hard first, then soft, then healthy
  const order: Record<ActionStatus, number> = { hard: 0, soft: 1, healthy: 2 }
  positionsWithAlloc.sort((a, b) => order[a.status] - order[b.status])

  const driftAlerts = positions.filter(p => p.status !== "healthy").length
  const maxDrift = positions.reduce((max, p) => Math.max(max, Math.abs(p.driftPct)), 0)
  const activeRules = await db.governanceRule.count({ where: { active: true } })
  const hardBreaches = positions.filter(p => p.status === "hard").length
  const softBreaches = positions.filter(p => p.status === "soft").length
  const healthScore = Math.max(0, Math.round(100 - hardBreaches * 15 - softBreaches * 7 - maxDrift * 1.5))

  return { totalValue, positions: positionsWithAlloc, driftAlerts, activeRules, healthScore, hasAnyAlert, suggested }
}

const sections = [
  { title: "Portfolio Architecture", desc: "Holdings, target allocations, and hard caps.", href: "/portfolio", status: "Active" },
  { title: "Governance Engine", desc: "Rules, drift thresholds, and contribution routing logic.", href: "/governance", status: "Active" },
  { title: "Behavioural System", desc: "Maintain discipline. Log emotions. Resist over-optimisation.", href: "/behaviour", status: "Active" },
  { title: "Reports", desc: "Overlap and concentration engine — look-through exposure.", href: "/reports", status: "Active" },
  { title: "Forecast Engine", desc: "Compounding trajectories to the 2045 horizon.", href: "/forecast", status: "Active" },
]

export default async function Dashboard() {
  const session = await getSession()
  if (!session) redirect("/login")
  const { totalValue, positions, driftAlerts, activeRules, healthScore, hasAnyAlert, suggested } = await getDashboardData(session.userId)

  const healthColor = healthScore >= 80 ? "text-green-500" : healthScore >= 60 ? "text-amber-500" : "text-red-500"
  const healthLabel = healthScore >= 80 ? "Good standing" : healthScore >= 60 ? "Review recommended" : "Action required"

  const statCards = [
    { label: "Portfolio Value", value: formatCurrency(totalValue, "USD"), sub: "USD · IBKR", icon: TrendingUp, cls: "" },
    { label: "Health Score", value: `${healthScore}`, sub: healthLabel, icon: Activity, cls: healthColor },
    { label: "Active Rules", value: `${activeRules}`, sub: "Governance rules enforced", icon: ShieldCheck, cls: "" },
    { label: "Drift Alerts", value: `${driftAlerts}`, sub: driftAlerts === 0 ? "All within tolerance" : `${driftAlerts} position${driftAlerts > 1 ? "s" : ""} outside band`, icon: AlertTriangle, cls: driftAlerts > 0 ? "text-amber-500" : "" },
  ]

  // Ordered for the allocation plan row (natural seed order)
  const allocOrder = ["VT", "QQQM", "SMH", "VWO", "BTC"]

  return (
    <Shell title="Dashboard" subtitle="Your investment operating system" userName={session.name}>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        {statCards.map(({ label, value, sub, icon: Icon, cls }) => (
          <div key={label} className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3 card-elevated">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">{label}</span>
              <Icon className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <div>
              <p className={`text-2xl font-semibold tracking-tight ${cls}`}>{value}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Next execution instructions */}
      <div className="mt-6">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Next Execution Instructions</h2>
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          {positions.length === 0 ? (
            <div className="px-5 py-8 text-center text-xs text-muted-foreground">No holdings found. Seed the database to generate instructions.</div>
          ) : (
            <>
              {/* Per-position rows */}
              <div className="divide-y divide-border">
                {positions.map((p) => {
                  const isHard = p.status === "hard"
                  const isSoft = p.status === "soft"
                  const isHealthy = p.status === "healthy"

                  const StatusIcon = isHealthy ? CheckCircle2 : isSoft ? AlertTriangle : XCircle

                  // Row accent: left border + very subtle bg wash
                  const rowCls = isHard
                    ? "border-l-4 border-red-500 bg-red-500/[0.03] dark:bg-red-500/[0.05]"
                    : isSoft
                    ? "border-l-[3px] border-amber-400 bg-amber-500/[0.03] dark:bg-amber-500/[0.04]"
                    : "border-l-4 border-transparent"

                  const iconWrapCls = isHard ? "pulse-red" : isSoft ? "pulse-amber" : ""
                  const iconCls = isHealthy ? "text-green-500" : isSoft ? "text-amber-500" : "text-red-500"

                  const badgeCls = isHealthy
                    ? "bg-green-500/10 text-green-600 dark:text-green-400 ring-1 ring-green-500/20"
                    : isSoft
                    ? "bg-amber-400/15 text-amber-700 dark:text-amber-400 ring-1 ring-amber-400/30"
                    : "bg-red-500/15 text-red-700 dark:text-red-400 ring-1 ring-red-500/30"
                  const badgeLabel = isHealthy ? "Healthy" : isSoft ? "Soft Drift" : "Hard Drift"

                  const standard = MONTHLY_ALLOC[p.ticker] ?? 0
                  const amountStr = p.suggestedAmount === 0 ? "$0" : `$${p.suggestedAmount.toLocaleString()}`
                  const amountCls = p.allocationTag === "zeroed"
                    ? "text-muted-foreground/60 line-through"
                    : p.allocationTag === "boosted"
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-foreground"
                  const amountSub = p.allocationTag === "zeroed"
                    ? "paused"
                    : p.allocationTag === "boosted"
                    ? `↑ from $${standard.toLocaleString()}`
                    : "standard"

                  return (
                    <div key={p.ticker} className={`flex items-start gap-4 px-5 py-4 transition-colors ${rowCls}`}>
                      {/* Pulsing status icon */}
                      <div className={`shrink-0 mt-0.5 ${iconWrapCls}`}>
                        <StatusIcon className={`h-4 w-4 ${iconCls}`} />
                      </div>

                      {/* Ticker + instruction */}
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1.5">
                          <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                          <span className={`text-sm font-extrabold tracking-tight ${isHard ? "text-red-700 dark:text-red-400" : isSoft ? "text-amber-700 dark:text-amber-400" : ""}`}>{p.ticker}</span>
                          <span className="text-xs text-muted-foreground hidden sm:inline">{p.name}</span>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${badgeCls}`}>{badgeLabel}</span>
                        </div>
                        <p className={`text-xs leading-relaxed ${isHard || isSoft ? "text-foreground/70" : "text-muted-foreground"}`}>{p.instruction}</p>
                      </div>

                      {/* Weight / suggested allocation */}
                      <div className="shrink-0 text-right min-w-[5.5rem]">
                        <p className="text-xs tabular-nums">
                          <span className={`font-bold ${isHard ? "text-red-600 dark:text-red-400" : isSoft ? "text-amber-600 dark:text-amber-400" : ""}`}>{formatPercent(p.actualPct, 1, false)}</span>
                          <span className="text-muted-foreground font-normal"> / {formatPercent(p.targetPct, 1, false)}</span>
                        </p>
                        <p className={`mt-1 text-sm font-black tabular-nums ${amountCls}`}>{amountStr}</p>
                        <p className="text-[10px] text-muted-foreground">{amountSub}</p>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Allocation plan summary */}
              <div className={`px-5 py-4 border-t ${hasAnyAlert
                ? "border-amber-400/40 bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-500/[0.07] dark:to-orange-500/[0.05] dark:border-amber-500/20"
                : "border-border bg-accent/30 dark:bg-muted/30"
              }`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-bold mb-3 uppercase tracking-wide ${hasAnyAlert ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>
                      {hasAnyAlert ? "⚡ Drift-Adjusted — Next Month" : "Standard Allocation — Next Month"}
                    </p>
                    <div className="flex flex-wrap gap-x-5 gap-y-2">
                      {allocOrder.map(ticker => {
                        const amount = suggested[ticker] ?? 0
                        const standard = MONTHLY_ALLOC[ticker] ?? 0
                        const isZeroed = amount === 0
                        const isBoosted = amount > standard
                        return (
                          <div key={ticker} className="flex flex-col items-start">
                            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-0.5">{ticker}</span>
                            <span className={`text-base font-black tabular-nums ${
                              isZeroed ? "text-muted-foreground/50 line-through" :
                              isBoosted ? "text-amber-600 dark:text-amber-400" :
                              "text-foreground"
                            }`}>
                              ${amount.toLocaleString()}
                            </span>
                            {isBoosted && <span className="text-[9px] text-amber-600 dark:text-amber-500 font-semibold">↑ boosted</span>}
                            {isZeroed && <span className="text-[9px] text-muted-foreground font-semibold">paused</span>}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                  <div className="shrink-0 text-right pl-4 border-l border-border/50">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Deploy</p>
                    <p className="text-xl font-black tabular-nums">{formatCurrency(TOTAL_MONTHLY, "USD")}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">this month</p>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* System overview */}
      <div className="mt-6">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">System Overview</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sections.map(({ title, desc, href, status }) => (
            <a key={href} href={href} className="group rounded-xl border border-border bg-card p-4 transition-colors hover:border-foreground/20 hover:bg-accent/40">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold">{title}</h3>
                <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium bg-green-500/10 text-green-500">{status}</span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground leading-relaxed">{desc}</p>
            </a>
          ))}
        </div>
      </div>
    </Shell>
  )
}
