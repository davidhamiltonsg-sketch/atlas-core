import type { LadderInstruction, StepStatus } from "@/lib/ladder"

interface Props {
  ladder: LadderInstruction
  monthlyContribution: number
  daysToWindow: number | null   // days until dealing window opens; null = window is open
  windowClosesLabel: string | null  // e.g. "31 Jul"; null = window closed for month
}

const SEVERITY_STYLES = {
  critical: "border-red-500/60 bg-red-500/[0.08] text-red-700 dark:text-red-300",
  high:     "border-amber-500/60 bg-amber-500/[0.08] text-amber-700 dark:text-amber-300",
  medium:   "border-indigo-500/40 bg-indigo-500/[0.08] text-indigo-700 dark:text-indigo-300",
  low:      "border-border bg-card/60 text-foreground",
  none:     "border-border bg-card/60 text-foreground",
}

const stepStatusLabel: Record<StepStatus, string> = {
  fired:      "FIRED",
  passed:     "CLEAR",
  warning:    "WARN",
  not_reached: "—",
}

const stepStatusColor: Record<StepStatus, string> = {
  fired:       "text-amber-500 font-bold",
  passed:      "text-green-500",
  warning:     "text-amber-400",
  not_reached: "text-muted-foreground/40",
}

/** Art. XIII Decision Ladder — 8-step display with instruction block. */
export function DecisionLadderCard({ ladder, monthlyContribution, daysToWindow, windowClosesLabel }: Props) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-border flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Art. XIII · Decision Ladder</p>
          <p className="text-sm font-semibold mt-0.5">{ladder.headline}</p>
        </div>
        {daysToWindow !== null ? (
          <span className="shrink-0 text-[10px] font-semibold px-2.5 py-1 rounded-full border border-muted-foreground/30 text-muted-foreground">
            WINDOW IN {daysToWindow}d
          </span>
        ) : windowClosesLabel ? (
          <span className="shrink-0 text-[10px] font-bold px-2.5 py-1 rounded-full border border-green-500/40 bg-green-500/10 text-green-600 dark:text-green-400">
            WINDOW OPEN · CLOSES {windowClosesLabel}
          </span>
        ) : null}
      </div>

      {/* 8 steps */}
      <div className="divide-y divide-border/60">
        {ladder.steps.map((step) => (
          <div
            key={step.step}
            className={`px-5 py-2.5 flex items-center gap-3 ${step.status === "fired" ? "bg-amber-500/[0.05]" : ""}`}
          >
            <span className="shrink-0 w-5 h-5 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold text-muted-foreground">
              {step.step}
            </span>
            <div className="flex-1 min-w-0">
              <p className={`text-xs font-medium ${step.status === "not_reached" ? "text-muted-foreground/50" : ""}`}>{step.label}</p>
              {step.reason && <p className="text-[10px] text-muted-foreground truncate">{step.reason}</p>}
            </div>
            <span className={`shrink-0 text-[10px] tabular-nums ${stepStatusColor[step.status]}`}>
              {stepStatusLabel[step.status]}
            </span>
          </div>
        ))}
      </div>

      {/* Instruction block */}
      <div className={`m-4 rounded-lg border p-4 ${SEVERITY_STYLES[ladder.severity]}`}>
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider opacity-70 mb-1">{ladder.citation}</p>
            <p className="text-sm font-semibold leading-snug mb-1.5">{ladder.instruction}</p>
            <p className="text-xs opacity-80 leading-relaxed">{ladder.rationale}</p>
          </div>
        </div>
        <div className="mt-3 pt-3 border-t border-current/20 flex items-center justify-between gap-3">
          <p className="text-[11px] opacity-70">{ladder.when}</p>
          {ladder.ticker && (
            <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded bg-current/10 tabular-nums">
              {ladder.ticker}
            </span>
          )}
        </div>
      </div>

      {/* Exceptions */}
      {ladder.exceptions.length > 0 && (
        <div className="mx-4 mb-4 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 mb-1.5">
            {ladder.exceptions.length} Exception{ladder.exceptions.length > 1 ? "s" : ""} logged
          </p>
          <ul className="space-y-1">
            {ladder.exceptions.map((ex, i) => (
              <li key={i} className="text-[11px] text-amber-700 dark:text-amber-300/90 leading-relaxed">· {ex}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
