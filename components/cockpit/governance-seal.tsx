import { cn } from "@/lib/utils"
import { AnimatedNumber } from "@/components/animated-number"

export interface SealDimension {
  label: string
  score: number
  maxScore: number   // weight / max contribution (e.g. 40 for Structural, 25 for Behavioural…)
  status: "excellent" | "good" | "caution" | "critical"
  citation?: string
}

interface Props {
  overall: number
  overallLabel: string
  dimensions: SealDimension[]
  constitutionLabel?: string
  narrative?: string
  // Shown when the score is below 65. Defaults to the Atlas Core wording; Silicon Brick Road
  // passes a plain-English version so no Article citation / "discretionary" jargon leaks in.
  lowScoreWarning?: string
}

const dimBadgeColor = (status: SealDimension["status"]) => ({
  excellent: "text-green-600 dark:text-green-400 border-green-500/30",
  good:      "text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  caution:   "text-amber-600 dark:text-amber-400 border-amber-500/30",
  critical:  "text-red-600 dark:text-red-400 border-red-500/30",
}[status])

/** Circular governance score ring with dimension breakdown. Works for Atlas Core and SBR. */
export function GovernanceSeal({ overall, overallLabel, dimensions, constitutionLabel, narrative,
  lowScoreWarning = "⛔ No new discretionary trade until breach resolved and logged · Art. XXII" }: Props) {
  const r = 45
  const circ = 2 * Math.PI * r
  const offset = circ * (1 - overall / 100)
  const scoreColor =
    overall >= 80 ? "text-green-600 dark:text-green-400" :
    overall >= 65 ? "text-amber-600 dark:text-amber-400" :
    "text-red-600 dark:text-red-400"
  const ringColor =
    overall >= 80 ? "stroke-green-500" :
    overall >= 65 ? "stroke-amber-500" :
    "stroke-red-500"

  return (
    <div className="rounded-xl border border-border bg-card p-5 flex flex-col sm:flex-row gap-5 items-start sm:items-center">
      {/* Ring */}
      <div className="relative shrink-0 w-24 h-24">
        <svg width="96" height="96" viewBox="0 0 104 104" className="-rotate-90">
          <circle cx="52" cy="52" r={r} fill="none" stroke="currentColor"
            className="text-muted/30" strokeWidth="7" />
          <circle cx="52" cy="52" r={r} fill="none"
            className={cn(ringColor, "seal-ring-fill")} strokeWidth="7" strokeLinecap="round"
            strokeDasharray={circ} strokeDashoffset={offset} />
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <div className="text-center">
            <span className={`text-2xl font-display font-black tabular-nums ${scoreColor}`}><AnimatedNumber value={overall} /></span>
            <span className="block text-[9px] font-data font-semibold uppercase tracking-widest text-muted-foreground mt-0.5">Score</span>
          </div>
        </div>
      </div>

      {/* Meta */}
      <div className="flex-1 min-w-0">
        {constitutionLabel && (
          <p className="font-data text-[10px] font-bold uppercase tracking-widest text-primary mb-1">{constitutionLabel}</p>
        )}
        <h2 className="font-display text-base font-bold mb-1">{overallLabel}</h2>
        {narrative && (
          <p className="text-xs text-muted-foreground leading-relaxed mb-3">{narrative}</p>
        )}
        <div className="flex flex-wrap gap-2">
          {dimensions.map((dim) => (
            <span
              key={dim.label}
              className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-md border", dimBadgeColor(dim.status))}
              title={dim.citation}
            >
              {dim.label.toUpperCase()} <AnimatedNumber value={dim.score} />/{dim.maxScore}
              {dim.citation && <span className="opacity-60 ml-1">· {dim.citation}</span>}
            </span>
          ))}
        </div>
        {overall < 65 && (
          <p className="font-data mt-2 text-[10px] font-bold text-red-600 dark:text-red-400 leading-snug">
            {lowScoreWarning}
          </p>
        )}
      </div>
    </div>
  )
}
