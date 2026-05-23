import { Shell } from "@/components/shell"
import { PieChart, Plus } from "lucide-react"

const defaultHoldings = [
  { ticker: "VT", name: "Vanguard Total World Stock ETF", target: 40, color: "#6366f1" },
  { ticker: "QQQM", name: "Invesco NASDAQ 100 ETF", target: 22.5, color: "#8b5cf6" },
  { ticker: "SMH", name: "VanEck Semiconductor ETF", target: 10, color: "#a78bfa" },
  { ticker: "VWO", name: "Vanguard Emerging Markets ETF", target: 10, color: "#c4b5fd" },
  { ticker: "BTC", name: "Bitcoin", target: 5, color: "#f59e0b" },
]

export default function Portfolio() {
  return (
    <Shell
      title="Portfolio Architecture"
      subtitle="Holdings, target allocations, and hard caps"
    >
      {/* Holdings table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold">Holdings</h2>
          <button className="flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90 transition-opacity">
            <Plus className="h-3 w-3" />
            Add Holding
          </button>
        </div>

        {/* Empty state */}
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent">
            <PieChart className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium">No holdings yet</p>
            <p className="mt-1 text-xs text-muted-foreground max-w-xs">
              Add your positions to start tracking allocation, drift, and governance metrics.
            </p>
          </div>
          <button className="mt-1 flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90 transition-opacity">
            <Plus className="h-3 w-3" />
            Add your first holding
          </button>
        </div>
      </div>

      {/* Suggested structure */}
      <div className="mt-6 rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">Suggested Portfolio Structure</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Based on your Atlas Core framework. Adjust to match your actual positions.
        </p>
        <div className="mt-4 divide-y divide-border rounded-lg border border-border overflow-hidden">
          {defaultHoldings.map(({ ticker, name, target, color }) => (
            <div
              key={ticker}
              className="flex items-center justify-between px-4 py-3 bg-card hover:bg-accent/40 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: color }}
                />
                <div>
                  <p className="text-xs font-semibold">{ticker}</p>
                  <p className="text-[11px] text-muted-foreground">{name}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs font-semibold">{target}%</p>
                <p className="text-[11px] text-muted-foreground">target</p>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">
          Remaining 12.5% can be held as cash or allocated to future positions.
        </p>
      </div>
    </Shell>
  )
}
