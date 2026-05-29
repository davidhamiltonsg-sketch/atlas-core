import { Shell } from "@/components/shell"
import { TrendingUp, ShieldCheck, AlertTriangle, Activity, XCircle } from "lucide-react"
import { db } from "@/lib/db"
import { formatCurrency } from "@/lib/utils"
import { getSession } from "@/lib/session"
import { redirect } from "next/navigation"
import { AllocationDonut } from "@/components/charts/allocation-donut"
import { HealthGauge } from "@/components/charts/health-gauge"
import { PortfolioHistoryChart } from "@/components/charts/portfolio-history-chart"
import { computePortfolioHealth } from "@/lib/health"
import { ExecutionPlan } from "@/components/dashboard/execution-plan"
import { HealthMethodology } from "@/components/health-methodology"

// Fallback defaults (overridden by user DB settings)
const DEFAULT_MONTHLY = 3000
const DEFAULT_ANNUAL_LUMP_SUM = 20000
const DEFAULT_GROWTH_RATE = 0.05

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

// v5.8 hard drift thresholds (Section 3.1)
const HARD_THRESHOLDS: Record<string, { low?: number; high: number }> = {
  VT:   { low: 42, high: 62 },
  QQQM: { low: 15, high: 31 },
  SMH:  { low: 5,  high: 15 },
  VWO:  { low: 3,  high: 13 },
  BTC:  { high: 8  },
}

type ActionStatus = "healthy" | "soft" | "hard"

async function getUsdSgdRate(): Promise<number> {
  try {
    const res = await fetch(
      "https://query1.finance.yahoo.com/v8/finance/chart/USDSGD=X?interval=1d&range=1d",
      { headers: { "User-Agent": "Mozilla/5.0" }, next: { revalidate: 3600 } }
    )
    if (res.ok) {
      const d = await res.json()
      const rate = d?.chart?.result?.[0]?.meta?.regularMarketPrice
      if (rate && rate > 0) return rate
    }
  } catch {}
  return 1.35
}

async function getDashboardData(userId: string) {
  const [user, holdings, usdSgdRate] = await Promise.all([
    db.user.findUnique({ where: { id: userId } }),
    db.holding.findMany({
      where: { userId },
      include: { snapshots: { orderBy: { date: "desc" }, take: 8 } },
    }),
    getUsdSgdRate(),
  ])

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
  const hasBalance = totalValue > 0
  const prevTotalValue = historyPoints.length >= 2 ? historyPoints[historyPoints.length - 2].value : null
  const valueChange = prevTotalValue !== null ? totalValue - prevTotalValue : null

  const positions = holdings.map((h) => {
    const value = h.snapshots[0]?.value ?? 0
    const actualPct = totalValue > 0 ? (value / totalValue) * 100 : 0
    const driftPct = actualPct - h.targetPct
    const absDrift = Math.abs(driftPct)
    const overCap = h.hardCapPct !== null && actualPct > h.hardCapPct

    const ht = HARD_THRESHOLDS[h.ticker]
    // When portfolio has no balance yet, suppress all drift alerts
    const isHardDrift = totalValue > 0 && (overCap ||
      (ht?.low !== undefined && actualPct < ht.low) ||
      (ht !== undefined && actualPct > ht.high))
    const isSoftDrift = totalValue > 0 && !isHardDrift && absDrift > h.toleranceBand

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

  const hasAnyAlert = positions.some(p => p.status !== "healthy")

  // Sort by severity for display
  const order: Record<ActionStatus, number> = { hard: 0, soft: 1, healthy: 2 }
  positions.sort((a, b) => order[a.status] - order[b.status])

  const driftAlerts   = positions.filter(p => p.status !== "healthy").length
  // Suppress maxDrift for zero-balance portfolios (all positions technically at -100% drift)
  const maxDrift      = hasBalance ? positions.reduce((max, p) => Math.max(max, Math.abs(p.driftPct)), 0) : 0

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

  const monthlyContribution = user?.monthlyContribution ?? DEFAULT_MONTHLY
  const annualLumpSum = user?.annualLumpSum ?? DEFAULT_ANNUAL_LUMP_SUM
  const contributionGrowthRate = user?.contributionGrowthRate ?? DEFAULT_GROWTH_RATE

  // 2045 forecast (base case 10%, 19 years remaining from 2026)
  const yearsTo2045 = Math.max(1, 2045 - new Date().getFullYear())
  const base2045 = projectPortfolio(totalValue, monthlyContribution, annualLumpSum, 0.10, yearsTo2045, contributionGrowthRate)

  // Goal tracking: where should the portfolio be right now if on the base-case trajectory?
  // Start from portfolio value at start of this year, project to today
  const startOfYear = new Date(new Date().getFullYear(), 0, 1)
  const dayOfYear = Math.floor((Date.now() - startOfYear.getTime()) / 86_400_000)
  const fractionOfYear = dayOfYear / 365
  // Approximate "on-track" value: extrapolate linearly within the current year
  const yearsElapsed = 2045 - new Date().getFullYear() - yearsTo2045 // 0 for current year
  const targetNow = totalValue > 0
    ? projectPortfolio(totalValue, monthlyContribution, annualLumpSum, 0.10, Math.floor(fractionOfYear * 12) / 12, contributionGrowthRate)
    : null
  const onTrackPct = targetNow && targetNow > 0 ? (totalValue / targetNow) * 100 : null

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

  return { totalValue, hasBalance, positions, driftAlerts, maxDrift, activeRules, totalRules, snapshotAgeDays, healthScore, healthLabel, health, hasAnyAlert, hardBreaches, softBreaches, donutData, daysSinceUpdate, latestSnapshotDate: latestSnapshotDate?.toISOString() ?? null, base2045, yearsTo2045, daysToContribution, nextContributionLabel, historyPoints, valueChange, monthlyContribution, annualLumpSum, contributionGrowthRate, usdSgdRate, onTrackPct }
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
    totalValue, hasBalance, positions, driftAlerts, maxDrift, activeRules, totalRules, snapshotAgeDays,
    healthScore, healthLabel, health, hasAnyAlert, hardBreaches, softBreaches, donutData,
    daysSinceUpdate, latestSnapshotDate, base2045, yearsTo2045, daysToContribution,
    nextContributionLabel, historyPoints, valueChange, monthlyContribution, annualLumpSum,
    contributionGrowthRate, usdSgdRate, onTrackPct,
  } = await getDashboardData(session.userId)

  // Derive ticker order by target % descending (largest allocation first in footer summary)
  const allocOrder = [...positions].sort((a, b) => b.targetPct - a.targetPct).map(p => p.ticker)

  return (
    <Shell title="Dashboard" subtitle="Your investment operating system" userName={session.name} isAdmin={session.role === "admin"}>

      {/* New user welcome — no balance yet */}
      {!hasBalance && (
        <div className="mb-5 flex items-center gap-4 rounded-xl border border-primary/30 bg-primary/[0.06] px-5 py-4">
          <div className="shrink-0 flex h-10 w-10 items-center justify-center rounded-full bg-primary/15">
            <TrendingUp className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-primary">Portfolio configured — ready for your first snapshot</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Target allocations are set. Head to <a href="/portfolio" className="underline font-semibold">Portfolio</a> and enter your holdings to start tracking drift and health.
            </p>
          </div>
        </div>
      )}

      {/* Hard breach banner */}
      {hasBalance && hardBreaches > 0 && (
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
      {hasBalance && softBreaches > 0 && hardBreaches === 0 && (
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

      {/* Stale data warning — only when portfolio has balance */}
      {hasBalance && daysSinceUpdate !== null && daysSinceUpdate >= 3 && (
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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-border bg-card p-4 card-elevated flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Portfolio Value</span>
                <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <p className="text-2xl font-black tabular-nums">{formatCurrency(totalValue, "SGD")}</p>
              <p className="text-[11px] text-muted-foreground">
                SGD · USD/SGD {usdSgdRate.toFixed(4)}
              </p>
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

            <div className={`rounded-xl border bg-card p-4 card-elevated flex flex-col gap-2 ${
              onTrackPct === null ? "border-border" :
              onTrackPct >= 95 ? "border-green-500/30" :
              onTrackPct >= 80 ? "border-yellow-400/30" : "border-red-500/30"
            }`}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Goal Track</span>
                <Activity className={`h-3.5 w-3.5 ${
                  onTrackPct === null ? "text-muted-foreground" :
                  onTrackPct >= 95 ? "text-green-500" :
                  onTrackPct >= 80 ? "text-yellow-400" : "text-red-500"
                }`} />
              </div>
              <p className={`text-2xl font-black tabular-nums ${
                onTrackPct === null ? "text-muted-foreground" :
                onTrackPct >= 95 ? "text-green-500" :
                onTrackPct >= 80 ? "text-yellow-400" : "text-red-500"
              }`}>
                {onTrackPct !== null ? `${onTrackPct.toFixed(0)}%` : "—"}
              </p>
              <p className="text-[11px] text-muted-foreground">vs base-case 2045 pace</p>
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
                  const under = p.driftPct < 0
                  const badgeCls = p.status === "healthy"
                    ? "bg-green-500/10 text-green-600 dark:text-green-400 ring-1 ring-green-500/20"
                    : p.status === "soft"
                    ? under
                      ? "bg-yellow-400/15 text-yellow-700 dark:text-yellow-400 ring-1 ring-yellow-400/30"
                      : "bg-orange-500/15 text-orange-700 dark:text-orange-400 ring-1 ring-orange-500/30"
                    : "bg-red-500/15 text-red-700 dark:text-red-400 ring-1 ring-red-500/30"
                  const badgeLabel = p.status === "healthy" ? "On track" : p.status === "soft" ? (under ? "Underweight" : "Overweight") : (under ? "Buy now" : "Halt buys")
                  const rowCls = p.status === "hard"
                    ? "border-l-4 border-red-500"
                    : p.status === "soft"
                    ? under ? "border-l-[3px] border-yellow-400" : "border-l-[3px] border-orange-500"
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
                      <span className="text-xs tabular-nums font-semibold hidden sm:block">{hasBalance ? `${p.actualPct.toFixed(1)}%` : "—"}</span>
                      <span className="text-xs tabular-nums text-muted-foreground hidden sm:block">{p.targetPct}%</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold w-fit hidden sm:block ${hasBalance ? badgeCls : "bg-muted text-muted-foreground"}`}>{hasBalance ? badgeLabel : "Target"}</span>
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
                <span>{positions.length} positions{hasBalance ? ` · ${formatCurrency(totalValue, "SGD")} total` : " · no snapshot yet"}</span>
                <a href="/portfolio" className="font-semibold text-primary hover:underline">Manage holdings →</a>
              </div>
            </div>
          </div>

          {/* Next Execution Instructions */}
          <div id="execution">
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">
              What To Do This Month
            </h2>
            <ExecutionPlan
              positions={positions}
              totalValue={totalValue}
              hasBalance={hasBalance}
              allocOrder={allocOrder}
              hasAnyAlert={hasAnyAlert}
              defaultContribution={monthlyContribution}
              annualLumpSum={annualLumpSum}
            />
          </div>

          {/* How to use Atlas */}
          <div>
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">How to Use Atlas</h2>
            <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
              {[
                {
                  step: "1",
                  title: "Update your portfolio",
                  body: "Go to the Portfolio page and enter your current units and price for each holding. You can type them in manually, upload a screenshot from IBKR, or use the live price refresh. Do this at least once a month — ideally after your monthly contribution.",
                  href: "/portfolio",
                  cta: "Go to Portfolio →",
                },
                {
                  step: "2",
                  title: "Read the dashboard alerts",
                  body: "When positions drift outside their target bands, alerts appear at the top. Red = hard breach (urgent action — check badge for Buy now or Halt buys). Yellow = soft underweight (add more over 2–3 months). Orange = soft overweight (slow contributions). Green = on track.",
                  href: null,
                  cta: null,
                },
                {
                  step: "3",
                  title: "Follow the monthly plan",
                  body: "The \"What To Do This Month\" section tells you exactly how to split your $3,000 monthly contribution. Follow the suggested amounts — they are calculated to reduce drift and move your portfolio toward targets. Never deviate based on short-term market noise.",
                  href: "#execution",
                  cta: "See this month's plan ↓",
                },
                {
                  step: "4",
                  title: "Check the health score",
                  body: "The health gauge in the sidebar scores your portfolio across four dimensions: Structural (drift integrity), Behavioural (governance rule compliance), Concentration (hard-cap exposure), and Execution (how fresh your data is). Aim to stay above 80.",
                  href: null,
                  cta: null,
                },
                {
                  step: "5",
                  title: "Review reports monthly",
                  body: "The Reports page shows your look-through exposure to individual companies (Nvidia, Microsoft, Apple, etc.) and sectors (semiconductor, digital economy). Check that no company or sector has breached its hard cap before each contribution.",
                  href: "/reports",
                  cta: "Open Reports →",
                },
                {
                  step: "6",
                  title: "Never sell on emotion",
                  body: "Atlas is a long-horizon system (2045). It is designed to keep you disciplined through volatility. If you feel the urge to sell, go to the Behaviour page and read the red-flag checklist before doing anything.",
                  href: "/behaviour",
                  cta: "Read Behaviour System →",
                },
              ].map(({ step, title, body, href, cta }) => (
                <div key={step} className="flex items-start gap-4 px-5 py-4">
                  <div className="shrink-0 flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-[11px] font-black text-primary mt-0.5">{step}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold mb-1">{title}</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">{body}</p>
                    {href && cta && (
                      <a href={href} className="inline-block mt-2 text-[11px] font-semibold text-primary hover:underline">{cta}</a>
                    )}
                  </div>
                </div>
              ))}
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
            <HealthMethodology
              structural={health.structural.score}
              behavioural={health.behavioural.score}
              concentration={health.concentration.score}
              execution={health.execution.score}
              hardBreaches={hardBreaches}
              softBreaches={softBreaches}
              maxDrift={maxDrift}
              activeRules={activeRules}
              totalRules={totalRules}
              snapshotAgeDays={snapshotAgeDays}
            />
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
