import { Shell } from "@/components/shell"
import { db } from "@/lib/db"
import { ShieldCheck, AlertTriangle, CheckCircle2, XCircle } from "lucide-react"
import { getSession } from "@/lib/session"
import { redirect } from "next/navigation"
import { CollapsibleRuleGroup } from "@/components/governance/collapsible-rule-group"

// v5.8 thresholds (Section 2 hard caps + Section 3.1 drift bands)
const thresholds = [
  {
    ticker: "VT",
    target: 52,
    classification: "Global Core",
    healthyLow: 46, healthyHigh: 58,
    softLow: 42, softHigh: 62,  // soft = outside healthy but inside hard trigger
    hardHigh: 62, hardLow: 42,
    color: "#6366f1",
  },
  {
    ticker: "QQQM",
    target: 23,
    classification: "Digital Economy Engine",
    healthyLow: 18, healthyHigh: 28,
    softLow: 15, softHigh: 31,
    hardHigh: 31, hardLow: 15,
    color: "#8b5cf6",
  },
  {
    ticker: "SMH",
    target: 10,
    classification: "AI Infrastructure Tilt",
    healthyLow: 7, healthyHigh: 13,
    softLow: 5, softHigh: 15,
    hardHigh: 15, hardLow: 5,
    color: "#a78bfa",
  },
  {
    ticker: "VWO",
    target: 8,
    classification: "Geographic Diversifier",
    healthyLow: 5, healthyHigh: 11,
    softLow: 3, softHigh: 13,
    hardHigh: 13, hardLow: 3,
    color: "#c4b5fd",
  },
  {
    ticker: "BTC",
    target: 7,
    classification: "Bitcoin — Volatility Cap",
    healthyLow: 6, healthyHigh: 8,
    softLow: 0, softHigh: 8,  // no soft overweight band — hard cap immediately at 8%
    hardHigh: 8, hardLow: 0,  // no lower hard trigger (underweight is soft alert only)
    color: "#f59e0b",
  },
]

// conviction = asymmetric trim rule (§3.5): do not trim unless Section 2 hard cap is breached
const thresholdDisplay = [
  { ticker: "VT",   positionCap: "60%", target: "52%", classification: "Global Core",              healthy: "46–58%", soft: "<46% or >58%", hard: "<42% or >62%", color: "#6366f1", conviction: false },
  { ticker: "QQQM", positionCap: "30%", target: "23%", classification: "Digital Economy Engine",   healthy: "18–28%", soft: "<18% or >28%", hard: "<15% or >31%", color: "#8b5cf6", conviction: true  },
  { ticker: "SMH",  positionCap: "15%", target: "10%", classification: "AI Infrastructure Tilt",   healthy: "7–13%",  soft: "<7% or >13%",  hard: "<5% or >15%",  color: "#a78bfa", conviction: true  },
  { ticker: "VWO",  positionCap: "13%", target: "8%",  classification: "Geographic Diversifier",   healthy: "5–11%",  soft: "<5% or >11%",  hard: "<3% or >13%",  color: "#c4b5fd", conviction: false },
  { ticker: "BTC",  positionCap: "8%",  target: "7%",  classification: "Bitcoin — Volatility Cap", healthy: "6–8%",   soft: "<6%",          hard: ">8%",          color: "#f59e0b", conviction: false },
]

const monthlySteps = [
  {
    step: 1,
    question: "Has any hard cap been breached?",
    detail: "Check ticker allocations and look-through concentration (§4).",
    yes: "Execute mandated response immediately: BTC >8% → trim to target; QQQM >30% → halt + trim; SMH >15% → trim; Nvidia >13% → reduce cluster exposure. Then go to Step 6.",
    no: "Proceed to Step 2.",
  },
  {
    step: 2,
    question: "Is any asset below target?",
    detail: "Review all portfolio weights against target allocation.",
    yes: "Direct 100% of monthly contribution to the most underweight asset. No splitting. No optimisation. Then go to Step 6.",
    no: "Proceed to Step 3.",
  },
  {
    step: 3,
    question: "Is any asset above its soft alert band?",
    detail: "Soft alert = outside healthy range but below hard trigger.",
    yes: "Pause contributions to that asset. Redirect to underweight positions. Do not trim. Exception: if any §4 concentration limit is breached, §4 overrides. Then go to Step 6.",
    no: "Proceed to Step 4.",
  },
  {
    step: 4,
    question: "Is any structural review trigger active?",
    detail: "§4.4: QQQM underperforms VT >5% annualised over 5 years, or semiconductor cluster underperforms VT >8% annualised.",
    yes: "Schedule formal review within 30 days. Continue normal contributions. Do not alter allocations during review. Then go to Step 6.",
    no: "Proceed to Step 5.",
  },
  {
    step: 5,
    question: "Normal contribution deployment.",
    detail: "No hard triggers, concentration breaches, underweight priorities, or structural reviews active.",
    yes: null,
    no: null,
    action: "Deploy monthly contribution at target weights: VT 52% · QQQM 23% · SMH 10% · VWO 8% · BTC 7%. Then go to Step 6.",
  },
  {
    step: 6,
    question: "Market regime: is the portfolio drawdown greater than 25%?",
    detail: "Measure from all-time high.",
    yes: "Activate Crash Protocol (§6.2). Continue DCA unchanged. Do not redesign the portfolio. Do not initiate discretionary sales.",
    no: "Continue normal operation. No further action required.",
  },
  {
    step: 7,
    question: "Compliance confirmation.",
    detail: null,
    yes: null,
    no: null,
    action: "Confirm: pre-clearance obtained · within dealing window · no compliance restrictions · contribution executed · governance log updated · drift reviewed · concentration reviewed.",
  },
  {
    step: 8,
    question: "System closure.",
    detail: null,
    yes: null,
    no: null,
    action: "Close. Do not monitor daily. Do not seek confirmation from market commentators. Do not alter allocations outside governance rules. Reopen only at the next scheduled review date.",
  },
]

async function getRules() {
  const rules = await db.governanceRule.findMany({ orderBy: [{ category: "asc" }, { createdAt: "asc" }] })
  const grouped: Record<string, typeof rules> = {}
  for (const rule of rules) {
    if (!grouped[rule.category]) grouped[rule.category] = []
    grouped[rule.category].push(rule)
  }
  return grouped
}

async function getLiveAllocations(userId: string) {
  const holdings = await db.holding.findMany({
    where: { userId },
    include: { snapshots: { orderBy: { date: "desc" }, take: 1 } },
  })
  const totalValue = holdings.reduce((sum, h) => sum + (h.snapshots[0]?.value ?? 0), 0)
  const allocMap: Record<string, number> = {}
  for (const h of holdings) {
    const value = h.snapshots[0]?.value ?? 0
    allocMap[h.ticker] = totalValue > 0 ? (value / totalValue) * 100 : 0
  }
  return allocMap
}

export default async function Governance() {
  const session = await getSession()
  if (!session) redirect("/login")
  const [grouped, allocMap] = await Promise.all([getRules(), getLiveAllocations(session.userId)])
  const totalRules = Object.values(grouped).flat().length
  const activeRules = Object.values(grouped).flat().filter((r) => r.active).length

  return (
    <Shell title="Governance Engine" subtitle="Rules, thresholds, and disciplined execution — v5.8" userName={session.name} isAdmin={session.role === "admin"}>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="rounded-xl border border-border bg-card p-4 card-elevated flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Total Rules</span>
            <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <p className="text-2xl font-black tabular-nums">{totalRules}</p>
          <p className="text-[11px] text-muted-foreground">Governance framework</p>
        </div>
        <div className="rounded-xl border border-green-500/20 bg-card p-4 card-elevated flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Active</span>
            <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
          </div>
          <p className="text-2xl font-black tabular-nums text-green-500">{activeRules}</p>
          <p className="text-[11px] text-muted-foreground">Rules enforced</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 card-elevated flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Inactive</span>
            <XCircle className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <p className="text-2xl font-black tabular-nums text-muted-foreground">{totalRules - activeRules}</p>
          <p className="text-[11px] text-muted-foreground">Not enforced</p>
        </div>
      </div>

      {/* Live position gauges */}
      <div className="rounded-xl border border-border bg-card overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold">Live Position Status</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Current allocation vs healthy, soft, and hard thresholds
          </p>
        </div>
        <div className="divide-y divide-border">
          {thresholds.map((t) => {
            const actual = allocMap[t.ticker] ?? 0
            const isHard = actual > t.hardHigh || (t.hardLow > 0 && actual < t.hardLow)
            const isSoft = !isHard && (actual > t.healthyHigh || (t.healthyLow > 0 && actual < t.healthyLow))
            const isHealthy = !isHard && !isSoft

            const barColor = isHard ? "#ef4444" : isSoft ? "#f59e0b" : "#22c55e"
            const statusLabel = isHard ? "Hard Breach" : isSoft ? "Soft Drift" : "Healthy"
            const statusCls = isHard
              ? "bg-red-500/10 text-red-500 ring-1 ring-red-500/20"
              : isSoft
              ? "bg-amber-500/10 text-amber-500 ring-1 ring-amber-500/20"
              : "bg-green-500/10 text-green-500 ring-1 ring-green-500/20"

            // Bar scale: 0–max, where max = hardHigh + a little padding
            const scale = (t.hardHigh + 5) || 20
            const pct = (v: number) => `${Math.min(100, (v / scale) * 100)}%`

            return (
              <div key={t.ticker} className="px-5 py-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                    <div>
                      <span className="text-sm font-bold">{t.ticker}</span>
                      <span className="text-xs text-muted-foreground ml-2">{t.classification}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-black tabular-nums" style={{ color: barColor }}>{actual.toFixed(1)}%</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusCls}`}>{statusLabel}</span>
                  </div>
                </div>

                {/* Threshold bar */}
                <div className="relative h-5 rounded-lg bg-muted overflow-hidden">
                  {/* Hard zone overlay */}
                  {t.hardLow > 0 && (
                    <div
                      className="absolute inset-y-0 bg-red-500/10"
                      style={{ left: 0, width: pct(t.hardLow) }}
                    />
                  )}
                  <div
                    className="absolute inset-y-0 bg-red-500/10"
                    style={{ left: pct(t.hardHigh), right: 0 }}
                  />
                  {/* Soft zone overlay */}
                  {t.softLow > 0 && t.healthyLow > 0 && (
                    <div
                      className="absolute inset-y-0 bg-amber-500/10"
                      style={{ left: pct(t.softLow), width: `calc(${pct(t.healthyLow)} - ${pct(t.softLow)})` }}
                    />
                  )}
                  <div
                    className="absolute inset-y-0 bg-amber-500/10"
                    style={{ left: pct(t.healthyHigh), width: `calc(${pct(t.softHigh)} - ${pct(t.healthyHigh)})` }}
                  />
                  {/* Healthy zone overlay */}
                  <div
                    className="absolute inset-y-0 bg-green-500/[0.08]"
                    style={{ left: pct(t.healthyLow), width: `calc(${pct(t.healthyHigh)} - ${pct(t.healthyLow)})` }}
                  />

                  {/* Target marker */}
                  <div
                    className="absolute inset-y-0 w-0.5 bg-foreground/25"
                    style={{ left: pct(t.target) }}
                    title={`Target: ${t.target}%`}
                  />

                  {/* Actual position marker */}
                  <div
                    className="absolute top-1 bottom-1 w-1.5 rounded-sm transition-all"
                    style={{ left: pct(actual), backgroundColor: barColor, transform: "translateX(-50%)" }}
                  />
                </div>

                {/* Scale labels */}
                <div className="relative mt-1 h-3">
                  {t.hardLow > 0 && (
                    <span className="absolute text-[9px] text-red-500/70" style={{ left: pct(t.hardLow) }}>
                      {t.hardLow}%
                    </span>
                  )}
                  <span className="absolute text-[9px] text-amber-500/70" style={{ left: pct(t.healthyLow) }}>
                    {t.healthyLow}%
                  </span>
                  <span className="absolute text-[9px] text-foreground/40 -translate-x-1/2" style={{ left: pct(t.target) }}>
                    {t.target}%
                  </span>
                  <span className="absolute text-[9px] text-amber-500/70 -translate-x-full" style={{ left: pct(t.healthyHigh) }}>
                    {t.healthyHigh}%
                  </span>
                  <span className="absolute text-[9px] text-red-500/70 -translate-x-full" style={{ left: pct(t.hardHigh) }}>
                    {t.hardHigh}%
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Threshold table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold">Allocation Governance Thresholds</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Position Cap (§2) = absolute ceiling requiring trim. Drift triggers (§3.1) govern contribution redirection.
            Conviction assets (★) may not be trimmed unless Position Cap is breached.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {["Asset", "Classification", "Target", "Position Cap §2", "Healthy Range", "Soft Trigger §3.1", "Hard Trigger §3.1"].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {thresholdDisplay.map(({ ticker, positionCap, target, classification, healthy, soft, hard, color, conviction }) => (
                <tr key={ticker} className="hover:bg-accent/30 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                      <span className="font-bold">{ticker}</span>
                      {conviction && <span className="text-[9px] font-bold text-indigo-400 bg-indigo-400/10 px-1.5 py-0.5 rounded-full">★ Conviction</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{classification}</td>
                  <td className="px-4 py-3 font-semibold">{target}</td>
                  <td className="px-4 py-3 font-semibold text-red-400">{positionCap}</td>
                  <td className="px-4 py-3 text-green-500">{healthy}</td>
                  <td className="px-4 py-3 text-amber-500">{soft}</td>
                  <td className="px-4 py-3 text-red-500">{hard}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Response protocol */}
      <div className="grid gap-3 sm:grid-cols-3 mb-6">
        {[
          {
            label: "Healthy",
            sub: "No action required",
            text: "All positions within band. Continue monthly contribution schedule unchanged.",
            icon: CheckCircle2,
            color: "text-green-500",
            border: "border-green-500/20",
            bg: "bg-green-500/[0.06]",
            pill: "bg-green-500/10 text-green-600 dark:text-green-400",
          },
          {
            label: "Soft Trigger",
            sub: "Redirect contributions",
            text: "Redirect new capital to underweight positions for 2–3 months. No selling required.",
            icon: AlertTriangle,
            color: "text-amber-500",
            border: "border-amber-500/20",
            bg: "bg-amber-500/[0.06]",
            pill: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
          },
          {
            label: "Hard Trigger",
            sub: "Rebalancing review required",
            text: "Halt buys on the breaching position. Assess selective trim at the next dealing window.",
            icon: XCircle,
            color: "text-red-500",
            border: "border-red-500/20",
            bg: "bg-red-500/[0.06]",
            pill: "bg-red-500/10 text-red-600 dark:text-red-400",
          },
        ].map(({ label, sub, text, icon: Icon, color, border, bg, pill }) => (
          <div key={label} className={`rounded-xl border ${border} ${bg} p-4`}>
            <div className="flex items-center gap-2 mb-3">
              <Icon className={`h-4 w-4 ${color}`} />
              <div>
                <p className="text-xs font-bold leading-none">{label}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">{text}</p>
          </div>
        ))}
      </div>

      {/* Monthly Decision Engine — §5.4 */}
      <div className="rounded-xl border border-border bg-card overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold">Monthly Decision Engine</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            §5.4 — Execute every monthly contribution in under five minutes. No forecasting. No opinion. Follow the steps in order.
          </p>
        </div>
        <div className="divide-y divide-border">
          {monthlySteps.map((s) => (
            <div key={s.step} className="px-5 py-4 flex gap-4">
              <div className="shrink-0 flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[11px] font-black text-muted-foreground mt-0.5">
                {s.step}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-foreground mb-0.5">{s.question}</p>
                {s.detail && <p className="text-[11px] text-muted-foreground mb-2">{s.detail}</p>}
                {s.action ? (
                  <p className="text-[11px] text-foreground/80 bg-muted/40 rounded-lg px-3 py-2 leading-relaxed">{s.action}</p>
                ) : (
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    <div className="rounded-lg bg-green-500/[0.06] border border-green-500/15 px-3 py-2">
                      <p className="text-[10px] font-bold text-green-500 mb-0.5">If Yes</p>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">{s.yes}</p>
                    </div>
                    <div className="rounded-lg bg-muted/30 border border-border px-3 py-2">
                      <p className="text-[10px] font-bold text-muted-foreground mb-0.5">If No</p>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">{s.no}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="px-5 py-3 border-t border-border bg-muted/20">
          <p className="text-[11px] text-muted-foreground italic">
            Precedence: §4 Look-Through Concentration → §3 Drift Governance → §5 Contribution Engine → all other sections.
            Concentration always overrides conviction. Hard triggers always override soft alerts.
          </p>
        </div>
      </div>

      {/* Rules by category — collapsible */}
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Governance Rules
        </h2>
        <span className="text-[11px] text-muted-foreground">Click a category to expand</span>
      </div>
      <div className="space-y-2">
        {Object.entries(grouped).map(([category, rules], i) => (
          <CollapsibleRuleGroup
            key={category}
            category={category}
            rules={rules}
            defaultOpen={i === 0}
          />
        ))}
      </div>
    </Shell>
  )
}
