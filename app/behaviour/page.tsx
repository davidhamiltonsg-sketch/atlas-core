import { Shell } from "@/components/shell"
import { Brain, AlertTriangle, CheckCircle2 } from "lucide-react"
import { getSession } from "@/lib/session"
import { redirect } from "next/navigation"
import { db } from "@/lib/db"
import { BehaviourLogForm } from "@/components/behaviour/behaviour-log-form"

const principles = [
  "Long-term wealth is destroyed behaviourally before it is destroyed mathematically.",
  "Intelligent people are especially vulnerable to over-optimisation.",
  "Consistency and emotional stability are core investment variables.",
  "Boredom is not a reason to restructure a working portfolio.",
  "A drawdown is not a signal. It is a test of your framework.",
]

const checkItems = [
  "Am I acting on data or emotion?",
  "Is this a rule-based decision or a feeling?",
  "Has it been 90+ days since my last structural change?",
  "Have I waited 48 hours before acting on this impulse?",
  "Would I be comfortable explaining this decision in 10 years?",
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
      {/* Core principles */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-2 mb-4">
          <Brain className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Core Principles</h2>
        </div>
        <ul className="space-y-3">
          {principles.map((p, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-foreground text-background text-[9px] font-bold">
                {i + 1}
              </span>
              <p className="text-xs text-muted-foreground leading-relaxed">{p}</p>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {/* Decision checklist */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Decision Checklist</h2>
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            Run this before making any portfolio change.
          </p>
          <div className="space-y-2">
            {checkItems.map(label => (
              <label key={label} className="flex items-start gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-border accent-foreground cursor-pointer"
                />
                <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors leading-relaxed">
                  {label}
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Interactive behaviour log */}
        <BehaviourLogForm initialLogs={serialisedLogs} />
      </div>

      {/* Warning zone */}
      <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-500">Behavioural Red Flags</p>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              If you are checking your portfolio daily, feeling urgency to act, comparing
              to benchmarks obsessively, or planning a structural redesign — stop. Wait 48
              hours. Re-read your governance rules. Then decide.
            </p>
          </div>
        </div>
      </div>
    </Shell>
  )
}
