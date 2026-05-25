import { Shell } from "@/components/shell"
import { Brain, AlertTriangle, CheckCircle2, Clock, BarChart3 } from "lucide-react"
import { getSession } from "@/lib/session"
import { redirect } from "next/navigation"
import { db } from "@/lib/db"
import { BehaviourLogForm } from "@/components/behaviour/behaviour-log-form"

const principles = [
  {
    text: "Long-term wealth is destroyed behaviourally before it is destroyed mathematically.",
    icon: BarChart3,
  },
  {
    text: "Intelligent people are especially vulnerable to over-optimisation.",
    icon: Brain,
  },
  {
    text: "Consistency and emotional stability are core investment variables.",
    icon: CheckCircle2,
  },
  {
    text: "Boredom is not a reason to restructure a working portfolio.",
    icon: Clock,
  },
  {
    text: "A drawdown is not a signal. It is a test of your framework.",
    icon: AlertTriangle,
  },
]

const checkItems = [
  "Am I acting on data or emotion?",
  "Is this a rule-based decision or a feeling?",
  "Has it been 90+ days since my last structural change?",
  "Have I waited 48 hours before acting on this impulse?",
  "Would I be comfortable explaining this decision in 10 years?",
]

const redFlags = [
  "Checking the portfolio more than once a week",
  "Feeling urgency or anxiety to act immediately",
  "Comparing performance obsessively to benchmarks or others",
  "Planning a structural redesign within 18 months of the last one",
  "Making changes during a market drawdown",
]

export default async function Behaviour() {
  const session = await getSession()
  if (!session) redirect("/login")

  const logs = await db.behaviourLog.findMany({
    where: { userId: session.userId },
    orderBy: { date: "desc" },
    take: 50,
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const serialisedLogs = (logs as any[]).map((l) => ({
    id: l.id,
    type: l.type,
    note: l.note,
    date: l.date.toISOString(),
  }))

  return (
    <Shell
      title="Behavioural System"
      subtitle="Discipline, stability, and long-term consistency"
      userName={session.name}
    >
      {/* Manifesto hero */}
      <div className="mb-6 rounded-xl border border-primary/20 bg-gradient-to-br from-primary/[0.06] to-primary/[0.02] p-6">
        <div className="flex items-start gap-4">
          <div className="shrink-0 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15">
            <Brain className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-primary mb-2">Behavioural Mandate</p>
            <blockquote className="text-lg font-bold leading-snug text-foreground mb-3">
              "The market rewards patience. It punishes reactivity. Your edge is staying the course when others cannot."
            </blockquote>
            <p className="text-xs text-muted-foreground leading-relaxed max-w-2xl">
              Atlas Core is a 2045 system. Every rule, threshold, and alert exists to protect you from yourself during volatile periods.
              Before taking any action outside your monthly contribution schedule, run the decision checklist below.
            </p>
          </div>
        </div>
      </div>

      {/* Principles grid */}
      <div className="mb-6">
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Core Principles</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {principles.map(({ text, icon: Icon }, i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-4 flex items-start gap-3">
              <div className="shrink-0 flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 mt-0.5">
                <Icon className="h-3.5 w-3.5 text-primary" />
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{text}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 mb-6">
        {/* Decision checklist */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">Pre-Action Checklist</h2>
          </div>
          <p className="text-xs text-muted-foreground mb-4 ml-6">
            All five must be true before making any portfolio change.
          </p>
          <div className="space-y-3">
            {checkItems.map((label, i) => (
              <label key={label} className="flex items-start gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-border accent-primary cursor-pointer"
                />
                <div className="flex items-start gap-2">
                  <span className="shrink-0 text-[10px] font-bold text-muted-foreground/50 mt-0.5 w-4">{i + 1}.</span>
                  <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors leading-relaxed">
                    {label}
                  </span>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Interactive behaviour log */}
        <BehaviourLogForm initialLogs={serialisedLogs} />
      </div>

      {/* Red flags */}
      <div className="rounded-xl border border-red-500/20 bg-red-500/[0.04] p-5">
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
          <div>
            <p className="text-sm font-bold text-red-600 dark:text-red-400">Behavioural Red Flags</p>
            <p className="text-[11px] text-muted-foreground">If any of these apply, stop. Wait 48 hours. Re-read your governance rules. Then decide.</p>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {redFlags.map((flag, i) => (
            <div key={i} className="flex items-start gap-2 rounded-lg bg-red-500/[0.05] border border-red-500/10 px-3 py-2.5">
              <div className="shrink-0 h-1.5 w-1.5 rounded-full bg-red-500 mt-1.5" />
              <p className="text-xs text-red-700 dark:text-red-300 leading-relaxed">{flag}</p>
            </div>
          ))}
        </div>
      </div>
    </Shell>
  )
}
