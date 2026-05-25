import { Shell } from "@/components/shell"
import { db } from "@/lib/db"
import { ShieldCheck, AlertTriangle, CheckCircle2, XCircle } from "lucide-react"
import { getSession } from "@/lib/session"
import { redirect } from "next/navigation"

const thresholds = [
  {
    ticker: "VT",
    target: 52,
    classification: "Global Core",
    healthyLow: 45, healthyHigh: 57,
    softLow: 40, softHigh: 62,  // soft = outside healthy but inside hard
    hardHigh: 62, hardLow: 40,
    color: "#6366f1",
  },
  {
    ticker: "QQQM",
    target: 23,
    classification: "Digital Economy Engine",
    healthyLow: 19, healthyHigh: 27,
    softLow: 16, softHigh: 31,
    hardHigh: 31, hardLow: 16,
    color: "#8b5cf6",
  },
  {
    ticker: "SMH",
    target: 10,
    classification: "AI Infrastructure Tilt",
    healthyLow: 0, healthyHigh: 12,
    softLow: 0, softHigh: 15,
    hardHigh: 15, hardLow: 0,
    color: "#a78bfa",
  },
  {
    ticker: "VWO",
    target: 8,
    classification: "Geographic Diversifier",
    healthyLow: 6, healthyHigh: 10,
    softLow: 4, softHigh: 12,
    hardHigh: 12, hardLow: 4,
    color: "#c4b5fd",
  },
  {
    ticker: "BTC",
    target: 7,
    classification: "Optionality Overlay",
    healthyLow: 5, healthyHigh: 8,
    softLow: 0, softHigh: 8,
    hardHigh: 8, hardLow: 0,
    color: "#f59e0b",
  },
]

const thresholdDisplay = [
  { ticker: "VT",   target: "52%", classification: "Global Core",           healthy: "45–57%", soft: "<45% or >57%", hard: "<40% or >62%", color: "#6366f1" },
  { ticker: "QQQM", target: "23%", classification: "Digital Economy Engine", healthy: "19–27%", soft: "<19% or >27%", hard: "<16% or >31%", color: "#8b5cf6" },
  { ticker: "SMH",  target: "10%", classification: "AI Infrastructure Tilt", healthy: "8–12%",  soft: ">12%",         hard: ">15%",         color: "#a78bfa" },
  { ticker: "VWO",  target: "8%",  classification: "Geographic Diversifier", healthy: "6–10%",  soft: "<6% or >10%",  hard: "<4% or >12%",  color: "#c4b5fd" },
  { ticker: "BTC",  target: "7%",  classification: "Optionality Overlay",    healthy: "5–8%",   soft: ">8%",          hard: ">8%",          color: "#f59e0b" },
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
    <Shell title="Governance Engine" subtitle="Rules, thresholds, and disciplined execution — v5.2" userName={session.name} isAdmin={session.role === "admin"}>

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
            Soft triggers redirect contributions. Hard triggers require rebalancing review.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {["Asset", "Classification", "Target", "Healthy Range", "Soft Trigger", "Hard Trigger"].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {thresholdDisplay.map(({ ticker, target, classification, healthy, soft, hard, color }) => (
                <tr key={ticker} className="hover:bg-accent/30 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                      <span className="font-bold">{ticker}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{classification}</td>
                  <td className="px-4 py-3 font-semibold">{target}</td>
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

      {/* Rules by category */}
      <div className="space-y-5">
        {Object.entries(grouped).map(([category, rules]) => (
          <div key={category}>
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
              {category}
            </h2>
            <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
              {rules.map(({ id, title, description, active }) => (
                <div key={id} className="flex items-start justify-between gap-4 px-5 py-4">
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${active ? "bg-green-500/15" : "bg-muted"}`}>
                      <ShieldCheck className={`h-3 w-3 ${active ? "text-green-500" : "text-muted-foreground"}`} />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">{description}</p>
                    </div>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${active ? "bg-green-500/10 text-green-500" : "bg-muted text-muted-foreground"}`}>
                    {active ? "Active" : "Inactive"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Shell>
  )
}
