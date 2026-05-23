import { Shell } from "@/components/shell"
import { TrendingUp } from "lucide-react"

const scenarios = [
  {
    label: "Conservative",
    rate: "5%",
    years: [
      { label: "10yr", value: "—" },
      { label: "15yr", value: "—" },
      { label: "20yr", value: "—" },
    ],
  },
  {
    label: "Base Case",
    rate: "8%",
    years: [
      { label: "10yr", value: "—" },
      { label: "15yr", value: "—" },
      { label: "20yr", value: "—" },
    ],
  },
  {
    label: "Optimistic",
    rate: "11%",
    years: [
      { label: "10yr", value: "—" },
      { label: "15yr", value: "—" },
      { label: "20yr", value: "—" },
    ],
  },
]

export default function Forecast() {
  return (
    <Shell
      title="Forecast Engine"
      subtitle="Long-term compounding trajectories"
    >
      {/* Principle callout */}
      <div className="mb-5 rounded-xl border border-border bg-card p-4">
        <p className="text-xs text-muted-foreground leading-relaxed max-w-2xl">
          <span className="font-semibold text-foreground">The point is not prediction.</span>{" "}
          The point is making long-term compounding emotionally visible. Humans struggle to
          process exponential growth — these models exist to make staying the course feel
          rational and worthwhile.
        </p>
      </div>

      {/* Scenarios */}
      <div className="grid gap-4 md:grid-cols-3">
        {scenarios.map(({ label, rate, years }) => (
          <div key={label} className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-semibold">{label}</h3>
              <span className="text-xs text-muted-foreground">{rate} p.a.</span>
            </div>
            <p className="text-[11px] text-muted-foreground mb-4">
              Assumed annual return (nominal)
            </p>
            <div className="space-y-3">
              {years.map(({ label: yr, value }) => (
                <div key={yr} className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{yr}</span>
                  <span className="text-sm font-semibold">{value}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Chart placeholder */}
      <div className="mt-6 rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold">Growth Trajectory</h2>
        </div>
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent">
            <TrendingUp className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium">Chart requires portfolio data</p>
            <p className="mt-1 text-xs text-muted-foreground max-w-xs leading-relaxed">
              Add your current portfolio value and monthly contribution in the Portfolio
              section to generate your compounding trajectory.
            </p>
          </div>
          <a
            href="/portfolio"
            className="mt-1 flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90 transition-opacity"
          >
            Set up portfolio
          </a>
        </div>
      </div>
    </Shell>
  )
}
