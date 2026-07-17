import Link from "next/link"
import { Shell } from "@/components/shell"
import { db } from "@/lib/db"
import { formatCurrency } from "@/lib/utils"
import { Landmark, Zap } from "lucide-react"
import { getSession } from "@/lib/session"
import { redirect } from "next/navigation"
import { ForecastChartPanel, type ExtendedForecastPoint, type MilestoneMarker } from "@/components/charts/forecast-chart-panel"
import { buildPortfolioTimeline, annualisedVolatility } from "@/lib/portfolio-metrics"
import { constitutionIdForEmail, SILICON_BRICK_ROAD as SBR } from "@/lib/constitutions"
import { ASSET_EXPECTED_RETURNS, FORECAST_BENCHMARKS_AS_OF, blendedGrowthRates, projectPortfolio, toReal, coneProjection, effectiveMonthlyRate, yearsToHorizon } from "@/lib/forecast"
import { vestExtraContributionsForUser } from "@/lib/external-awards"
import { sbrBlendedGrowthRate } from "@/lib/sbr-forecast"
import { SBR_SPEC } from "@/lib/portfolio-spec"
import { activePortfolioContext } from "@/lib/active-portfolio"
import { SBR_ASSET_EXPECTED_RETURNS } from "@/lib/spec-derived"
import { AnimatedNumber } from "@/components/animated-number"
import { ProbabilityEngine } from "@/components/forecast/probability-engine"
import { SbrProbabilityEngine } from "@/components/forecast/sbr-probability-engine"
import { ShieldCheck } from "lucide-react"
import { ForecastGuide } from "@/components/forecast-guide"
import { HelpTooltip } from "@/components/help-tooltip"
import { RebalancingGuide } from "@/components/rebalancing-guide"

const BENCHMARKS_AS_OF = FORECAST_BENCHMARKS_AS_OF
const GLOBAL_BENCHMARK_RATE = ASSET_EXPECTED_RETURNS.VWRA?.base ?? ASSET_EXPECTED_RETURNS.IMID?.base ?? 0.085
const CONE_VOL_DEFAULT = 0.15 // fallback annual vol for the P10/P90 band when history is thin

const SCENARIO_META = [
  { key: "conservative" as const, label: "Conservative", color: "#a78bfa" },
  { key: "base" as const,         label: "Base Case",    color: "#6366f1" },
  { key: "aggressive" as const,   label: "Aggressive",   color: "#22c55e" },
]

const horizons = [10, 15, 19]

async function getForecastData(userId: string) {
  const holdings = await db.holding.findMany({
    where: { userId },
    include: { snapshots: { orderBy: { date: "asc" } } },
  })
  // Current value = sum of each holding's latest snapshot (matches the rest of the app).
  const currentValue = holdings.reduce((sum, h) => sum + (h.snapshots[h.snapshots.length - 1]?.value ?? 0), 0)
  // Most recent snapshot date for data freshness indicator
  const mostRecentSnapshot = holdings
    .flatMap(h => h.snapshots)
    .sort((a, b) => b.date.getTime() - a.date.getTime())[0]
  const lastUpdated = mostRecentSnapshot?.date ?? new Date()
  // Actual current allocation — feeds the blended growth-rate assumption, so the forecast
  // reflects what's really held (drifted or not), not the target weights.
  const allocMap: Record<string, number> = {}
  for (const h of holdings) {
    const value = h.snapshots[h.snapshots.length - 1]?.value ?? 0
    allocMap[h.ticker] = currentValue > 0 ? (value / currentValue) * 100 : 0
  }
  // Cone vol = the portfolio's REAL annualised volatility (same method as the Risk page),
  // clamped to a sane band; fall back to the long-run equity default when history is thin.
  const realVol = annualisedVolatility(buildPortfolioTimeline(holdings))
  const coneVol = realVol === null ? CONE_VOL_DEFAULT : Math.min(0.30, Math.max(0.08, realVol))
  return { currentValue, allocMap, coneVol, volIsReal: realVol !== null, lastUpdated }
}

// ── SBR forecast helpers ──────────────────────────────────────────────────────

const SBR_FUND_TICKERS = SBR.funds.map(f => f.ticker)
async function getSbrForecastData(userId: string) {
  const [holdings, owner] = await Promise.all([
    db.holding.findMany({ where: { userId, ticker: { in: SBR_FUND_TICKERS } }, include: { snapshots: { orderBy: { date: "desc" }, take: 1 } } }),
    db.user.findUnique({ where: { id: userId }, select: { monthlyContribution: true, annualLumpSum: true, contributionGrowthRate: true } }),
  ])
  const totalValue = holdings.reduce((s, h) => s + (h.snapshots[0]?.value ?? 0), 0)
  const allocMap: Record<string, number> = {}
  for (const h of holdings) {
    const value = h.snapshots[0]?.value ?? 0
    allocMap[h.ticker] = totalValue > 0 ? (value / totalValue) * 100 : 0
  }
  const growthRates = sbrBlendedGrowthRate(allocMap)
  const monthly = owner?.monthlyContribution ?? SBR_SPEC.monthlyContribution
  const annual = owner?.annualLumpSum ?? 0
  const growth = owner?.contributionGrowthRate ?? 0
  const futureValue = (years: number, annualRate: number) => {
    const months = years * 12
    const monthlyRate = effectiveMonthlyRate(annualRate)
    let value = totalValue
    for (let month = 0; month < months; month++) {
      const year = Math.floor(month / 12)
      const contribution = monthly * Math.pow(1 + growth, year)
      value = value * (1 + monthlyRate) + contribution
      if (month % 12 === 11) value += annual * Math.pow(1 + growth, year)
    }
    return value
  }
  const horizons = [3, 5, 10].map(years => ({
    years,
    contributed: totalValue + Array.from({length:years},(_,year)=>(monthly*12+annual)*Math.pow(1+growth,year)).reduce((a,b)=>a+b,0),
    conservative: futureValue(years, growthRates.conservative),
    base: futureValue(years, growthRates.base),
    aggressive: futureValue(years, growthRates.aggressive),
  }))
  return { totalValue, growthRates, monthly, annual, growth, horizons }
}

async function SbrForecast({ userId, userName, isAdmin }: { userId: string; userName: string; isAdmin: boolean }) {
  const d = await getSbrForecastData(userId)
  return (
    <Shell title="Where SBR Could Go" subtitle="Flexible-horizon scenarios — ranges, not promises or deadlines" userName={userName} isAdmin={isAdmin}>
      <div className="forecast-deck">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 mb-6">
        <div className="rounded-xl border border-border bg-card p-4 card-elevated">
          <p className="text-xs text-muted-foreground">Portfolio Now</p>
          <p className="mt-1 text-xl font-black tabular-nums"><AnimatedNumber value={d.totalValue} currency="SGD" /></p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Flexible growth mode</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 card-elevated">
          <p className="text-xs text-muted-foreground">Base planning return</p>
          <p className="mt-1 text-xl font-black tabular-nums text-sky-400">{(d.growthRates.base * 100).toFixed(1)}%</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Blended from actual holdings</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 card-elevated">
          <p className="text-xs text-muted-foreground">Monthly</p>
          <p className="mt-1 text-xl font-black tabular-nums">
            <AnimatedNumber value={d.monthly} currency="SGD" />
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Contribution</p>
        </div>
      </div>

      <div className="mb-5 rounded-xl border border-sky-500/20 bg-sky-500/[0.04] p-4 text-xs leading-relaxed text-muted-foreground">
        SBR has no fixed value target and no required end date. These illustrations use S${d.monthly.toLocaleString()} monthly, S${d.annual.toLocaleString()} annually and {(d.growth*100).toFixed(1)}% yearly contribution growth from Settings. They are not probabilities, guarantees, valuations or trading signals.
      </div>
      <div className="mb-5 overflow-x-auto rounded-xl border border-border bg-card p-5">
        <h2 className="text-lg font-bold">Illustrative growth ranges</h2>
        <table className="mt-4 w-full min-w-[620px] text-sm"><thead><tr className="text-left text-muted-foreground"><th className="py-2">Horizon</th><th>Cash contributed</th><th>Conservative</th><th>Base</th><th>Strong</th></tr></thead><tbody>{d.horizons.map(row => <tr key={row.years} className="border-t border-border"><td className="py-3 font-bold">{row.years} years</td><td>SGD {Math.round(row.contributed).toLocaleString()}</td><td>SGD {Math.round(row.conservative).toLocaleString()}</td><td className="font-bold text-sky-400">SGD {Math.round(row.base).toLocaleString()}</td><td>SGD {Math.round(row.aggressive).toLocaleString()}</td></tr>)}</tbody></table>
      </div>

      {/* Growth assumptions */}
      <div className="rounded-xl border border-border bg-card/50 p-5">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">Growth rate assumptions</p>
        <p className="text-[11px] text-muted-foreground mb-4 leading-relaxed">
          Blended from your actual current holdings (not target weights) &mdash; a drifted portfolio&apos;s projection reflects what you really hold.
        </p>
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Conservative", rate: d.growthRates.conservative, color: "text-amber-400" },
            { label: "Base", rate: d.growthRates.base, color: "text-sky-400" },
            { label: "Aggressive", rate: d.growthRates.aggressive, color: "text-green-400" },
          ].map(({ label, rate, color }) => (
            <div key={label} className="rounded-lg bg-muted/30 p-3 text-center">
              <p className="text-[10px] text-muted-foreground mb-1">{label}</p>
              <p className={`text-lg font-black tabular-nums ${color}`}>{(rate * 100).toFixed(1)}%</p>
              <p className="text-[10px] text-muted-foreground">p.a.</p>
            </div>
          ))}
        </div>
        <div className="mt-4 pt-3 border-t border-border">
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            Per-fund assumptions: {SBR_FUND_TICKERS.map(t => {
              const r = SBR_ASSET_EXPECTED_RETURNS[t]
              return r ? `${t} ${(r.conservative * 100).toFixed(0)}–${(r.aggressive * 100).toFixed(0)}%` : t
            }).join(" · ")}
          </p>
        </div>
      </div>

      {/* Governance Compliance Dashboard for SBR */}
      <GovernanceComplianceDashboard
        portfolio="silicon-brick-road"
        indicators={[
          {
            label: "Flexible Horizon",
            status: "compliant",
            value: "5/10/15y",
            detail: "No fixed end date; choose your own timeline",
            action: "Review horizon selection annually"
          },
          {
            label: "Watch/Pause Status",
            status: "compliant",
            value: "Normal",
            detail: "Portfolio operating within governance bands",
            action: "Monitor drawdown at monthly checkpoints"
          },
          {
            label: "Contribution Pace",
            status: "compliant",
            value: `S$${d.monthly.toLocaleString()}/mo`,
            detail: `Annual lump sum: S$${d.annual.toLocaleString()}`,
            action: "Adjust in Settings if circumstances change"
          },
          {
            label: "Base Projection",
            status: "compliant",
            value: `${(d.growthRates.base * 100).toFixed(1)}% p.a.`,
            detail: "Blended from actual current holdings",
            action: "Review annually or after major rebalance"
          },
        ]}
        rules={[
          {
            category: "Watch Tier",
            rule: ">20% maximum drawdown in any year",
            status: "pass",
            description: "Monitor closely; DCA continues normally; no action required",
            nextAction: "Check portfolio monthly; document rationale"
          },
          {
            category: "Pause Tier",
            rule: ">30% drawdown triggers governance review",
            status: "pass",
            description: "May pause contributions temporarily; formal committee decision required",
            nextAction: "Schedule committee meeting within 2 weeks of trigger"
          },
          {
            category: "Resume Tier",
            rule: "Recovery to new high removes pause",
            status: "pass",
            description: "Once portfolio reaches new peak, pause is automatically lifted",
            nextAction: "Resume contributions per original plan"
          },
        ]}
        riskMetrics={{
          maxDrawdown: 0.30,
          volatility: 0.12,
          concentration: 0.40,
        }}
        nextActions={[
          {
            priority: "medium",
            action: "Annual portfolio review",
            trigger: "Every January or after major market move",
            deadline: "Before January 31"
          },
          {
            priority: "low",
            action: "Review withdrawal plan",
            trigger: "If approaching your chosen horizon",
            deadline: "6 months before target year"
          },
        ]}
      />

      <RebalancingGuide portfolio="silicon-brick-road" />

      {/* SBR Probability Engine */}
      <SbrProbabilityEngine
        startValue={d.totalValue}
        monthlyDca={d.monthly}
        annualBonus={d.annual}
        contributionGrowthRate={d.growth}
      />
      </div>
    </Shell>
  )
}

// ── main export ──────────────────────────────────────────────────────────────

export default async function Forecast() {
  const session = await getSession()
  if (!session) redirect("/login")
  const active = await activePortfolioContext(session)

  if (active.constitutionId === "silicon-brick-road") {
    return <SbrForecast userId={active.owner.id} userName={session.name} isAdmin={session.role === "admin"} />
  }

  const [forecast, user] = await Promise.all([
    getForecastData(active.owner.id),
    db.user.findUnique({ where: { id: active.owner.id } }),
  ])
  const { currentValue, allocMap, coneVol, volIsReal, lastUpdated } = forecast

  const MONTHLY_CONTRIBUTION = user?.monthlyContribution ?? 3000
  const ANNUAL_LUMP_SUM = user?.annualLumpSum ?? 20000
  const CONTRIBUTION_GROWTH_RATE = user?.contributionGrowthRate ?? 0.05
  const RISK_FREE_RATE = user?.riskFreeRate ?? 0.04

  // Outside-Atlas RSU vests as planned contributions (sell-on-vest SOP) — after-tax,
  // plan-currency amounts at their scheduled month. Applied to EVERY scenario line:
  // vests are cash inflows like the January boost, independent of the growth scenario.
  const vestExtras = await vestExtraContributionsForUser(active.owner.id)

  // Growth-rate assumptions blended from the portfolio's ACTUAL current holdings (not the
  // target weights) — a portfolio that has drifted toward more BTC/EQQQ sees that reflected
  // here, same as every other computation in the app. The buffer (SGOV) portion uses the
  // user's own Settings risk-free-rate assumption.
  const { rates } = blendedGrowthRates(allocMap, RISK_FREE_RATE)
  const returnScenarios = SCENARIO_META.map((s) => ({
    ...s,
    rate: rates[s.key],
    rateLabel: `${(rates[s.key] * 100).toFixed(1)}% p.a.`,
  }))

  const startYear = new Date().getFullYear()

  // Build year-by-year chart data (current year → 2045)
  const chartData: ExtendedForecastPoint[] = []
  const remainingYears = yearsToHorizon(2045, startYear)
  for (let yr = 0; yr <= remainingYears; yr++) {
    const year = startYear + yr
    const conservative = yr === 0 ? currentValue : projectPortfolio(currentValue, MONTHLY_CONTRIBUTION, ANNUAL_LUMP_SUM, rates.conservative, yr, CONTRIBUTION_GROWTH_RATE, vestExtras)
    const base         = yr === 0 ? currentValue : projectPortfolio(currentValue, MONTHLY_CONTRIBUTION, ANNUAL_LUMP_SUM, rates.base, yr, CONTRIBUTION_GROWTH_RATE, vestExtras)
    const aggressive   = yr === 0 ? currentValue : projectPortfolio(currentValue, MONTHLY_CONTRIBUTION, ANNUAL_LUMP_SUM, rates.aggressive, yr, CONTRIBUTION_GROWTH_RATE, vestExtras)
    const savings      = yr === 0 ? currentValue : projectPortfolio(currentValue, MONTHLY_CONTRIBUTION, ANNUAL_LUMP_SUM, RISK_FREE_RATE, yr, CONTRIBUTION_GROWTH_RATE, vestExtras)
    const vtBenchmark  = yr === 0 ? currentValue : projectPortfolio(currentValue, MONTHLY_CONTRIBUTION, ANNUAL_LUMP_SUM, GLOBAL_BENCHMARK_RATE, yr, CONTRIBUTION_GROWTH_RATE, vestExtras)
    const coneP10      = coneProjection(base, yr, -1.28, coneVol)
    const coneP90      = coneProjection(base, yr,  1.28, coneVol)
    const contribLow   = yr === 0 ? currentValue : projectPortfolio(currentValue, MONTHLY_CONTRIBUTION * 0.8, ANNUAL_LUMP_SUM, rates.base, yr, CONTRIBUTION_GROWTH_RATE, vestExtras)
    const contribHigh  = yr === 0 ? currentValue : projectPortfolio(currentValue, MONTHLY_CONTRIBUTION * 1.2, ANNUAL_LUMP_SUM, rates.base, yr, CONTRIBUTION_GROWTH_RATE, vestExtras)
    chartData.push({
      year,
      label: String(year),
      yr,
      conservative,
      base,
      aggressive,
      savings,
      vtBenchmark,
      realConservative: toReal(conservative, yr),
      realBase:         toReal(base, yr),
      realAggressive:   toReal(aggressive, yr),
      realSavings:      toReal(savings, yr),
      realVtBenchmark:  toReal(vtBenchmark, yr),
      coneP10,
      coneP90,
      realConeP10:  toReal(coneP10, yr),
      realConeP90:  toReal(coneP90, yr),
      contribLow,
      contribHigh,
    })
  }

  const projections = returnScenarios.map((scenario) => ({
    ...scenario,
    values: horizons.map((years) => ({
      years,
      projected: projectPortfolio(currentValue, MONTHLY_CONTRIBUTION, ANNUAL_LUMP_SUM, scenario.rate, years, CONTRIBUTION_GROWTH_RATE, vestExtras),
    })),
  }))

  const savingsValues = horizons.map((years) => ({
    years,
    projected: projectPortfolio(currentValue, MONTHLY_CONTRIBUTION, ANNUAL_LUMP_SUM, RISK_FREE_RATE, years, CONTRIBUTION_GROWTH_RATE, vestExtras),
  }))

  const maxProjected = projections[2].values[2].projected

  // Milestone markers — only include those below the aggressive 2045 projection
  const milestones: MilestoneMarker[] = [
    { value: 200_000,   label: "$200K" },
    { value: 500_000,   label: "$500K" },
    { value: 1_000_000, label: "$1M"   },
    { value: 2_000_000, label: "$2M"   },
  ].filter(m => m.value < maxProjected && m.value > currentValue)

  // Key 2045 numbers
  const base2045   = projections[1].values[2].projected
  const savings2045 = savingsValues[2].projected
  const multiplier  = base2045 / savings2045
  const aggressive2045 = projections[2].values[2].projected

  function fmtM(v: number) {
    if (v >= 1_000_000) return `S$${(v / 1_000_000).toFixed(2)}M`
    return formatCurrency(v, "SGD")
  }

  return (
    <Shell title="Forecast Engine" subtitle="Long-term compounding trajectories — 2045 horizon" userName={session.name} isAdmin={session.role === "admin"}>
      <div className="forecast-deck">

      {/* Starting Portfolio Card */}
      <div className="rounded-xl border border-border bg-card p-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex-1">
            <p className="text-xs text-muted-foreground mb-1">Starting Portfolio Value</p>
            <p className="text-2xl font-black tabular-nums mb-0.5">{fmtM(currentValue)}</p>
            <p className="text-xs text-muted-foreground">Updated {lastUpdated.toLocaleDateString()}</p>
          </div>
          <div className="flex gap-2">
            <Link href="/mission-control" className="px-3 py-2 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors text-xs font-medium">
              ↻ Update holdings
            </Link>
            <Link href="/portfolio" className="px-3 py-2 rounded-lg border border-border hover:bg-muted transition-colors text-xs font-medium">
              → View portfolio
            </Link>
          </div>
        </div>
      </div>

      {/* Compliance status — link to dedicated compliance page */}
      <Link href="/compliance" className="group flex items-start gap-4 rounded-xl border border-green-500/30 bg-green-500/5 dark:bg-green-500/[0.07] px-5 py-4 mb-6 hover:border-green-500/50 hover:bg-green-500/10 transition-colors">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-500/20 shrink-0 mt-0.5">
          <ShieldCheck className="h-4 w-4 text-green-600 dark:text-green-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">Portfolio Compliance Status</p>
          <p className="text-xs text-muted-foreground mt-0.5">All governance rules satisfied · {(rates.base * 100).toFixed(1)}% base growth assumption · {(coneVol * 100).toFixed(0)}% volatility</p>
        </div>
        <span className="text-xs font-semibold text-muted-foreground/60 group-hover:text-green-600 dark:group-hover:text-green-400 transition-colors shrink-0">View full status →</span>
      </Link>

      <ForecastGuide />

      <RebalancingGuide portfolio="atlas-core" />

      {/* Hero stat row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-6">
        <div className="rounded-xl border border-border bg-card p-4 card-elevated">
          <p className="text-xs text-muted-foreground">Current Portfolio</p>
          <p className="mt-1 text-xl font-black tabular-nums">{fmtM(currentValue)}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Starting capital</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 card-elevated">
          <p className="text-xs text-muted-foreground">Base Case — 2045</p>
          <p className="mt-1 text-xl font-black tabular-nums gradient-text">{fmtM(base2045)}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{(rates.base * 100).toFixed(1)}% p.a. · 19 years</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 card-elevated">
          <p className="text-xs text-muted-foreground">Aggressive — 2045</p>
          <p className="mt-1 text-xl font-black tabular-nums text-green-500">{fmtM(aggressive2045)}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{(rates.aggressive * 100).toFixed(1)}% p.a. · 19 years</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 card-elevated">
          <p className="text-xs text-muted-foreground">Base vs Bank Savings</p>
          <p className="mt-1 text-xl font-black tabular-nums text-primary">{multiplier.toFixed(1)}x</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Investing advantage</p>
        </div>
      </div>

      {/* Principle */}
      <div className="mb-5 rounded-xl border border-primary/20 bg-primary/5 dark:bg-primary/[0.07] p-4">
        <p className="text-xs text-foreground/80 leading-relaxed max-w-2xl">
          <span className="font-bold text-foreground">The point is not prediction.</span>{" "}
          The point is making long-term compounding emotionally visible — making staying the course feel rational and worthwhile.
          Forecasts are probabilistic; markets are non-linear and volatility is inevitable.
        </p>
      </div>

      {/* CHART PANEL */}
      <div className="rounded-xl border border-border bg-card overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-border flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-0.5">
              <h2 className="text-sm font-semibold">Compounding Trajectories</h2>
              <HelpTooltip
                title="How trajectories are calculated"
                description="Each trajectory assumes your current allocation remains constant and applies consistent annual returns. The P10/P90 cone shows a range based on historical volatility. These are growth projections, not predictions or guarantees."
              />
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {startYear} → 2045 · hover to inspect any year · switch views for uncertainty & contribution sensitivity
            </p>
          </div>
        </div>
        <div className="p-4">
          <ForecastChartPanel
            data={chartData}
            currentValue={currentValue}
            milestones={milestones}
            monthlyContribution={MONTHLY_CONTRIBUTION}
            baseRate={rates.base}
          />
        </div>
      </div>

      {/* Assumptions */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Monthly Contribution", value: `S$${MONTHLY_CONTRIBUTION.toLocaleString()}`, sub: "SGD/month" },
          { label: "Annual Lump Sum",       value: `S$${ANNUAL_LUMP_SUM.toLocaleString()}`, sub: "SGD/year" },
          { label: "Contribution Growth",   value: `${(CONTRIBUTION_GROWTH_RATE * 100).toFixed(0)}% p.a.`, sub: "Annual increase" },
          { label: "Base Growth Rate",      value: `${(rates.base * 100).toFixed(1)}% p.a.`, sub: `From your holdings mix, as of ${BENCHMARKS_AS_OF}` },
          { label: "Horizon",               value: "2045", sub: "19 years remaining" },
          // Outside-Atlas RSU pipeline (sell-on-vest SOP) — surfaced so the chart's
          // assumptions are honest about the extra planned inflows.
          ...(vestExtras.length > 0 ? [{
            label: "RSU Vests",
            value: `${vestExtras.length} planned`,
            sub: `≈ ${formatCurrency(vestExtras.reduce((s, v) => s + v.amount, 0), "USD")} after tax, sell-on-vest`,
          }] : []),
        ].map(({ label, value, sub }) => (
          <div key={label} className="rounded-xl border border-border bg-card p-4 card-elevated flex flex-col gap-1.5">
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            <p className="text-lg font-black tabular-nums">{value}</p>
            <p className="text-[11px] text-muted-foreground">{sub}</p>
          </div>
        ))}
      </div>

      {/* Scenario cards */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-sm font-semibold">Growth Scenarios</h3>
          <HelpTooltip
            title="Understanding scenarios"
            description="Conservative assumes lower returns; Base Case reflects historical averages from your holdings; Aggressive assumes stronger performance. None are predictions — they show ranges for planning purposes. Your actual outcome will likely fall somewhere between Conservative and Aggressive."
          />
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {projections.map(({ label, rateLabel, values, color }) => (
            <div key={label} className="rounded-xl border border-border bg-card p-5 card-elevated">
              <div className="flex items-center justify-between mb-0.5">
                <h3 className="text-sm font-bold">{label}</h3>
                <span className="text-xs font-medium text-muted-foreground">{rateLabel}</span>
              </div>
            <div className="h-px bg-border my-3" style={{ background: `linear-gradient(to right, ${color}50, transparent)` }} />
            <div className="space-y-4">
              {values.map(({ years, projected }) => (
                <div key={years}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-muted-foreground">{years === 19 ? "2045 (19-yr)" : `${years}-year`}</span>
                    <span className="text-sm font-black tabular-nums" style={{ color }}>
                      {fmtM(projected)}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.min(100, (projected / maxProjected) * 100)}%`,
                        backgroundColor: color,
                        opacity: 0.75,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        </div>
      </div>

      {/* Bank savings comparison */}
      <div className="mb-6 rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-2 mb-1">
          <Landmark className="h-3.5 w-3.5 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Bank Savings Reference</h3>
          <span className="text-xs text-muted-foreground ml-auto">{(RISK_FREE_RATE * 100).toFixed(1)}% p.a.</span>
        </div>
        <p className="text-[11px] text-muted-foreground mb-5">
          Your Settings risk-free-rate assumption ({(RISK_FREE_RATE * 100).toFixed(1)}% — a T-bill / high-yield savings proxy, editable on the Settings page) · same contributions · SGD-denominated.
          {" "}P10/P90 cone uses {(coneVol * 100).toFixed(0)}% annual volatility ({volIsReal ? "your portfolio's actual history" : `default — too little history yet`}).
        </p>
        <div className="space-y-4">
          {savingsValues.map(({ years, projected }) => (
            <div key={years}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-muted-foreground">{years === 19 ? "2045 (19-yr)" : `${years}-year`}</span>
                <span className="text-sm font-semibold text-muted-foreground tabular-nums">{fmtM(projected)}</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-slate-400/50 bar-fill"
                  style={{ width: `${Math.min(100, (projected / maxProjected) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Summary table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden mb-4">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold">Projection Summary</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Starting {fmtM(currentValue)} · S${MONTHLY_CONTRIBUTION.toLocaleString()} SGD/mo + S${ANNUAL_LUMP_SUM.toLocaleString()} SGD/yr · contributions +{(CONTRIBUTION_GROWTH_RATE * 100).toFixed(0)}% p.a.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-5 py-2.5 text-left font-semibold text-muted-foreground">Horizon</th>
                {returnScenarios.map((s) => (
                  <th key={s.label} className="px-5 py-2.5 text-right font-semibold text-muted-foreground whitespace-nowrap">
                    {s.label}
                  </th>
                ))}
                <th className="px-5 py-2.5 text-right font-semibold text-muted-foreground whitespace-nowrap border-l border-border">
                  Bank Savings
                </th>
                <th className="px-5 py-2.5 text-right font-semibold text-muted-foreground whitespace-nowrap">
                  Base vs Savings
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {horizons.map((years) => {
                const sav = savingsValues.find((v) => v.years === years)!.projected
                const base = projections[1].values.find((v) => v.years === years)!.projected
                const mult = base / sav
                return (
                  <tr key={years} className="hover:bg-accent/30 transition-colors">
                    <td className="px-5 py-3 font-semibold">{years === 19 ? "19 years (2045)" : `${years} years`}</td>
                    {projections.map(({ label, values, color }) => {
                      const val = values.find((v) => v.years === years)!
                      return (
                        <td key={label} className="px-5 py-3 text-right font-bold tabular-nums" style={{ color }}>
                          {fmtM(val.projected)}
                        </td>
                      )
                    })}
                    <td className="px-5 py-3 text-right text-muted-foreground border-l border-border tabular-nums">
                      {fmtM(sav)}
                    </td>
                    <td className="px-5 py-3 text-right font-black text-green-500 tabular-nums">
                      {mult.toFixed(1)}x
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-3 border-t border-border bg-muted/20">
          <p className="text-[11px] text-muted-foreground">
            Bank savings rate uses your own Settings risk-free-rate assumption ({(RISK_FREE_RATE * 100).toFixed(1)}%) — a T-bill / high-yield savings proxy.
            &ldquo;Base vs Savings&rdquo; shows how many times larger the base case portfolio becomes versus the savings reference.
          </p>
        </div>
      </div>

      {/* 2040–2045 Glide Path */}
      <div className="rounded-xl border border-border bg-card overflow-hidden mb-4">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold">2040–2045 Transition Plan</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Five years before the target, the portfolio gradually shifts from growth to stability.
            Each year has a maximum stock exposure and a specific action to take.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-5 py-2.5 text-left font-semibold text-muted-foreground">Year</th>
                <th className="px-5 py-2.5 text-left font-semibold text-muted-foreground whitespace-nowrap">Max Stocks</th>
                <th className="px-5 py-2.5 text-left font-semibold text-muted-foreground">What to do</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {[
                { year: "2040", maxEquity: "90%", action: "Complete the 2040 portfolio review. Write a Distribution Plan — a document that says how you will draw money down from the portfolio in retirement." },
                { year: "2041", maxEquity: "Review", action: "Confirm the 2045 use, currency and required amount before changing the growth portfolio." },
                { year: "2042", maxEquity: "Review", action: "Create a separate liability-matched spending sleeve only for money likely to be used within three years." },
                { year: "2043", maxEquity: "Review", action: "Fund the documented liability sleeve progressively; keep surplus capital under the v10.6 growth constitution." },
                { year: "2044", maxEquity: "70%", action: "Final year of building the portfolio. Shift the focus from growth to keeping what you have safe and generating income." },
                { year: "2045", maxEquity: "Per 2040 Review", action: "Retirement drawdown begins. Follow the Distribution Plan written in 2040." },
              ].map(({ year, maxEquity, action }) => (
                <tr key={year} className="hover:bg-accent/30 transition-colors">
                  <td className="px-5 py-3 font-black tabular-nums">{year}</td>
                  <td className="px-5 py-3 font-semibold text-primary tabular-nums whitespace-nowrap">{maxEquity}</td>
                  <td className="px-5 py-3 text-muted-foreground leading-relaxed">{action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-3 border-t border-border bg-muted/20">
          <p className="text-[11px] text-muted-foreground">
            <span className="font-semibold text-foreground">Sell-down order when drawing down:</span>{" "}
            Liability-matched external cash first → Bitcoin → SMH → EQAC → VWRA; DBMFE remains a diversifier, not guaranteed capital.
            This sells the highest-concentration and highest-volatility positions first,
            keeping the broadest and cheapest holdings longest.
          </p>
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 mb-6">
        <Zap className="h-4 w-4 text-primary shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          <span className="font-bold text-foreground">Increasing contributions is often more powerful than optimising returns.</span>{" "}
          A 5% annual increase in contributions typically has a larger effect on terminal wealth over 20 years
          than a 1% improvement in annual return. Consistency and contribution growth compound alongside capital.
        </p>
      </div>

      {/* Compliance status — link to dedicated compliance page */}
      <Link href="/compliance" className="group flex items-start gap-4 rounded-xl border border-green-500/30 bg-green-500/5 dark:bg-green-500/[0.07] px-5 py-4 mb-6 hover:border-green-500/50 hover:bg-green-500/10 transition-colors">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-500/20 shrink-0 mt-0.5">
          <ShieldCheck className="h-4 w-4 text-green-600 dark:text-green-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">Portfolio Compliance Status</p>
          <p className="text-xs text-muted-foreground mt-0.5">All governance rules satisfied · 2045 target {fmtM(base2045)} base case · {(rates.base * 100).toFixed(1)}% p.a. growth assumption</p>
        </div>
        <span className="text-xs font-semibold text-muted-foreground/60 group-hover:text-green-600 dark:group-hover:text-green-400 transition-colors shrink-0">View full status →</span>
      </Link>

      <ProbabilityEngine
        startValue={currentValue}
        monthlyDca={MONTHLY_CONTRIBUTION}
        annualBonus={ANNUAL_LUMP_SUM}
        contributionGrowthRate={CONTRIBUTION_GROWTH_RATE}
      />
      </div>
    </Shell>
  )
}
