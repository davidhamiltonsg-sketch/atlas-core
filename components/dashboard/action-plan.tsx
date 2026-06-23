import { Clock, ArrowRight } from "lucide-react"
import { ACTION_PLAN, URGENCY_STYLES } from "@/lib/action-plan"

// The dashboard's source-of-truth action sequence. Renders the SAME steps the
// Command Centre's "When to Act" calendar shows (both read from lib/action-plan),
// but as an always-visible, numbered step-by-step timeline so the plan is
// unmistakable at a glance — every step shows WHEN, WHAT, and WHY.
export function ActionPlan() {
  const criticalCount = ACTION_PLAN.filter((a) => a.urgency === "CRITICAL").length
  const thisWeekCount = ACTION_PLAN.filter((a) => a.when === "Right now" || a.when === "This week").length

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Intro / legend */}
      <div className="px-5 py-3 border-b border-border bg-muted/30 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground leading-relaxed">
          <span className="font-semibold text-foreground">Your plan, in order.</span>{" "}
          Do them top to bottom. Each step says exactly <span className="font-semibold text-foreground">when</span> to act,{" "}
          <span className="font-semibold text-foreground">what</span> to do, and <span className="font-semibold text-foreground">why</span>.
        </p>
        <div className="flex items-center gap-3 shrink-0">
          {criticalCount > 0 && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/10 text-red-600 dark:text-red-400">
              {criticalCount} do now
            </span>
          )}
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
            {thisWeekCount} this week
          </span>
        </div>
      </div>

      {/* Numbered, time-staged steps */}
      <ol className="divide-y divide-border">
        {ACTION_PLAN.map((step, i) => {
          const styles = URGENCY_STYLES[step.urgency]
          return (
            <li key={i} className="flex items-start gap-4 px-5 py-4">
              {/* Step number + connector dot */}
              <div className="shrink-0 flex flex-col items-center">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-[11px] font-black text-primary">
                  {i + 1}
                </div>
                <span className={`mt-2 h-2 w-2 rounded-full ${styles.dot}`} />
              </div>

              <div className="flex-1 min-w-0">
                {/* When + urgency + ticker */}
                <div className="flex flex-wrap items-center gap-2 mb-1.5">
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-foreground">
                    <Clock className="h-3 w-3 text-muted-foreground" />
                    {step.when}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${styles.badge}`}>
                    {step.urgency}
                  </span>
                  <span className="text-[10px] font-bold text-indigo-500 dark:text-indigo-400">{step.ticker}</span>
                </div>

                {/* What — the action, unmissable */}
                <p className="text-sm font-semibold leading-snug mb-1.5">{step.what}</p>

                {/* Why — the reasoning */}
                <p className="text-xs text-muted-foreground leading-relaxed">
                  <span className="font-semibold text-foreground/70">Why: </span>
                  {step.why}
                </p>
              </div>
            </li>
          )
        })}
      </ol>

      {/* Footer link to the full Command Centre view */}
      <div className="px-5 py-3 border-t border-border bg-muted/20 flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">
          {ACTION_PLAN.length} steps · the same plan drives your Next Best Move
        </span>
        <a
          href="/command-centre"
          className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-primary hover:underline"
        >
          Full plan in Command Centre
          <ArrowRight className="h-3.5 w-3.5" />
        </a>
      </div>
    </div>
  )
}
