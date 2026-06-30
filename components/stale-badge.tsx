import { AlertTriangle } from "lucide-react"

// Shared STALE indicator — shown wherever a live figure has fallen back to the last
// verified value (Finnhub unavailable). Consistent amber pill across the app.
export function StaleBadge({ label = "STALE", title }: { label?: string; title?: string }) {
  return (
    <span
      title={title ?? "Live data unavailable — showing the last verified figures."}
      className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-1 ring-amber-500/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide"
    >
      <AlertTriangle className="h-2.5 w-2.5" /> {label}
    </span>
  )
}
