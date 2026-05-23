import { Shell } from "@/components/shell"
import { TrendingUp, ShieldCheck, AlertTriangle, Activity } from "lucide-react"

const statCards = [
  {
    label: "Portfolio Value",
    value: "—",
    sub: "No data yet",
    icon: TrendingUp,
  },
  {
    label: "Health Score",
    value: "—",
    sub: "Add holdings to calculate",
    icon: Activity,
  },
  {
    label: "Governance Status",
    value: "—",
    sub: "No rules configured",
    icon: ShieldCheck,
  },
  {
    label: "Drift Alerts",
    value: "0",
    sub: "All within tolerance",
    icon: AlertTriangle,
  },
]

const sections = [
  {
    title: "Portfolio Architecture",
    desc: "Define your holdings, target allocations, and hard caps.",
    href: "/portfolio",
    status: "Setup required",
  },
  {
    title: "Governance Engine",
    desc: "Set rules, drift thresholds, and contribution routing logic.",
    href: "/governance",
    status: "Setup required",
  },
  {
    title: "Behavioural System",
    desc: "Maintain discipline. Log emotions. Resist over-optimisation.",
    href: "/behaviour",
    status: "Active",
  },
  {
    title: "Reports",
    desc: "Institutional-style portfolio health reviews and analysis.",
    href: "/reports",
    status: "Ready",
  },
  {
    title: "Forecast Engine",
    desc: "Model 10, 15, and 20-year compounding trajectories.",
    href: "/forecast",
    status: "Ready",
  },
]

export default function Dashboard() {
  return (
    <Shell title="Dashboard" subtitle="Your investment operating system">
      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        {statCards.map(({ label, value, sub, icon: Icon }) => (
          <div
            key={label}
            className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">{label}</span>
              <Icon className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-2xl font-semibold tracking-tight">{value}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
            </div>
          </div>
        ))}
      </div>

      {/* System overview */}
      <div className="mt-6">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
          System Overview
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sections.map(({ title, desc, href, status }) => (
            <a
              key={href}
              href={href}
              className="group rounded-xl border border-border bg-card p-4 transition-colors hover:border-foreground/20 hover:bg-accent/40"
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold">{title}</h3>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    status === "Setup required"
                      ? "bg-amber-500/10 text-amber-500"
                      : "bg-green-500/10 text-green-500"
                  }`}
                >
                  {status}
                </span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground leading-relaxed">{desc}</p>
            </a>
          ))}
        </div>
      </div>

      {/* Getting started */}
      <div className="mt-6 rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">Getting Started</h2>
        <p className="mt-1 text-xs text-muted-foreground max-w-lg leading-relaxed">
          Begin by adding your holdings in{" "}
          <a href="/portfolio" className="text-foreground underline underline-offset-2">
            Portfolio Architecture
          </a>
          . Once your positions are entered, the governance engine, health score, and
          reporting layer will populate automatically.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {[
            { step: "1", label: "Add holdings", href: "/portfolio" },
            { step: "2", label: "Set governance rules", href: "/governance" },
            { step: "3", label: "Run a report", href: "/reports" },
          ].map(({ step, label, href }) => (
            <a
              key={step}
              href={href}
              className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors"
            >
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-foreground text-background text-[9px] font-bold">
                {step}
              </span>
              {label}
            </a>
          ))}
        </div>
      </div>
    </Shell>
  )
}
