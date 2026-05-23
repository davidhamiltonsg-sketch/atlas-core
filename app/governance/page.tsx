import { Shell } from "@/components/shell"
import { db } from "@/lib/db"
import { ShieldCheck, AlertTriangle, CheckCircle2 } from "lucide-react"
import { getSession } from "@/lib/session"
import { redirect } from "next/navigation"

const thresholds = [
  {
    ticker: "VT",
    target: "52%",
    classification: "Global Core",
    healthy: "45–57%",
    soft: "<45% or >57%",
    hard: "<40% or >62%",
    color: "#6366f1",
  },
  {
    ticker: "QQQM",
    target: "23%",
    classification: "Digital Economy Engine",
    healthy: "19–27%",
    soft: "<19% or >27%",
    hard: "<16% or >31%",
    color: "#8b5cf6",
  },
  {
    ticker: "SMH",
    target: "10%",
    classification: "AI Infrastructure Tilt",
    healthy: "8–12%",
    soft: ">12%",
    hard: ">15%",
    color: "#a78bfa",
  },
  {
    ticker: "VWO",
    target: "8%",
    classification: "Geographic Diversifier",
    healthy: "6–10%",
    soft: "<6% or >10%",
    hard: "<4% or >12%",
    color: "#c4b5fd",
  },
  {
    ticker: "BTC",
    target: "7%",
    classification: "Optionality Overlay",
    healthy: "5–8%",
    soft: ">8%",
    hard: ">8%",
    color: "#f59e0b",
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

export default async function Governance() {
  const session = await getSession()
  if (!session) redirect("/login")
  const grouped = await getRules()
  const totalRules = Object.values(grouped).flat().length
  const activeRules = Object.values(grouped).flat().filter((r) => r.active).length

  return (
    <Shell title="Governance Engine" subtitle="Rules, thresholds, and disciplined execution — v5.2" userName={session.name}>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Total Rules</p>
          <p className="mt-1 text-xl font-semibold">{totalRules}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Active</p>
          <p className="mt-1 text-xl font-semibold text-green-500">{activeRules}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Inactive</p>
          <p className="mt-1 text-xl font-semibold text-muted-foreground">{totalRules - activeRules}</p>
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
              {thresholds.map(({ ticker, target, classification, healthy, soft, hard, color }) => (
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

      {/* Response cards */}
      <div className="grid gap-3 sm:grid-cols-3 mb-6">
        {[
          {
            label: "Healthy — No Action",
            text: "All positions within range. Continue monthly contribution schedule unchanged.",
            icon: CheckCircle2,
            color: "text-green-500",
            bg: "bg-green-500/10",
          },
          {
            label: "Soft Trigger — Redirect",
            text: "Redirect new contributions to underweight positions. No selling required.",
            icon: AlertTriangle,
            color: "text-amber-500",
            bg: "bg-amber-500/10",
          },
          {
            label: "Hard Trigger — Review",
            text: "Redirect contributions and selectively trim if rebalancing is necessary after review.",
            icon: AlertTriangle,
            color: "text-red-500",
            bg: "bg-red-500/10",
          },
        ].map(({ label, text, icon: Icon, color, bg }) => (
          <div key={label} className="rounded-xl border border-border bg-card p-4">
            <div className={`flex h-7 w-7 items-center justify-center rounded-full ${bg} mb-3`}>
              <Icon className={`h-3.5 w-3.5 ${color}`} />
            </div>
            <p className="text-xs font-semibold mb-1">{label}</p>
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
