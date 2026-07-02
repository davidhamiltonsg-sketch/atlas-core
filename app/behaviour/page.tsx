import { Shell } from "@/components/shell"
import { Brain, AlertTriangle, CheckCircle2, Clock, BarChart3 } from "lucide-react"
import { getSession } from "@/lib/session"
import { redirect } from "next/navigation"
import { db } from "@/lib/db"
import { BehaviourLogForm } from "@/components/behaviour/behaviour-log-form"
import { constitutionIdForEmail } from "@/lib/constitutions"

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
  "Consulting the governance document looking for permission to break its rules",
]

const prohibitedActions = [
  { action: "Panic selling on drawdown", rationale: "Realises temporary loss permanently." },
  { action: "Adding new tickers", rationale: "Increases complexity, dilutes conviction. Five tickers only." },
  { action: "Chasing recent outperformers", rationale: "Buying after a run = buying high. No momentum additions." },
  { action: "Reducing DCA during volatility", rationale: "Drawdowns are the highest-value deployment window." },
  { action: "Reactive rebalancing", rationale: "Driven by noise rather than drift thresholds is trading, not rebalancing." },
  { action: "Leveraged positions", rationale: "Liquidation risk incompatible with 19-year mandate." },
]

const crashProtocol = [
  { tier: "1", label: "Noise", drawdown: "<10%", response: "No action. Continue DCA.", flag: null },
  { tier: "2", label: "Correction", drawdown: "10–15%", response: "No action. Consider increasing DCA if income permits.", flag: "If earnings revisions falling, accelerate quarterly review to monthly." },
  { tier: "3", label: "Bear", drawdown: "15–25%", response: "No selling. Contribution acceleration optional. Log emotional state.", flag: "Document whether drawdown is valuation-led or fundamental-led." },
  { tier: "4", label: "Crisis", drawdown: ">25%", response: "Emergency review. Contributions continue unless income is impaired.", flag: "Assess permanent thesis change — is the reason for owning these funds still true?" },
  { tier: "5", label: "Extreme", drawdown: ">40%", response: "Full governance review. No selling without written rationale.", flag: "Evaluate the reason for owning each fund, not the current price." },
]

const sbrCrashProtocol = [
  { tier: "1", label: "Small dip", drawdown: "<10%", response: "Keep investing normally. This is normal market movement.", flag: null },
  { tier: "2", label: "Correction", drawdown: "10–15%", response: "Keep investing normally. Do not change anything.", flag: "Remind yourself: every market has recovered from every dip so far." },
  { tier: "3", label: "Big drop", drawdown: ">15%", response: "Put the full monthly contribution into VWRA only. No selling.", flag: "A falling market means your money buys more shares. This is a good thing." },
  { tier: "4", label: "Crisis", drawdown: ">25%", response: "Keep investing — put everything into VWRA. Do not sell. Contributions stop only if you lose your income.", flag: "Check that your emergency fund outside the portfolio is intact." },
  { tier: "5", label: "Extreme", drawdown: ">40%", response: "Same as above. Keep investing into VWRA. The only review needed: is your income still safe?", flag: "Do not sell. The worst outcomes happen when people sell at the bottom." },
]

export default async function Behaviour() {
  const session = await getSession()
  if (!session) redirect("/login")

  const isSbr = constitutionIdForEmail(session.email) === "silicon-brick-road"

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

  const activeProhibitedActions = isSbr
    ? [
        { action: "Panic selling on a dip", rationale: "Selling locks in a loss that would have recovered if you waited." },
        { action: "Adding new funds", rationale: "Four funds only — VWRA, QQQM, SMH, A35. More funds = more complexity, less focus." },
        { action: "Chasing last month's winner", rationale: "Buying after a big run means buying at a high price. Wait for your regular contribution day." },
        { action: "Skipping contributions during a downturn", rationale: "When prices are down, your money buys more. This is the best time to invest, not the time to stop." },
        { action: "Rebalancing based on gut feeling", rationale: "Only rebalance when a fund is outside its allowed range — not because it feels off." },
        { action: "Using leveraged or speculative products", rationale: "These can wipe out your savings in a bad week. They have no place here." },
      ]
    : prohibitedActions

  return (
    <Shell
      title="Behavioural System"
      subtitle="Discipline, stability, and long-term consistency"
      userName={session.name}
      isAdmin={session.role === "admin"}
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
              {isSbr
                ? "This plan is built for a 2–3 year home deposit goal. Every rule exists to stop short-term noise from derailing a strategy that works when you stick to it. Before doing anything outside your monthly contribution, run the checklist below."
                : "Atlas Core is a 2045 system. Every rule, threshold, and alert exists to protect you from yourself during volatile periods. Before taking any action outside your monthly contribution schedule, run the decision checklist below."
              }
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
      <div className="rounded-xl border border-red-500/20 bg-red-500/[0.04] p-5 mb-4">
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

      {/* Prohibited Actions */}
      <div className="rounded-xl border border-border bg-card overflow-hidden mb-4">
        <div className="px-5 py-4 border-b border-border">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            {isSbr ? "Things Never to Do" : "Prohibited Actions §6.1"}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">These are never permitted under any market condition.</p>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="px-4 py-2 text-left font-medium text-muted-foreground">Action</th>
              <th className="px-4 py-2 text-left font-medium text-muted-foreground">Why not</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {activeProhibitedActions.map(({ action, rationale }) => (
              <tr key={action} className="hover:bg-accent/20">
                <td className="px-4 py-2.5 font-semibold text-red-400">{action}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{rationale}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Crash Protocol */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            {isSbr ? "When Markets Fall" : "Crash Protocol §6.2"}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {isSbr
              ? "What to do when markets drop. Keep investing at every level unless your income stops."
              : "Mandated response by drawdown tier. Monthly contributions continue at all tiers unless income is impaired."
            }
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {["Tier", "Label", "Drawdown", "Mandated Response", "Regime Flag"].map(h => (
                  <th key={h} className="px-4 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(isSbr ? sbrCrashProtocol : crashProtocol).map(({ tier, label, drawdown, response, flag }) => {
                const tierNum = parseInt(tier)
                const color = tierNum <= 1 ? "text-green-500" : tierNum === 2 ? "text-yellow-400" : tierNum === 3 ? "text-orange-500" : "text-red-500"
                return (
                  <tr key={tier} className="hover:bg-accent/20">
                    <td className={`px-4 py-3 font-black ${color}`}>{tier}</td>
                    <td className={`px-4 py-3 font-semibold ${color}`}>{label}</td>
                    <td className="px-4 py-3 tabular-nums font-mono text-muted-foreground">{drawdown}</td>
                    <td className="px-4 py-3 text-foreground/80">{response}</td>
                    <td className="px-4 py-3 text-muted-foreground italic">{flag ?? "—"}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Shell>
  )
}
