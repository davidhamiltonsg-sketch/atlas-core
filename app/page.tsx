import { Shell } from "@/components/shell"
import { TrendingUp, ShieldCheck, AlertTriangle, Activity, CheckCircle2, XCircle, Zap } from "lucide-react"
import { db } from "@/lib/db"
import { formatCurrency, formatPercent } from "@/lib/utils"
import { getSession } from "@/lib/session"
import { redirect } from "next/navigation"
import { AllocationDonut } from "@/components/charts/allocation-donut"
import { HealthGauge } from "@/components/charts/health-gauge"
import { PortfolioHistoryChart } from "@/components/charts/portfolio-history-chart"
import { computePortfolioHealth } from "@/lib/health"

const MONTHLY_CONTRIBUTION = 3000
const ANNUAL_LUMP_SUM = 20000
const CONTRIBUTION_GROWTH_RATE = 0.05

function projectPortfolio(
  currentValue: number,
  monthlyContribution: number,
  annualLumpSum: number,
  annualRate: number,
  years: number,
  contributionGrowthRate: number
): number {
  let value = currentValue
  const monthlyRate = annualRate / 12
  for (let year = 0; year < years; year++) {
    const contribution = monthlyContribution * Math.pow(1 + contributionGrowthRate, year)
    for (let month = 0; month < 12; month++) {
      value = value * (1 + monthlyRate) + contribution
    }
    if (year > 0) value += annualLumpSum
  }
  return value
}

// v5.2 hard drift thresholds
const HARD_THRESHOLDS: Record<string, { low?: number; high: number }> = {
  VT:   { low: 40, high: 62 },
  QQQM: { low: 16, high: 31 },
  SMH:  { high: 15 },
  VWO:  { low: 4,  high: 12 },
  BTC:  { high: 8  },
}

const MONTHLY_ALLOC: Record<string, number> = {
  VT: 1560, QQQM: 690, SMH: 300, VWO: 240, BTC: 210,
}
const TOTAL_MONTHLY = 3000

type ActionStatus = "healthy" | "soft" | "hard"

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
  const rounded = active.map(p => ({
    ticker: p.ticker,
    amount: Math.round(((p.targetPct / activeTotalTarget) * TOTAL_MONTHLY) / 10) * 10,
  }))
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
    include: { snapshots: { orderBy: { date: "desc" }, take: 8 } },
  })

  // Build portfolio value history (index 0 = latest, align across holdings)
  const historyPoints: Array<{ label: string; value: number }> = []
  const maxSnaps = Math.max(...holdings.map(h => h.snapshots.length))
  for (let i = maxSnaps - 1; i >= 0; i--) {
    const total = holdings.reduce((sum, h) => sum + (h.snapshots[i]?.value ?? 0), 0)
    const date = holdings.find(h => h.snapshots[i])?.snapshots[i]?.date
    if (date && total > 0) {
      historyPoints.push({
        label: new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
        value: total,
      })
    }
  }

  const totalValue = holdings.reduce((sum, h) => sum + (h.snapshots[0]?.value ?? 0), 0)
  const prevTotalValue = historyPoints.length >= 2 ? historyPoints[historyPoints.length - 2].value : null
  const valueChange = prevTotalValue !== null ? totalValue - prevTotalValue : null

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
        ? `${h.ticker} is too small — it's at ${actualPct.toFixed(1)}% but should be ${h.targetPct}%. Put all of this month's investment money into ${h.ticker} until it's back on track.`
        : `${h.ticker} has grown too large — it's at ${actualPct.toFixed(1)}% but should be ${h.targetPct}%. Stop buying ${h.ticker} immediately. You may need to sell a small amount at your next opportunity.`
    } else if (isSoftDrift) {
      status = "soft"
      instruction = driftPct < 0
        ? `${h.ticker} is a little small at ${actualPct.toFixed(1)}% (target: ${h.targetPct}%). Boost it by adding extra contributions for the next 2–3 months.`
        : `${h.ticker} has grown slightly above its ${h.targetPct}% target to ${actualPct.toFixed(1)}%. Skip buying it this month — put that money into smaller positions instead.`
    } else {
      status = "healthy"
      instruction = `${h.ticker} is right on track at ${actualPct.toFixed(1)}% (target: ${h.targetPct}%). Keep investing your normal amount each month.`
    }

    return { ticker: h.ticker, name: h.name, color: h.color, value, actualPct, targetPct: h.targetPct, driftPct, status, instruction }
  })

  const suggested = calculateSuggestedAllocations(positions)
  const hasAnyAlert = positions.some(p => p.status !== "healthy")

  // Project portfolio state AFTER deploying the suggested monthly allocation
  const newTotalValue = totalValue + TOTAL_MONTHLY

  const positionsWithAlloc = positions.map(p => {
    const amount = suggested[p.ticker] ?? 0
    const standard = MONTHLY_ALLOC[p.ticker] ?? 0
    const tag: "standard" | "boosted" | "zeroed" =
      amount === 0 ? "zeroed" : amount > standard ? "boosted" : "standard"

    const projectedValue = p.value + amount
    const projectedPct   = newTotalValue > 0 ? (projectedValue / newTotalValue) * 100 : 0
    const driftBefore    = Math.abs(p.driftPct)
    const driftAfter     = Math.abs(projectedPct - p.targetPct)
    const driftImprovement = driftBefore - driftAfter   // positive = getting closer to target

    return { ...p, suggestedAmount: amount, allocationTag: tag, projectedPct, driftImprovement }
  })

  const order: Record<ActionStatus, number> = { hard: 0, soft: 1, healthy: 2 }
  positionsWithAlloc.sort((a, b) => order[a.status] - order[b.status])

  const driftAlerts   = positions.filter(p => p.status !== "healthy").length
  const maxDrift      = positions.reduce((max, p) => Math.max(max, Math.abs(p.driftPct)), 0)

  // Stale data detection (must be before health score)
  const latestSnapshotDate = holdings.reduce<Date | null>((latest, h) => {
    const d = h.snapshots[0]?.date
    if (!d) return latest
    return latest === null || d > latest ? d : latest
  }, null)
  const daysSinceUpdate = latestSnapshotDate
    ? Math.floor((Date.now() - new Date(latestSnapshotDate).getTime()) / 86_400_000)
    : null

  const [activeRules, totalRules] = await Promise.all([
    db.governanceRule.count({ where: { active: true } }),
    db.governanceRule.count(),
  ])
  const hardBreaches  = positions.filter(p => p.status === "hard").length
  const softBreaches  = positions.filter(p => p.status === "soft").length
  const snapshotAgeDays = daysSinceUpdate ?? 999
  const health = computePortfolioHealth({ hardBreaches, softBreaches, maxDrift, activeRules, totalRules, snapshotAgeDays })
  const healthScore = health.overall
  const healthLabel = health.overallLabel

  // 2045 forecast (base case 10%, 19 years remaining from 2026)
  const yearsTo2045 = Math.max(1, 2045 - new Date().getFullYear())
  const base2045 = projectPortfolio(totalValue, MONTHLY_CONTRIBUTION, ANNUAL_LUMP_SUM, 0.10, yearsTo2045, CONTRIBUTION_GROWTH_RATE)

  // Next contribution countdown (15th of each month)
  const now = new Date()
  const day15ThisMonth = new Date(now.getFullYear(), now.getMonth(), 15)
  const nextContribution = now < day15ThisMonth
    ? day15ThisMonth
    : new Date(now.getFullYear(), now.getMonth() + 1, 15)
  const daysToContribution = Math.ceil((nextContribution.getTime() - now.getTime()) / 86_400_000)
  const nextContributionLabel = nextContribution.toLocaleDateString("en-GB", { day: "numeric", month: "short" })

  const donutData = holdings.map((h) => {
    const value = h.snapshots[0]?.value ?? 0
    const actualPct = totalValue > 0 ? (value / totalValue) * 100 : 0
    return { ticker: h.ticker, name: h.name, actualPct, targetPct: h.targetPct, color: h.color, value }
  }).sort((a, b) => b.actualPct - a.actualPct)

  return { totalValue, newTotalValue, positions: positionsWithAlloc, driftAlerts, activeRules, healthScore, healthLabel, health, hasAnyAlert, suggested, hardBreaches, softBreaches, donutData, daysSinceUpdate, latestSnapshotDate: latestSnapshotDate?.toISOString() ?? null, base2045, yearsTo2045, daysToContribution, nextContributionLabel, historyPoints, valueChange }
}

const sections = [
  { title: "Portfolio Architecture", desc: "Holdings, target allocations, and hard caps.", href: "/portfolio" },
  { title: "Governance Engine",      desc: "Rules, drift thresholds, and contribution routing logic.", href: "/governance" },
  { title: "Behavioural System",     desc: "Maintain discipline. Log emotions. Resist over-optimisation.", href: "/behaviour" },
  { title: "Reports",                desc: "Overlap and concentration engine — look-through exposure.", href: "/reports" },
  { title: "Forecast Engine",        desc: "Compounding trajectories to the 2045 horizon.", href: "/forecast" },
]

export default async function Dashboard() {
  const session = await getSession()
  if (!session) redirect("/login")
  const {
    totalValue, newTotalValue, positions, driftAlerts, activeRules, healthScore, healthLabel, health,
    hasAnyAlert, suggested, hardBreaches, softBreaches, donutData, daysSinceUpdate, latestSnapshotDate,
    base2045, yearsTo2045, daysToContribution, nextContributionLabel, historyPoints, valueChange,
  } = await getDashboardData(session.userId)

  const allocOrder = ["VT", "QQQM", "SMH", "VWO", "BTC"]

  return (
    <Shell title="Dashboard" subtitle="Your investment operating system" userName={session.name}>

      {/* Hard breach banner */}
      {hardBreaches > 0 && (
        <a href="#execution" className="mb-5 flex items-center gap-4 rounded-xl border-2 border-red-500/50 bg-red-500/10 dark:bg-red-500/[0.12] px-5 py-4 glow-red flash-red cursor-pointer hover:bg-red-500/[0.16] transition-colors group">
          <div className="shrink-0 flex h-10 w-10 items-center justify-center rounded-full bg-red-500/20 pulse-red">
            <XCircle className="h-5 w-5 text-red-500" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-extrabold text-red-600 dark:text-red-400 uppercase tracking-wide">
              Hard Drift Alert — {hardBreaches} position{hardBreaches > 1 ? "s" : ""} breached
            </p>
            <p className="text-xs text-red-600/80 dark:text-red-400/80 mt-0.5">
              Hard thresholds exceeded. Review next execution instructions below and take action at your next dealing window.
            </p>
          </div>
          <span className="shrink-0 text-xs font-semibold text-red-500/70 group-hover:text-red-500 transition-colors">View steps ↓</span>
        </a>
      )}

      {/* Soft drift banner */}
      {softBreaches > 0 && hardBreaches === 0 && (
        <a href="#execution" className="mb-5 flex items-center gap-4 rounded-xl border border-amber-400/40 bg-amber-400/10 dark:bg-amber-400/[0.08] px-5 py-3.5 glow-amber cursor-pointer hover:bg-amber-400/[0.14] transition-colors group">
          <div className="shrink-0 flex h-9 w-9 items-center justify-center rounded-full bg-amber-500/20 pulse-amber">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-amber-700 dark:text-amber-400">
              Soft Drift — {softBreaches} position{softBreaches > 1 ? "s" : ""} outside tolerance
            </p>
            <p className="text-xs text-amber-700/80 dark:text-amber-400/80 mt-0.5">
              Redirect next month's contributions according to the allocation plan below.
            </p>
          </div>
          <span className="shrink-0 text-xs font-semibold text-amber-500/70 group-hover:text-amber-500 transition-colors">View steps ↓</span>
        </a>
      )}

      {/* Stale data warning */}
      {daysSinceUpdate !== null && daysSinceUpdate >= 3 && (
        <a href="/portfolio" className={`mb-5 flex items-center gap-3 rounded-xl border px-5 py-3 transition-colors group ${
          daysSinceUpdate >= 7
            ? "border-red-500/30 bg-red-500/[0.07] hover:bg-red-500/[0.11]"
            : "border-amber-400/30 bg-amber-400/[0.07] hover:bg-amber-400/[0.11]"
        }`}>
          <Activity className={`h-4 w-4 shrink-0 ${daysSinceUpdate >= 7 ? "text-red-500" : "text-amber-500"}`} />
          <p className={`text-xs flex-1 ${daysSinceUpdate >= 7 ? "text-red-600 dark:text-red-400" : "text-amber-700 dark:text-amber-400"}`}>
            <span className="font-bold">Prices last updated {daysSinceUpdate} day{daysSinceUpdate !== 1 ? "s" : ""} ago</span>
            {" — "}
            {latestSnapshotDate ? new Date(latestSnapshotDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : ""}
            {daysSinceUpdate >= 7 ? ". Portfolio values may be significantly out of date." : ". Consider updating your prices."}
          </p>
          <span className={`shrink-0 text-xs font-semibold transition-colors ${daysSinceUpdate >= 7 ? "text-red-500/70 group-hover:text-red-500" : "text-amber-500/70 group-hover:text-amber-500"}`}>
            Update now →
          </span>
        </a>
      )}

      {/* Main layout: left = content, right = health + donut */}
      <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
        <div className="space-y-5 min-w-0">

          {/* KPI strip */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-border bg-card p-4 card-elevated flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Portfolio Value</span>
                <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <p className="text-2xl font-black tabular-nums">{formatCurrency(totalValue, "SGD")}</p>
              <p className="text-[11px] text-muted-foreground">SGD · IBKR</p>
            </div>

            <div className="rounded-xl border border-border bg-card p-4 card-elevated flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Active Rules</span>
                <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <p className="text-2xl font-black tabular-nums">{activeRules}</p>
              <p className="text-[11px] text-muted-foreground">Governance rules enforced</p>
            </div>

            <div className={`rounded-xl border bg-card p-4 card-elevated flex flex-col gap-2 ${driftAlerts > 0 ? "border-amber-400/40" : "border-border"}`}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Drift Alerts</span>
                <AlertTriangle className={`h-3.5 w-3.5 ${driftAlerts > 0 ? "text-amber-500" : "text-muted-foreground"}`} />
              </div>
              <p className={`text-2xl font-black tabular-nums ${driftAlerts > 0 ? (hardBreaches > 0 ? "text-red-500" : "text-amber-500") : "text-green-500"}`}>
                {driftAlerts}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {driftAlerts === 0 ? "All within tolerance" : `${driftAlerts} position${driftAlerts > 1 ? "s" : ""} outside band`}
              </p>
            </div>
          </div>

          {/* Holdings Summary Table */}
          <div>
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Your Holdings</h2>
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="hidden sm:grid grid-cols-[32px_1fr_90px_70px_70px_70px] gap-2 px-4 py-2 bg-muted/30 border-b border-border">
                {["", "Name", "Value", "Actual", "Target", "Status"].map((h, i) => (
                  <span key={i} className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</span>
                ))}
              </div>
              <div className="divide-y divide-border">
                {positions.map((p) => {
                  const badgeCls = p.status === "healthy"
                    ? "bg-green-500/10 text-green-600 dark:text-green-400 ring-1 ring-green-500/20"
                    : p.status === "soft"
                    ? "bg-amber-400/15 text-amber-700 dark:text-amber-400 ring-1 ring-amber-400/30"
                    : "bg-red-500/15 text-red-700 dark:text-red-400 ring-1 ring-red-500/30"
                  const badgeLabel = p.status === "healthy" ? "On track" : p.status === "soft" ? "Watch" : "Act now"
                  const rowCls = p.status === "hard"
                    ? "border-l-4 border-red-500"
                    : p.status === "soft"
                    ? "border-l-[3px] border-amber-400"
                    : "border-l-4 border-transparent"
                  return (
                    <a key={p.ticker} href={`/portfolio#holding-${p.ticker}`}
                      className={`grid grid-cols-[32px_1fr] sm:grid-cols-[32px_1fr_90px_70px_70px_70px] items-center gap-x-2 gap-y-0.5 px-4 py-2.5 hover:bg-accent/30 transition-colors ${rowCls}`}>
                      <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: p.color, boxShadow: `0 0 6px ${p.color}80` }} />
                      <div className="min-w-0">
                        <span className="text-xs font-bold">{p.ticker}</span>
                        <span className="text-xs text-muted-foreground ml-2 truncate hidden sm:inline">{p.name}</span>
                      </div>
                      <span className="text-xs font-semibold hidden sm:block">{formatCurrency(p.value, "SGD")}</span>
                      <span className="text-xs tabular-nums font-semibold hidden sm:block">{p.actualPct.toFixed(1)}%</span>
                      <span className="text-xs tabular-nums text-muted-foreground hidden sm:block">{p.targetPct}%</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold w-fit hidden sm:block ${badgeCls}`}>{badgeLabel}</span>
                      {/* Mobile right side */}
                      <div className="col-span-1 flex items-center justify-end gap-2 sm:hidden">
                        <span className="text-xs font-semibold">{p.actualPct.toFixed(1)}%</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${badgeCls}`}>{badgeLabel}</span>
                      </div>
                    </a>
                  )
                })}
              </div>
              <div className="px-4 py-2.5 border-t border-border bg-muted/20 flex items-center justify-between text-xs text-muted-foreground">
                <span>{positions.length} positions · {formatCurrency(totalValue, "SGD")} total</span>
                <a href="/portfolio" className="font-semibold text-primary hover:underline">Manage holdings →</a>
              </div>
            </div>
          </div>

          {/* Next Execution Instructions */}
          <div id="execution">
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">
              What To Do This Month
            </h2>
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              {positions.length === 0 ? (
                <div className="px-5 py-8 text-center text-xs text-muted-foreground">
                  No holdings found. Seed the database to generate instructions.
                </div>
              ) : (
                <>
                  <div className="divide-y divide-border">
                    {positions.map((p) => {
                      const isHard    = p.status === "hard"
                      const isSoft    = p.status === "soft"
                      const isHealthy = p.status === "healthy"

                      const StatusIcon = isHealthy ? CheckCircle2 : isSoft ? AlertTriangle : XCircle
                      const iconWrapCls = isHard ? "pulse-red" : isSoft ? "pulse-amber" : ""
                      const iconCls     = isHealthy ? "text-green-500" : isSoft ? "text-amber-500" : "text-red-500"

                      const rowCls = isHard
                        ? "border-l-[4px] border-red-500 bg-red-500/[0.035] dark:bg-red-500/[0.06]"
                        : isSoft
                        ? "border-l-[3px] border-amber-400 bg-amber-500/[0.03] dark:bg-amber-500/[0.04]"
                        : "border-l-4 border-transparent"

                      const badgeCls = isHealthy
                        ? "bg-green-500/10 text-green-600 dark:text-green-400 ring-1 ring-green-500/20"
                        : isSoft
                        ? "bg-amber-400/15 text-amber-700 dark:text-amber-400 ring-1 ring-amber-400/30"
                        : "bg-red-500/15 text-red-700 dark:text-red-400 ring-1 ring-red-500/30"

                      const badgeLabel = isHealthy ? "Healthy" : isSoft ? "Soft Drift" : "Hard Drift"
                      const badgeTip = isHealthy
                        ? `${p.ticker} is within its target range of ${p.targetPct}% (±${p.driftPct > 0 ? p.driftPct.toFixed(1) : Math.abs(p.driftPct).toFixed(1)}%). No action needed.`
                        : isSoft
                        ? `${p.ticker} has drifted ${Math.abs(p.driftPct).toFixed(1)}% ${p.driftPct > 0 ? "above" : "below"} its ${p.targetPct}% target — outside the tolerance band. Redirect contributions over the next 2–3 months to correct this.`
                        : `${p.ticker} has drifted ${Math.abs(p.driftPct).toFixed(1)}% ${p.driftPct > 0 ? "above" : "below"} its ${p.targetPct}% target — a hard breach. Immediate rebalancing action is required at your next dealing window.`
                      const standard   = MONTHLY_ALLOC[p.ticker] ?? 0
                      const amountStr  = p.suggestedAmount === 0 ? "$0" : `$${p.suggestedAmount.toLocaleString()}`
                      const amountCls  = p.allocationTag === "zeroed"
                        ? "text-muted-foreground/60 line-through"
                        : p.allocationTag === "boosted"
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-foreground"
                      const amountSub  = p.allocationTag === "zeroed"
                        ? "paused"
                        : p.allocationTag === "boosted"
                        ? `↑ from $${standard.toLocaleString()}`
                        : "standard"

                      const isAlert = isHard || isSoft

                      // Impact mini-bar: show before/after allocation visually
                      const targetBarW   = Math.min(100, (p.targetPct / 70) * 100)
                      const currentBarW  = Math.min(100, (p.actualPct / 70) * 100)
                      const projBarW     = Math.min(100, (p.projectedPct / 70) * 100)
                      const impvSign     = p.driftImprovement > 0.05 ? "+" : p.driftImprovement < -0.05 ? "−" : "≈"
                      const impvCls      = p.driftImprovement > 0.05 ? "text-green-500" : p.driftImprovement < -0.05 ? "text-red-500" : "text-muted-foreground"

                      const rowContent = (
                        <>
                          <div className={`shrink-0 mt-0.5 ${iconWrapCls}`}>
                            <StatusIcon className={`h-4 w-4 ${iconCls}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1.5">
                              <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: p.color, boxShadow: `0 0 6px ${p.color}80` }} />
                              <span className={`text-sm font-extrabold tracking-tight ${isHard ? "text-red-700 dark:text-red-400" : isSoft ? "text-amber-700 dark:text-amber-400" : ""}`}>
                                {p.ticker}
                              </span>
                              <span className="text-xs text-muted-foreground hidden sm:inline">{p.name}</span>
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold cursor-help ${badgeCls}`} title={badgeTip}>{badgeLabel}</span>
                            </div>
                            <p className={`text-xs leading-relaxed mb-2.5 ${isHard || isSoft ? "text-foreground/70" : "text-muted-foreground"}`}>
                              {p.instruction}
                            </p>

                            {/* Impact bar — before vs projected vs target */}
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
                                {impvSign}{Math.abs(p.driftImprovement).toFixed(1)}% drift
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
                        <a key={p.ticker} href={`/portfolio#holding-${p.ticker}`} className={`flex items-start gap-4 px-5 py-4 transition-colors ${rowCls} cursor-pointer hover:brightness-[1.04] group`}>
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
                            const amount   = suggested[ticker] ?? 0
                            const standard = MONTHLY_ALLOC[ticker] ?? 0
                            const isZeroed  = amount === 0
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
                                {isZeroed  && <span className="text-[9px] text-muted-foreground font-semibold">paused</span>}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                      <div className="shrink-0 text-right pl-4 border-l border-border/50">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Deploy</p>
                        <p className="text-xl font-black tabular-nums">{formatCurrency(TOTAL_MONTHLY, "SGD")}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">this month</p>
                      </div>
                    </div>

                    {/* Bottom row — portfolio impact summary */}
                    <div className="px-5 pb-4 pt-3 border-t border-border/40 flex flex-wrap items-center gap-x-6 gap-y-2">
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">Portfolio after</p>
                        <p className="text-sm font-black tabular-nums">{formatCurrency(newTotalValue, "SGD")}</p>
                      </div>
                      <div className="h-8 w-px bg-border/50 hidden sm:block" />
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">Positions improving</p>
                        <p className="text-sm font-black tabular-nums text-green-500">
                          {positions.filter(p => p.driftImprovement > 0.05).length} / {positions.length}
                        </p>
                      </div>
                      <div className="h-8 w-px bg-border/50 hidden sm:block" />
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">Avg drift improvement</p>
                        <p className="text-sm font-black tabular-nums text-green-500">
                          {(() => {
                            const improving = positions.filter(p => p.suggestedAmount > 0)
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
                </>
              )}
            </div>
          </div>

          {/* System overview */}
          <div>
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">System Overview</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {sections.map(({ title, desc, href }) => (
                <a
                  key={href}
                  href={href}
                  className="group rounded-xl border border-border bg-card p-4 transition-all hover:border-primary/30 hover:bg-accent/40 hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-semibold group-hover:text-primary transition-colors">{title}</h3>
                    <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-green-500/10 text-green-600 dark:text-green-400 ring-1 ring-green-500/20">Active</span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground leading-relaxed">{desc}</p>
                </a>
              ))}
            </div>
          </div>
        </div>

        {/* Right sidebar — health + allocation */}
        <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">

          {/* Health gauge */}
          <div className="rounded-xl border border-border bg-card p-5 card-elevated">
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">Portfolio Health</h2>
            <div className="flex justify-center">
              <HealthGauge score={healthScore} label={healthLabel} />
            </div>
            <div className="mt-4 pt-4 border-t border-border space-y-3">
              {[health.structural, health.behavioural, health.concentration, health.execution].map((dim) => {
                const barColor =
                  dim.status === "excellent" ? "bg-green-500" :
                  dim.status === "good"      ? "bg-emerald-400" :
                  dim.status === "caution"   ? "bg-amber-400" :
                                               "bg-red-500"
                const textColor =
                  dim.status === "excellent" ? "text-green-500" :
                  dim.status === "good"      ? "text-emerald-400" :
                  dim.status === "caution"   ? "text-amber-400" :
                                               "text-red-500"
                return (
                  <div key={dim.label}>
                    <div className="flex items-center justify-between mb-1">
                      <div>
                        <span className="text-[11px] font-semibold">{dim.label}</span>
                        <span className="text-[10px] text-muted-foreground ml-1.5">{dim.description}</span>
                      </div>
                      <span className={`text-[11px] font-bold tabular-nums ${textColor}`}>{dim.score}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${dim.score}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Portfolio value history */}
          {historyPoints.length >= 2 && (
            <div className="rounded-xl border border-border bg-card p-4 card-elevated">
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Value History</h2>
                {valueChange !== null && (
                  <span className={`text-[11px] font-bold tabular-nums ${valueChange >= 0 ? "text-green-500" : "text-red-500"}`}>
                    {valueChange >= 0 ? "+" : ""}{formatCurrency(valueChange, "SGD")}
                  </span>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground mb-2">{historyPoints.length} snapshots</p>
              <PortfolioHistoryChart data={historyPoints} />
            </div>
          )}

          {/* 2045 Goal + Contribution countdown */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-border bg-card p-4 card-elevated">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">2045 Base Case</p>
              <p className="text-lg font-black tabular-nums gradient-text leading-tight">
                {base2045 >= 1_000_000
                  ? `$${(base2045 / 1_000_000).toFixed(1)}M`
                  : `$${(base2045 / 1_000).toFixed(0)}K`}
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">10% p.a. · {yearsTo2045} yr</p>
              <div className="mt-2 h-1 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary/60"
                  style={{ width: `${Math.min(100, (totalValue / base2045) * 100)}%` }}
                />
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">{((totalValue / base2045) * 100).toFixed(1)}% of goal</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4 card-elevated">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Next Contribution</p>
              <p className="text-lg font-black tabular-nums leading-tight">
                {daysToContribution === 0 ? "Today" : `${daysToContribution}d`}
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">{nextContributionLabel} · $3,000</p>
              <div className="mt-2 h-1 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary/60"
                  style={{ width: `${Math.max(5, 100 - (daysToContribution / 31) * 100)}%` }}
                />
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">monthly schedule</p>
            </div>
          </div>

          {/* Allocation donut */}
          <div className="rounded-xl border border-border bg-card p-5 card-elevated">
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-1">Allocation</h2>
            <p className="text-[11px] text-muted-foreground mb-3">Outer = actual · Inner = target</p>
            <AllocationDonut
              data={donutData}
              totalValue={totalValue}
            />
          </div>
        </div>
      </div>
    </Shell>
  )
}
