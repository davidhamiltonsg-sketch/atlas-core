"use client"

import { Download, PieChart, Camera, ArrowLeftRight, PiggyBank, Coins } from "lucide-react"

const EXPORTS = [
  {
    type: "portfolio",
    label: "Current Portfolio",
    description: "Latest snapshot per holding — ticker, units, price, value, target allocation.",
    icon: PieChart,
    color: "text-indigo-400",
  },
  {
    type: "snapshots",
    label: "All Snapshots",
    description: "Full snapshot history for every holding, ordered by date. Use this for charting or external analysis.",
    icon: Camera,
    color: "text-violet-400",
  },
  {
    type: "trades",
    label: "Trade Log",
    description: "All buy/sell transactions — ticker, type, units, price, FX rate, and total amount.",
    icon: ArrowLeftRight,
    color: "text-blue-400",
  },
  {
    type: "contributions",
    label: "Contributions",
    description: "Monthly contribution records — date and amount in USD.",
    icon: PiggyBank,
    color: "text-green-400",
  },
  {
    type: "dividends",
    label: "Dividends",
    description: "Dividend payment records — ticker, date, amount in SGD, and per-unit yield.",
    icon: Coins,
    color: "text-yellow-400",
  },
]

export function ExportButtons() {
  function download(type: string) {
    window.location.href = `/api/export?type=${type}`
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="text-xs text-muted-foreground leading-relaxed">
          All exports are in <span className="font-semibold text-foreground">CSV format</span> — compatible with Excel, Google Sheets, and any data analysis tool.
          Files are generated on-demand from your current data. No data leaves your local server.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {EXPORTS.map(({ type, label, description, icon: Icon, color }) => (
          <div key={type} className="rounded-xl border border-border bg-card p-5 flex flex-col gap-3 hover:bg-accent/20 transition-colors">
            <div className="flex items-start gap-3">
              <Icon className={`h-5 w-5 shrink-0 mt-0.5 ${color}`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">{label}</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{description}</p>
              </div>
            </div>
            <button
              onClick={() => download(type)}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-border bg-background hover:bg-accent/60 text-xs font-semibold px-4 py-2 transition-colors mt-auto"
            >
              <Download className="h-3.5 w-3.5" />
              Download CSV
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
