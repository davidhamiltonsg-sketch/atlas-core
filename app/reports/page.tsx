import { Shell } from "@/components/shell"
import { FileBarChart2, AlertCircle } from "lucide-react"

const reportSections = [
  { label: "Portfolio Health Score", value: "—", desc: "Add holdings to generate" },
  { label: "Total Value", value: "—", desc: "No snapshot recorded" },
  { label: "Largest Drift", value: "—", desc: "No holdings entered" },
  { label: "Concentration Risk", value: "—", desc: "Requires portfolio data" },
]

export default function Reports() {
  return (
    <Shell
      title="Reports"
      subtitle="Institutional-style portfolio intelligence"
    >
      {/* No data notice */}
      <div className="mb-5 flex items-start gap-3 rounded-xl border border-border bg-card p-4">
        <AlertCircle className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          Reports will populate once you have added holdings and recorded at least one
          portfolio snapshot in the{" "}
          <a href="/portfolio" className="text-foreground underline underline-offset-2">
            Portfolio
          </a>{" "}
          section.
        </p>
      </div>

      {/* Report metrics */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {reportSections.map(({ label, value, desc }) => (
          <div
            key={label}
            className="rounded-xl border border-border bg-card p-4 flex flex-col gap-2"
          >
            <span className="text-xs font-medium text-muted-foreground">{label}</span>
            <p className="text-2xl font-semibold tracking-tight">{value}</p>
            <p className="text-[11px] text-muted-foreground">{desc}</p>
          </div>
        ))}
      </div>

      {/* Report preview */}
      <div className="mt-6 rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold">Portfolio Review</h2>
          <span className="text-xs text-muted-foreground">No data</span>
        </div>
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent">
            <FileBarChart2 className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium">No report available</p>
            <p className="mt-1 text-xs text-muted-foreground max-w-xs leading-relaxed">
              Add your holdings, enter a portfolio snapshot, and your institutional-style
              review will generate here — calm, editorial, and psychologically stabilising.
            </p>
          </div>
        </div>
      </div>
    </Shell>
  )
}
