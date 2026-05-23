import { Shell } from "@/components/shell"
import { db } from "@/lib/db"
import { formatCurrency, formatPercent } from "@/lib/utils"
import { TrendingUp, Landmark } from "lucide-react"
import { getSession } from "@/lib/session"
import { redirect } from "next/navigation"

const MONTHLY_CONTRIBUTION = 3000      // USD
const ANNUAL_LUMP_SUM = 20000          // USD
const CONTRIBUTION_GROWTH_RATE = 0.05  // 5% annually

// Singapore reference savings rate (approximate blended rate, SGD fixed deposits / high-yield savings 2025)
// Applied to USD contributions as an opportunity cost benchmark
const SINGAPORE_SAVINGS_RATE = 0.030  // 3% p.a.

const returnScenarios = [
  { label: "Conservative", rate: 0.05, rateLabel: "5% p.a.", dimmed: false },
  { label: "Base Case",    rate: 0.10, rateLabel: "10% p.a.", dimmed: false },
  { label: "Aggressive",   rate: 0.15, rateLabel: "15% p.a.", dimmed: false },
]

const horizons = [10, 15, 19]  // 19 years = 2045 horizon

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
    if (year > 0) {
      value += annualLumpSum
    }
  }

  return value
}

async function getForecastData(userId: string) {
  const holdings = await db.holding.findMany({
    where: { userId },
    include: { snapshots: { orderBy: { date: "desc" }, take: 1 } },
  })
  const currentValue = holdings.reduce((sum, h) => sum + (h.snapshots[0]?.value ?? 0), 0)
  return currentValue
}

export default async function Forecast() {
  const session = await getSession()
  if (!session) redirect("/login")
  const currentValue = await getForecastData(session.userId)

  const projections = returnScenarios.map((scenario) => ({
    ...scenario,
    values: horizons.map((years) => ({
      years,
      projected: projectPortfolio(
        currentValue,
        MONTHLY_CONTRIBUTION,
        ANNUAL_LUMP_SUM,
        scenario.rate,
        years,
        CONTRIBUTION_GROWTH_RATE
      ),
    })),
  }))

  const savingsValues = horizons.map((years) => ({
    years,
    projected: projectPortfolio(
      currentValue,
      MONTHLY_CONTRIBUTION,
      ANNUAL_LUMP_SUM,
      SINGAPORE_SAVINGS_RATE,
      years,
      CONTRIBUTION_GROWTH_RATE
    ),
  }))

  // Max projection for bar scaling (aggressive 19yr)
  const maxProjected = projections[2].values[2].projected

  return (
    <Shell title="Forecast Engine" subtitle="Long-term compounding trajectories — 2045 horizon" userName={session.name}>

      {/* Principle */}
      <div className="mb-5 rounded-xl border border-border bg-card p-4">
        <p className="text-xs text-muted-foreground leading-relaxed max-w-2xl">
          <span className="font-semibold text-foreground">The point is not prediction.</span>{" "}
          The point is making long-term compounding emotionally visible. These models exist to
          make staying the course feel rational and worthwhile. Forecasts are probabilistic —
          markets are non-linear and volatility is inevitable.
        </p>
      </div>

      {/* Assumptions */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Current Portfolio", value: formatCurrency(currentValue, "USD") },
          { label: "Monthly Contribution", value: formatCurrency(MONTHLY_CONTRIBUTION, "USD") },
          { label: "Annual Lump Sum", value: formatCurrency(ANNUAL_LUMP_SUM, "USD") },
          { label: "Contribution Growth", value: `${(CONTRIBUTION_GROWTH_RATE * 100).toFixed(0)}% p.a.` },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-1 text-base font-semibold">{value}</p>
          </div>
        ))}
      </div>

      {/* Scenario cards */}
      <div className="grid gap-4 md:grid-cols-3 mb-4">
        {projections.map(({ label, rateLabel, values }) => (
          <div key={label} className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-semibold">{label}</h3>
              <span className="text-xs text-muted-foreground">{rateLabel}</span>
            </div>
            <p className="text-[11px] text-muted-foreground mb-5">Nominal annual return assumed</p>
            <div className="space-y-4">
              {values.map(({ years, projected }) => (
                <div key={years}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-muted-foreground">{years === 19 ? "19-year (2045)" : `${years}-year`} projection</span>
                    <span className="text-sm font-semibold">{formatCurrency(projected, "USD")}</span>
                  </div>
                  <div className="h-1 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-foreground/30"
                      style={{ width: `${Math.min(100, (projected / maxProjected) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Singapore savings comparison card */}
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
                <span className="text-xs text-muted-foreground">{years === 19 ? "19-year (2045)" : `${years}-year`} reference</span>
                <span className="text-sm font-semibold text-muted-foreground">{formatCurrency(projected, "USD")}</span>
              </div>
              <div className="h-1 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-muted-foreground/40"
                  style={{ width: `${Math.min(100, (projected / maxProjected) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Summary table — all scenarios + savings comparison */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold">Projection Summary</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Starting value {formatCurrency(currentValue, "USD")} · {formatCurrency(MONTHLY_CONTRIBUTION, "USD")}/mo + {formatCurrency(ANNUAL_LUMP_SUM, "USD")}/yr lump sum · contributions growing {(CONTRIBUTION_GROWTH_RATE * 100).toFixed(0)}% annually
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="px-5 py-2.5 text-left font-medium text-muted-foreground">Horizon</th>
                {returnScenarios.map((s) => (
                  <th key={s.label} className="px-5 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap">
                    {s.label} ({s.rateLabel})
                  </th>
                ))}
                <th className="px-5 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap border-l border-border">
                  Bank Savings ({(SINGAPORE_SAVINGS_RATE * 100).toFixed(0)}% p.a.)
                </th>
                <th className="px-5 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap">
                  Base vs Savings
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {horizons.map((years) => {
                const savings = savingsValues.find((v) => v.years === years)!.projected
                const baseCase = projections[1].values.find((v) => v.years === years)!.projected
                const multiplier = baseCase / savings
                return (
                  <tr key={years} className="hover:bg-accent/30 transition-colors">
                    <td className="px-5 py-3 font-medium">{years === 19 ? "19 years (2045)" : `${years} years`}</td>
                    {projections.map(({ label, values }) => {
                      const val = values.find((v) => v.years === years)!
                      return (
                        <td key={label} className="px-5 py-3 text-right font-semibold">
                          {formatCurrency(val.projected, "USD")}
                        </td>
                      )
                    })}
                    <td className="px-5 py-3 text-right text-muted-foreground border-l border-border">
                      {formatCurrency(savings, "USD")}
                    </td>
                    <td className="px-5 py-3 text-right font-semibold text-green-500">
                      {multiplier.toFixed(1)}x
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
            Actual rates vary by product, balance tier, and conditions. Applied to USD contributions as an opportunity cost reference only — not a like-for-like SGD comparison.
            "Base vs Savings" shows how many times larger the base case portfolio becomes versus the savings reference at the same horizon.
          </p>
        </div>
      </div>

      {/* Compounding note */}
      <div className="mt-4 flex items-start gap-3 rounded-xl border border-border bg-card p-4">
        <TrendingUp className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          <span className="font-semibold text-foreground">Increasing contributions is often more powerful than optimising returns.</span>{" "}
          A 5% annual increase in contributions typically has a larger effect on terminal wealth over 20 years
          than a 1% improvement in annual return. Consistency and contribution growth compound alongside capital.
        </p>
      </div>
    </Shell>
  )
}
