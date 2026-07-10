import { Shell } from "@/components/shell"
import { db } from "@/lib/db"
import { formatCurrency } from "@/lib/utils"
import { Landmark, Zap } from "lucide-react"
import { getSession } from "@/lib/session"
import { redirect } from "next/navigation"
import { ForecastChartPanel, type ExtendedForecastPoint, type MilestoneMarker } from "@/components/charts/forecast-chart-panel"
import { buildPortfolioTimeline, annualisedVolatility } from "@/lib/portfolio-metrics"
import { constitutionIdForEmail, SILICON_BRICK_ROAD as SBR } from "@/lib/constitutions"
import { ASSET_EXPECTED_RETURNS, FORECAST_BENCHMARKS_AS_OF, blendedGrowthRates, projectPortfolio, toReal, coneProjection } from "@/lib/forecast"
import { sbrBlendedGrowthRate, SBR_ASSET_EXPECTED_RETURNS, monthsToTarget } from "@/lib/sbr-forecast"
import { sbrPhase } from "@/lib/sbr-engine"
import { SBR_SPEC } from "@/lib/portfolio-spec"
import { EquityCurve, type ProjectionPoint } from "@/components/sbr/equity-curve"
import { ScenarioCards, type Scenario } from "@/components/sbr/scenario-cards"
import { BrickRoad } from "@/components/sbr/brick-road"
import { AnimatedNumber } from "@/components/animated-number"

const BENCHMARKS_AS_OF = FORECAST_BENCHMARKS_AS_OF
const VT_HISTORICAL_RATE = ASSET_EXPECTED_RETURNS.VT.base // VT (Total World) long-run CAGR proxy — single source with the blend
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
  return { currentValue, allocMap, coneVol, volIsReal: realVol !== null }
}

// ── SBR forecast helpers ──────────────────────────────────────────────────────

const SBR_FUND_TICKERS = SBR.funds.map(f => f.ticker)
const SBR_SEED = 10000
const SBR_HORIZON_MONTHS = 60

// Target-weighted blend of per-fund expected returns from portfolio-spec.
const SBR_TARGET_RATES = sbrBlendedGrowthRate(
  Object.fromEntries(SBR_SPEC.funds.filter(f => f.target > 0).map(f => [f.ticker, f.target]))
)
const SBR_SCENARIOS: Scenario[] = [
  { name: "Strong",       rate: SBR_TARGET_RATES.aggressive, probability: 15, color: "green", description: "All four funds beat their long-run average for three straight years." },
  { name: "Base",         rate: SBR_TARGET_RATES.base,       probability: 30, color: "sky",   description: "The most likely path — steady global growth, a few dips, recovery." },
  { name: "Conservative", rate: SBR_TARGET_RATES.conservative, probability: 45, color: "amber", description: "Below-average returns — still clears the goal with discipline." },
  { name: "Severe bear",  rate: null,                        probability: 10, color: "red",   description: "A prolonged downturn — the floor kicks in and the purchase waits." },
]

async function getSbrForecastData(userId: string) {
  const holdings = await db.holding.findMany({
    where: { userId, ticker: { in: SBR_FUND_TICKERS } },
    include: { snapshots: { orderBy: { date: "desc" }, take: 1 } },
  })
  const totalValue = holdings.reduce((s, h) => s + (h.snapshots[0]?.value ?? 0), 0)
  const allocMap: Record<string, number> = {}
  for (const h of holdings) {
    const value = h.snapshots[0]?.value ?? 0
    allocMap[h.ticker] = totalValue > 0 ? (value / totalValue) * 100 : 0
  }
  const growthRates = sbrBlendedGrowthRate(allocMap)
  const target = SBR_SPEC.targetValue
  const monthly = SBR_SPEC.monthlyContribution

  const monthsToGoal = {
    conservative: monthsToTarget(totalValue, monthly, growthRates.conservative, target),
    base: monthsToTarget(totalValue, monthly, growthRates.base, target),
    aggressive: monthsToTarget(totalValue, monthly, growthRates.aggressive, target),
  }

  // months already invested — approximate from contributions data
  const trades = await db.trade.findMany({ where: { userId, ticker: { in: SBR_FUND_TICKERS } } })
  const firstTrade = trades.length > 0
    ? trades.reduce((earliest, t) => (t.date < earliest ? t.date : earliest), trades[0].date)
    : null
  const monthsElapsed = firstTrade
    ? Math.max(0, Math.floor((Date.now() - new Date(firstTrade).getTime()) / (30.44 * 24 * 60 * 60 * 1000)))
    : 0

  // build month-by-month projection points
  const horizonMonths = Math.max(SBR_HORIZON_MONTHS, (monthsToGoal.conservative ?? SBR_HORIZON_MONTHS) + 6)
  const points: ProjectionPoint[] = []
  for (let m = 0; m <= horizonMonths; m++) {
    const mr_c = growthRates.conservative / 12
    const mr_b = growthRates.base / 12
    const mr_a = growthRates.aggressive / 12
    const fv = (rate: number) => {
      let v = totalValue
      for (let i = 0; i < m; i++) v = v * (1 + rate) + monthly
      return v
    }
    points.push({
      month: m,
      conservative: m === 0 ? totalValue : fv(mr_c),
      base: m === 0 ? totalValue : fv(mr_b),
      aggressive: m === 0 ? totalValue : fv(mr_a),
      invested: totalValue + monthly * m,
    })
  }

  const phase = sbrPhase(totalValue)

  return {
    totalValue, growthRates, monthsToGoal, monthsElapsed, points,
    target, monthly, phase,
  }
}

async function SbrForecast({ userId, userName, isAdmin }: { userId: string; userName: string; isAdmin: boolean }) {
  const d = await getSbrForecastData(userId)
  const hasBalance = d.totalValue > 0

  function monthsToLabel(months: number | null): string {
    if (months === null) return "50+ years away at this rate"
    if (months === 0) return "already there"
    const dt = new Date()
    dt.setDate(1)
    dt.setMonth(dt.getMonth() + months)
    return dt.toLocaleDateString("en-GB", { month: "short", year: "numeric" })
  }

  const phases = SBR_SPEC.phases.map(p => ({
    key: p.key,
    threshold: p.max ?? d.target,
    label: p.max !== null ? `< ${formatCurrency(p.max, "SGD")}` : `${formatCurrency(p.min, "SGD")}+`,
  }))

  return (
    <Shell title="Where the Road Leads" subtitle="Projections and scenarios for your home deposit" userName={userName} isAdmin={isAdmin}>

      {/* Hero stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-6">
        <div className="rounded-xl border border-border bg-card p-4 card-elevated">
          <p className="text-xs text-muted-foreground">Portfolio Now</p>
          <p className="mt-1 text-xl font-black tabular-nums">
            {hasBalance ? <AnimatedNumber value={d.totalValue} currency="SGD" /> : <span className="text-muted-foreground">—</span>}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Phase {d.phase.key}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 card-elevated">
          <p className="text-xs text-muted-foreground">Goal</p>
          <p className="mt-1 text-xl font-black tabular-nums gradient-text">
            <AnimatedNumber value={d.target} currency="SGD" />
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Home deposit target</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 card-elevated">
          <p className="text-xs text-muted-foreground">Base Case ETA</p>
          <p className="mt-1 text-xl font-black tabular-nums text-sky-400">
            {d.monthsToGoal.base !== null ? monthsToLabel(d.monthsToGoal.base) : "—"}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{(d.growthRates.base * 100).toFixed(1)}% p.a. blended</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 card-elevated">
          <p className="text-xs text-muted-foreground">Monthly</p>
          <p className="mt-1 text-xl font-black tabular-nums">
            <AnimatedNumber value={d.monthly} currency="SGD" />
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Contribution</p>
        </div>
      </div>

      {/* Time-to-goal range */}
      {hasBalance && (
        <div className="mb-5 rounded-xl border border-sky-500/20 bg-sky-500/[0.04] p-4">
          <p className="text-xs leading-relaxed text-muted-foreground">
            At SGD {d.monthly.toLocaleString()}/month and your current fund mix ({(d.growthRates.base * 100).toFixed(1)}% growth a year, blended from what you actually hold),
            projected to reach your goal around <span className="font-semibold text-foreground">{monthsToLabel(d.monthsToGoal.base)}</span>
            {" "}&mdash; could be as early as {monthsToLabel(d.monthsToGoal.aggressive)} or as late as {monthsToLabel(d.monthsToGoal.conservative)} depending on returns.
          </p>
        </div>
      )}

      {/* Brick Road */}
      <div className="mb-5">
        <BrickRoad
          totalValue={d.totalValue}
          targetValue={d.target}
          currentPhase={d.phase.key}
          phases={phases}
          monthsToGoal={d.monthsToGoal.base}
        />
      </div>

      {/* Equity Curve */}
      <div className="mb-5">
        <EquityCurve
          points={d.points}
          currentMonth={d.monthsElapsed}
          currentValue={d.totalValue}
          targetValue={d.target}
        />
      </div>

      {/* Scenario Cards */}
      <div className="mb-5">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">What to expect at exit</p>
        <p className="text-xs text-muted-foreground mb-4 max-w-xl leading-relaxed">
          Four possible worlds. Probabilities sum to 100%. The floor &mdash; total capital invested &mdash; is the lowest the fund is structured to exit at.
          Drag the slider to see how a different monthly amount changes the picture.
        </p>
        <ScenarioCards
          scenarios={SBR_SCENARIOS}
          defaultMonthly={d.monthly}
          seedValue={SBR_SEED}
          horizonMonths={SBR_HORIZON_MONTHS}
          targetValue={d.target}
        />
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
    </Shell>
  )
}

// ── main export ──────────────────────────────────────────────────────────────

export default async function Forecast() {
  const session = await getSession()
  if (!session) redirect("/login")

  if (constitutionIdForEmail(session.email) === "silicon-brick-road") {
    return <SbrForecast userId={session.userId} userName={session.name} isAdmin={session.role === "admin"} />
  }

  const [forecast, user] = await Promise.all([
    getForecastData(session.userId),
    db.user.findUnique({ where: { id: session.userId } }),
  ])
  const { currentValue, allocMap, coneVol, volIsReal } = forecast

  const MONTHLY_CONTRIBUTION = user?.monthlyContribution ?? 3000
  const ANNUAL_LUMP_SUM = user?.annualLumpSum ?? 20000
  const CONTRIBUTION_GROWTH_RATE = user?.contributionGrowthRate ?? 0.05
  const RISK_FREE_RATE = user?.riskFreeRate ?? 0.04

  // Growth-rate assumptions blended from the portfolio's ACTUAL current holdings (not the
  // target weights) — a portfolio that has drifted toward more BTC/QQQM sees that reflected
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
  for (let yr = 0; yr <= 19; yr++) {
    const year = startYear + yr
    const conservative = yr === 0 ? currentValue : projectPortfolio(currentValue, MONTHLY_CONTRIBUTION, ANNUAL_LUMP_SUM, rates.conservative, yr, CONTRIBUTION_GROWTH_RATE)
    const base         = yr === 0 ? currentValue : projectPortfolio(currentValue, MONTHLY_CONTRIBUTION, ANNUAL_LUMP_SUM, rates.base, yr, CONTRIBUTION_GROWTH_RATE)
    const aggressive   = yr === 0 ? currentValue : projectPortfolio(currentValue, MONTHLY_CONTRIBUTION, ANNUAL_LUMP_SUM, rates.aggressive, yr, CONTRIBUTION_GROWTH_RATE)
    const savings      = yr === 0 ? currentValue : projectPortfolio(currentValue, MONTHLY_CONTRIBUTION, ANNUAL_LUMP_SUM, RISK_FREE_RATE, yr, CONTRIBUTION_GROWTH_RATE)
    const vtBenchmark  = yr === 0 ? currentValue : projectPortfolio(currentValue, MONTHLY_CONTRIBUTION, ANNUAL_LUMP_SUM, VT_HISTORICAL_RATE, yr, CONTRIBUTION_GROWTH_RATE)
    const coneP10      = coneProjection(base, yr, -1.28, coneVol)
    const coneP90      = coneProjection(base, yr,  1.28, coneVol)
    const contribLow   = yr === 0 ? currentValue : projectPortfolio(currentValue, MONTHLY_CONTRIBUTION * 0.8, ANNUAL_LUMP_SUM, rates.base, yr, CONTRIBUTION_GROWTH_RATE)
    const contribHigh  = yr === 0 ? currentValue : projectPortfolio(currentValue, MONTHLY_CONTRIBUTION * 1.2, ANNUAL_LUMP_SUM, rates.base, yr, CONTRIBUTION_GROWTH_RATE)
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
      projected: projectPortfolio(currentValue, MONTHLY_CONTRIBUTION, ANNUAL_LUMP_SUM, scenario.rate, years, CONTRIBUTION_GROWTH_RATE),
    })),
  }))

  const savingsValues = horizons.map((years) => ({
    years,
    projected: projectPortfolio(currentValue, MONTHLY_CONTRIBUTION, ANNUAL_LUMP_SUM, RISK_FREE_RATE, years, CONTRIBUTION_GROWTH_RATE),
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
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold">Compounding Trajectories</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {startYear} → 2045 · hover to inspect any year · switch views for uncertainty & contribution sensitivity
          </p>
        </div>
        <div className="p-4">
          <ForecastChartPanel
            data={chartData}
            currentValue={currentValue}
            milestones={milestones}
            monthlyContribution={MONTHLY_CONTRIBUTION}
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
        ].map(({ label, value, sub }) => (
          <div key={label} className="rounded-xl border border-border bg-card p-4 card-elevated flex flex-col gap-1.5">
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            <p className="text-lg font-black tabular-nums">{value}</p>
            <p className="text-[11px] text-muted-foreground">{sub}</p>
          </div>
        ))}
      </div>

      {/* Scenario cards */}
      <div className="grid gap-4 md:grid-cols-3 mb-6">
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
                { year: "2041", maxEquity: "85%", action: "Reduce Bitcoin toward 4% of the portfolio. Rebuild your safety buffer (SGOV / cash) to at least 15%." },
                { year: "2042", maxEquity: "80%", action: "Reduce semiconductors (SMH) toward 6%. Start moving some money into bonds — target 5–8% in bonds by end of year." },
                { year: "2043", maxEquity: "75%", action: "Bring QQQM down toward 18% and emerging markets toward 5%. Move bonds and cash combined to 15–20%." },
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
            SGOV first → BTC → SMH → VWO → QQQM → VT last.
            This sells the highest-concentration and highest-volatility positions first,
            keeping the broadest and cheapest holdings longest.
          </p>
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-4">
        <Zap className="h-4 w-4 text-primary shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          <span className="font-bold text-foreground">Increasing contributions is often more powerful than optimising returns.</span>{" "}
          A 5% annual increase in contributions typically has a larger effect on terminal wealth over 20 years
          than a 1% improvement in annual return. Consistency and contribution growth compound alongside capital.
        </p>
      </div>
    </Shell>
  )
}
