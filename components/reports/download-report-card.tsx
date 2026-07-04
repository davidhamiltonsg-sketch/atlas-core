"use client"

import { useState } from "react"
import { FileDown, Loader2 } from "lucide-react"

const PERIODS = [
  { key: "monthly", label: "Monthly" },
  { key: "quarterly", label: "Quarterly" },
  { key: "annual", label: "Annual" },
] as const

const ACCENT = {
  violet: { icon: "text-violet-500", bg: "bg-violet-500/10", hover: "hover:border-violet-500/40 hover:bg-violet-500/5" },
  sky: { icon: "text-sky-400", bg: "bg-sky-500/10", hover: "hover:border-sky-500/40 hover:bg-sky-500/5" },
} as const

export function DownloadReportCard({
  endpoint,
  accent,
  title = "Download Report",
  subtitle = "A premium, brand-aligned PDF — what's happening, what's changed, what's owned, and what to do next.",
}: {
  endpoint: string
  accent: keyof typeof ACCENT
  title?: string
  subtitle?: string
}) {
  const [loading, setLoading] = useState<string | null>(null)
  const colors = ACCENT[accent]

  async function download(period: string) {
    setLoading(period)
    try {
      const res = await fetch(`${endpoint}?period=${period}`)
      if (!res.ok) throw new Error("Report generation failed")
      const blob = await res.blob()
      const disposition = res.headers.get("Content-Disposition") ?? ""
      const match = disposition.match(/filename="([^"]+)"/)
      const filename = match?.[1] ?? `report-${period}.pdf`
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5 card-elevated">
      <div className="flex items-center gap-3 mb-1">
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${colors.bg} shrink-0`}>
          <FileDown className={`h-4 w-4 ${colors.icon}`} />
        </div>
        <h2 className="text-sm font-bold">{title}</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-4">{subtitle}</p>
      <div className="flex flex-wrap gap-2">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            onClick={() => download(p.key)}
            disabled={loading !== null}
            className={`inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3.5 py-2 text-xs font-semibold text-foreground shadow-sm transition-all disabled:opacity-60 ${colors.hover}`}
          >
            {loading === p.key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
            {p.label}
          </button>
        ))}
      </div>
    </div>
  )
}
