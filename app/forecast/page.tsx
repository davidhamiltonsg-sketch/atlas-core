import { Shell } from "@/components/shell"
import { db } from "@/lib/db"
import { formatCurrency } from "@/lib/utils"
import { TrendingUp, Landmark, Zap } from "lucide-react"
import { getSession } from "@/lib/session"
import { redirect } from "next/navigation"
import { ForecastChartPanel, type ExtendedForecastPoint, type MilestoneMarker } from "@/components/charts/forecast-chart-panel"

const SINGAPORE_SAVINGS_RATE = 0.030
const VT_HISTORICAL_RATE = 0.095  // VT (Total World) 9.5% p.a. long-run historical CAGR
const CONE_VOL = 0.15  // annual return volatility for P10/P90 band

const returnScenarios = [
  { label: "Conservative", rate: 0.05, rateLabel: "5% p.a.", color: "#a78bfa" },
  { label: "Base Case",    rate: 0.10, rateLabel: "10% p.a.", color: "#6366f1" },
  { label: "Aggressive",  rate: 0.15, rateLabel: "15% p.a.", color: "#22c55e" },
]

const horizons = [10, 15, 19]

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
    value += annualLumpSum // annual top-up applied every year (incl. the first)
  }
  return value
}

function toReal(nominal: number, years: number, cpi = 0.025): number {
  return nominal / Math.pow(1 + cpi, years)
}

// Log-normal P10/P90 cone around the base projection.
// Approximation: scale base value by exp(±1.28 × σ × √n).
// This is conservative since contributions reduce variance vs. lump-sum.
function coneProjection(base: number, yr: number, z: number): number {
  if (yr === 0) return base
  return base * Math.exp(z * CONE_VOL * Math.sqrt(yr))
}

async function getForecastData(userId: string) {
  const holdings = await db.holding.findMany({
    where: { userId },
    include: { snapshots: { orderBy: { date: "desc" }, take: 1 } },
  })
  return holdings.reduce((sum, h) => sum + (h.snapshots[0]?.value ?? 0), 0)
}

export default async function Forecast() {
  const session = await getSession()
  if (!session) redirect("/login")

  const [currentValue, user] = await Promise.all([
    getForecastData(session.userId),
    db.user.findUnique({ where: { id: session.userId } }),
  ])

  const MONTHLY_CONTRIBUTION = user?.monthlyContribution ?? 3000
  const ANNUAL_LUMP_SUM = user?.annualLumpSum ?? 20000
  const CONTRIBUTION_GROWTH_RATE = user?.contributionGrowthRate ?? 0.05

  const startYear = new Date().getFullYear()

  // Build year-by-year chart data (current year → 2045)
  const chartData: ExtendedForecastPoint[] = []
  for (let yr = 0; yr <= 19; yr++) {
    const year = startYear + yr
    const conservative = yr === 0 ? currentValue : projectPortfolio(currentValue, MONTHLY_CONTRIBUTION, ANNUAL_LUMP_SUM, 0.05, yr, CONTRIBUTION_GROWTH_RATE)
    const base         = yr === 0 ? currentValue : projectPortfolio(currentValue, MONTHLY_CONTRIBUTION, ANNUAL_LUMP_SUM, 0.10, yr, CONTRIBUTION_GROWTH_RATE)
    const aggressive   = yr === 0 ? currentValue : projectPortfolio(currentValue, MONTHLY_CONTRIBUTION, ANNUAL_LUMP_SUM, 0.15, yr, CONTRIBUTION_GROWTH_RATE)
    const savings      = yr === 0 ? currentValue : projectPortfolio(currentValue, MONTHLY_CONTRIBUTION, ANNUAL_LUMP_SUM, SINGAPORE_SAVINGS_RATE, yr, CONTRIBUTION_GROWTH_RATE)
    const vtBenchmark  = yr === 0 ? currentValue : projectPortfolio(currentValue, MONTHLY_CONTRIBUTION, ANNUAL_LUMP_SUM, VT_HISTORICAL_RATE, yr, CONTRIBUTION_GROWTH_RATE)
    const coneP10      = coneProjection(base, yr, -1.28)
    const coneP90      = coneProjection(base, yr,  1.28)
    const contribLow   = yr === 0 ? currentValue : projectPortfolio(currentValue, MONTHLY_CONTRIBUTION * 0.8, ANNUAL_LUMP_SUM, 0.10, yr, CONTRIBUTION_GROWTH_RATE)
    const contribHigh  = yr === 0 ? currentValue : projectPortfolio(currentValue, MONTHLY_CONTRIBUTION * 1.2, ANNUAL_LUMP_SUM, 0.10, yr, CONTRIBUTION_GROWTH_RATE)
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
    projected: projectPortfolio(currentValue, MONTHLY_CONTRIBUTION, ANNUAL_LUMP_SUM, SINGAPORE_SAVINGS_RATE, years, CONTRIBUTION_GROWTH_RATE),
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
          <p className="mt-0.5 text-[11px] text-muted-foreground">10% p.a. · 19 years</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 card-elevated">
          <p className="text-xs text-muted-foreground">Aggressive — 2045</p>
          <p className="mt-1 text-xl font-black tabular-nums text-green-500">{fmtM(aggressive2045)}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">15% p.a. · 19 years</p>
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
          { label: "Monthly Contribution", value: `$${MONTHLY_CONTRIBUTION.toLocaleString()}`, sub: "USD/month" },
          { label: "Annual Lump Sum",       value: `$${ANNUAL_LUMP_SUM.toLocaleString()}`, sub: "USD/year" },
          { label: "Contribution Growth",   value: `${(CONTRIBUTION_GROWTH_RATE * 100).toFixed(0)}% p.a.`, sub: "Annual increase" },
          { label: "Horizon",               value: "2045", sub: "19 years remaining" },
        ].map(({ label, value, sub }) => (
          <div key={label} className="rounded-xl border border-border bg-card p-4 card-elevated flex flex-col gap-1.5">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
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
          <span className="text-xs text-muted-foreground ml-auto">{(SINGAPORE_SAVINGS_RATE * 100).toFixed(1)}% p.a.</span>
        </div>
        <p className="text-[11px] text-muted-foreground mb-5">
          Singapore high-yield savings / fixed deposit rate (approximate) · same contributions · USD-denominated
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
                  className="h-full rounded-full bg-slate-400/50"
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
            Starting {fmtM(currentValue)} · ${MONTHLY_CONTRIBUTION.toLocaleString()} USD/mo + ${ANNUAL_LUMP_SUM.toLocaleString()} USD/yr · contributions +{(CONTRIBUTION_GROWTH_RATE * 100).toFixed(0)}% p.a.
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
            Bank savings rate approximates Singapore DBS/OCBC/UOB high-yield savings and fixed deposit rates as of 2025.
            "Base vs Savings" shows how many times larger the base case portfolio becomes versus the savings reference.
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
