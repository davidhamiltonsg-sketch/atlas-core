import type { PortfolioHealth } from "@/lib/health"
import { cn } from "@/lib/utils"

interface Props {
  health: PortfolioHealth
  constitutionLabel?: string  // e.g. "Art. XXII · Good Standing"
  narrative?: string          // one or two sentence explanation of the score
}

const dimColor = (status: PortfolioHealth["structural"]["status"]) => ({
  excellent: "text-green-600 dark:text-green-400 border-green-500/30",
  good:      "text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  caution:   "text-amber-600 dark:text-amber-400 border-amber-500/30",
  critical:  "text-red-600 dark:text-red-400 border-red-500/30",
}[status])

/** Circular governance score ring with dimension breakdown. */
export function GovernanceSeal({ health, constitutionLabel, narrative }: Props) {
  // SVG ring: r=45 → circumference ≈ 283. dashoffset = 283 × (1 - score/100)
  const r = 45
  const circ = 2 * Math.PI * r
  const offset = circ * (1 - health.overall / 100)
  const scoreColor =
    health.overall >= 80 ? "text-green-600 dark:text-green-400" :
    health.overall >= 65 ? "text-amber-600 dark:text-amber-400" :
    "text-red-600 dark:text-red-400"
  const ringColor =
    health.overall >= 80 ? "stroke-green-500" :
    health.overall >= 65 ? "stroke-amber-500" :
    "stroke-red-500"

  return (
    <div className="rounded-xl border border-border bg-card p-5 flex flex-col sm:flex-row gap-5 items-start sm:items-center">
      {/* Ring */}
      <div className="relative shrink-0 w-24 h-24">
        <svg width="96" height="96" viewBox="0 0 104 104" className="-rotate-90">
          <circle cx="52" cy="52" r={r} fill="none" stroke="currentColor"
            className="text-muted/30" strokeWidth="7" />
          <circle cx="52" cy="52" r={r} fill="none"
            className={ringColor} strokeWidth="7" strokeLinecap="round"
            strokeDasharray={circ} strokeDashoffset={offset} />
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <div className="text-center">
            <span className={`text-2xl font-black tabular-nums ${scoreColor}`}>{health.overall}</span>
            <span className="block text-[9px] font-semibold uppercase tracking-widest text-muted-foreground mt-0.5">Score</span>
          </div>
        </div>
      </div>

      {/* Meta */}
      <div className="flex-1 min-w-0">
        {constitutionLabel && (
          <p className="text-[10px] font-bold uppercase tracking-widest text-primary mb-1">{constitutionLabel}</p>
        )}
        <h2 className="text-base font-bold mb-1">{health.overallLabel}</h2>
        {narrative && (
          <p className="text-xs text-muted-foreground leading-relaxed mb-3">{narrative}</p>
        )}
        <div className="flex flex-wrap gap-2">
          {[health.structural, health.behavioural, health.concentration, health.execution].map((dim) => (
            <span
              key={dim.label}
              className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-md border", dimColor(dim.status))}
              title={dim.citation}
            >
              {dim.label.toUpperCase()} {dim.score}/{
                dim.label === "Structural" ? 40 :
                dim.label === "Behavioural" ? 25 :
                dim.label === "Concentration" ? 25 : 10
              }
              {dim.citation && <span className="opacity-60 ml-1">· {dim.citation}</span>}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
