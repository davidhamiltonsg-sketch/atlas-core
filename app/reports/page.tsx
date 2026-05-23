import { Shell } from "@/components/shell"
import { db } from "@/lib/db"
import { formatCurrency, formatPercent } from "@/lib/utils"
import { AlertTriangle, CheckCircle2, TrendingUp, Activity } from "lucide-react"
import { getSession } from "@/lib/session"
import { redirect } from "next/navigation"

// ─── ETF Look-through Compositions ────────────────────────────────────────────
// Approximate weights based on published fund holdings (updated periodically)

const COMPANY_WEIGHTS: Record<string, Record<string, number>> = {
  VT:   { Nvidia: 2.5, Microsoft: 3.0, Apple: 3.0, Amazon: 2.2, Meta: 1.4, Alphabet: 1.8, Broadcom: 0.9, TSMC: 0.8 },
  QQQM: { Nvidia: 7.0, Microsoft: 8.5, Apple: 9.0, Amazon: 5.5, Meta: 4.5, Alphabet: 4.0, Broadcom: 3.5, TSMC: 0.0 },
  SMH:  { Nvidia: 20.0, Microsoft: 0.0, Apple: 0.0, Amazon: 0.0, Meta: 0.0, Alphabet: 0.0, Broadcom: 8.0, TSMC: 12.0 },
  VWO:  { Nvidia: 0.0, Microsoft: 0.0, Apple: 0.0, Amazon: 0.0, Meta: 0.0, Alphabet: 0.0, Broadcom: 0.0, TSMC: 7.0 },
  BTC:  { Nvidia: 0.0, Microsoft: 0.0, Apple: 0.0, Amazon: 0.0, Meta: 0.0, Alphabet: 0.0, Broadcom: 0.0, TSMC: 0.0 },
}

const SECTOR_WEIGHTS: Record<string, { semiconductor: number; digital: number; us: number; ai: number }> = {
  VT:   { semiconductor: 8,   digital: 35,  us: 62,  ai: 15 },
  QQQM: { semiconductor: 13,  digital: 65,  us: 100, ai: 35 },
  SMH:  { semiconductor: 100, digital: 90,  us: 75,  ai: 70 },
  VWO:  { semiconductor: 12,  digital: 30,  us: 0,   ai: 10 },
  BTC:  { semiconductor: 0,   digital: 0,   us: 0,   ai: 0  },
}

// ─── Governance Caps ───────────────────────────────────────────────────────────

const COMPANY_CAPS: Record<string, { soft: number; hard: number }> = {
  Nvidia:    { soft: 10, hard: 13 },
  Microsoft: { soft: 10, hard: 13 },
  Apple:     { soft: 8,  hard: 11 },
  Amazon:    { soft: 7,  hard: 9  },
  Meta:      { soft: 6,  hard: 8  },
  Alphabet:  { soft: 6,  hard: 8  },
  Broadcom:  { soft: 5,  hard: 7  },
  TSMC:      { soft: 5,  hard: 7  },
}

const SECTOR_CAPS = {
  semiconductor: { label: "Semiconductor Dependency", elevated: 16, excessive: 20, unit: "%" },
  digital:       { label: "Digital Economy Dependency", elevated: 48, excessive: 54, unit: "%" },
  us:            { label: "US Market Dependency", elevated: 70, excessive: 78, unit: "%" },
  ai:            { label: "AI Infrastructure Cluster", elevated: 38, excessive: 46, unit: "%" },
}

// ─── Data Fetching ─────────────────────────────────────────────────────────────

async function getReportData(userId: string) {
  const holdings = await db.holding.findMany({
    where: { userId },
    include: { snapshots: { orderBy: { date: "desc" }, take: 1 } },
  })

  const totalValue = holdings.reduce((sum, h) => sum + (h.snapshots[0]?.value ?? 0), 0)

  const positions = holdings.map((h) => {
    const value = h.snapshots[0]?.value ?? 0
    const actualPct = totalValue > 0 ? (value / totalValue) * 100 : 0
    const drift = Math.abs(actualPct - h.targetPct)
    const driftPct = actualPct - h.targetPct
    const outsideBand = drift > h.toleranceBand
    const overCap = h.hardCapPct !== null && actualPct > h.hardCapPct
    return { ticker: h.ticker, name: h.name, color: h.color, value, actualPct, targetPct: h.targetPct, drift, driftPct, outsideBand, overCap }
  })

  // Look-through company exposures
  const companies = Object.keys(COMPANY_CAPS)
  const companyExposure: Record<string, number> = {}
  for (const company of companies) {
    companyExposure[company] = positions.reduce((sum, p) => {
      const etfWeight = COMPANY_WEIGHTS[p.ticker]?.[company] ?? 0
      return sum + (p.actualPct / 100) * etfWeight
    }, 0)
  }

  // Sector dependency
  const sectorExposure: Record<string, number> = { semiconductor: 0, digital: 0, us: 0, ai: 0 }
  for (const p of positions) {
    const sw = SECTOR_WEIGHTS[p.ticker]
    if (sw) {
      sectorExposure.semiconductor += (p.actualPct / 100) * sw.semiconductor
      sectorExposure.digital       += (p.actualPct / 100) * sw.digital
      sectorExposure.us            += (p.actualPct / 100) * sw.us
      sectorExposure.ai            += (p.actualPct / 100) * sw.ai
    }
  }

  // Health score
  const driftAlerts = positions.filter((p) => p.outsideBand || p.overCap).length
  const maxDrift = positions.reduce((max, p) => Math.max(max, p.drift), 0)
  const companyBreaches = companies.filter((c) => companyExposure[c] > COMPANY_CAPS[c].soft).length
  const sectorBreaches = (Object.keys(SECTOR_CAPS) as (keyof typeof SECTOR_CAPS)[]).filter(
    (k) => sectorExposure[k] > SECTOR_CAPS[k].elevated
  ).length
  const healthScore = Math.max(0, Math.round(100 - driftAlerts * 10 - maxDrift * 2 - companyBreaches * 5 - sectorBreaches * 8))

  return { totalValue, positions, companyExposure, sectorExposure, healthScore, driftAlerts, maxDrift }
}

// ─── Helper ────────────────────────────────────────────────────────────────────

function statusFor(value: number, soft: number, hard: number) {
  if (value >= hard) return "excessive"
  if (value >= soft) return "elevated"
  return "healthy"
}

function StatusBadge({ status }: { status: string }) {
  if (status === "excessive") return <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium bg-red-500/10 text-red-500">Excessive</span>
  if (status === "elevated")  return <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium bg-amber-500/10 text-amber-500">Elevated</span>
  return <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium bg-green-500/10 text-green-500">Healthy</span>
}

function MiniBar({ value, soft, hard, max }: { value: number; soft: number; hard: number; max: number }) {
  const pct = Math.min(100, (value / max) * 100)
  const softPct = Math.min(100, (soft / max) * 100)
  const hardPct = Math.min(100, (hard / max) * 100)
  const status = statusFor(value, soft, hard)
  const barColor = status === "excessive" ? "bg-red-500" : status === "elevated" ? "bg-amber-500" : "bg-foreground/30"
  return (
    <div className="relative h-1.5 rounded-full bg-muted overflow-hidden w-full">
      <div className="absolute inset-y-0 left-0 rounded-full transition-all" style={{ width: `${pct}%` }}>
        <div className={`h-full w-full rounded-full ${barColor}`} />
      </div>
      <div className="absolute inset-y-0 w-px bg-amber-500/60" style={{ left: `${softPct}%` }} />
      <div className="absolute inset-y-0 w-px bg-red-500/60" style={{ left: `${hardPct}%` }} />
    </div>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default async function Reports() {
  const session = await getSession()
  if (!session) redirect("/login")
  const { totalValue, positions, companyExposure, sectorExposure, healthScore, driftAlerts, maxDrift } = await getReportData(session.userId)

  const healthColor = healthScore >= 80 ? "text-green-500" : healthScore >= 60 ? "text-amber-500" : "text-red-500"
  const healthLabel = healthScore >= 80 ? "Good standing" : healthScore >= 60 ? "Review recommended" : "Action required"

  const companies = Object.keys(COMPANY_CAPS) as (keyof typeof COMPANY_CAPS)[]
  const sectorKeys = Object.keys(SECTOR_CAPS) as (keyof typeof SECTOR_CAPS)[]

  const companyAlerts = companies.filter((c) => companyExposure[c] > COMPANY_CAPS[c].soft).length
  const sectorAlerts = sectorKeys.filter((k) => sectorExposure[k] > SECTOR_CAPS[k].elevated).length

  return (
    <Shell title="Reports" subtitle="Overlap & concentration engine — v5.2" userName={session.name}>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 mb-6 lg:grid-cols-4">
        {[
          { label: "Portfolio Value", value: formatCurrency(totalValue, "USD"), sub: "USD · IBKR", icon: TrendingUp, cls: "" },
          { label: "Health Score", value: `${healthScore}`, sub: healthLabel, icon: Activity, cls: healthColor },
          { label: "Drift Alerts", value: `${driftAlerts}`, sub: driftAlerts === 0 ? "All within tolerance" : `${driftAlerts} holding${driftAlerts > 1 ? "s" : ""} outside band`, icon: AlertTriangle, cls: driftAlerts > 0 ? "text-amber-500" : "" },
          { label: "Concentration Alerts", value: `${companyAlerts + sectorAlerts}`, sub: companyAlerts + sectorAlerts === 0 ? "All caps observed" : `${companyAlerts} company · ${sectorAlerts} sector`, icon: AlertTriangle, cls: companyAlerts + sectorAlerts > 0 ? "text-amber-500" : "" },
        ].map(({ label, value, sub, icon: Icon, cls }) => (
          <div key={label} className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">{label}</span>
              <Icon className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <div>
              <p className={`text-2xl font-semibold tracking-tight ${cls}`}>{value}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Allocation snapshot */}
      <div className="rounded-xl border border-border bg-card overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold">Allocation Snapshot</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Current weights vs targets · max drift {formatPercent(maxDrift, 1, false)}</p>
        </div>
        <div className="divide-y divide-border">
          {positions.map((p) => {
            const status = p.overCap ? "excessive" : p.outsideBand ? "elevated" : "healthy"
            return (
              <div key={p.ticker} className="px-5 py-3 flex items-center gap-4">
                <div className="flex items-center gap-2 w-16 shrink-0">
                  <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                  <span className="text-xs font-bold">{p.ticker}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-muted-foreground">{formatPercent(p.actualPct, 1, false)} actual · {formatPercent(p.targetPct, 1, false)} target</span>
                    <span className={`text-xs font-medium ${p.driftPct > 0 ? "text-amber-500" : "text-blue-400"}`}>
                      {formatPercent(p.driftPct)}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${Math.min(100, p.actualPct / 0.7)}%`, backgroundColor: p.color, opacity: 0.8 }} />
                  </div>
                </div>
                <div className="shrink-0 w-20 text-right">
                  <p className="text-xs font-semibold">{formatCurrency(p.value, "USD")}</p>
                </div>
                <div className="shrink-0">
                  <StatusBadge status={status} />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Look-through company exposure */}
      <div className="rounded-xl border border-border bg-card overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold">Look-Through Company Exposure</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Effective single-stock exposure across all ETFs · soft caps (amber) and hard caps (red) marked
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {["Company", "Effective Exposure", "Soft Cap", "Hard Cap", "Status", ""].map((h) => (
                  <th key={h} className="px-5 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {companies.map((company) => {
                const exposure = companyExposure[company]
                const { soft, hard } = COMPANY_CAPS[company]
                const status = statusFor(exposure, soft, hard)
                return (
                  <tr key={company} className="hover:bg-accent/30 transition-colors">
                    <td className="px-5 py-3 font-semibold">{company}</td>
                    <td className="px-5 py-3 font-semibold tabular-nums">{formatPercent(exposure, 1, false)}</td>
                    <td className="px-5 py-3 text-amber-500">{formatPercent(soft, 1, false)}</td>
                    <td className="px-5 py-3 text-red-500">{formatPercent(hard, 1, false)}</td>
                    <td className="px-5 py-3"><StatusBadge status={status} /></td>
                    <td className="px-5 py-3 w-36">
                      <MiniBar value={exposure} soft={soft} hard={hard} max={hard * 1.4} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-3 border-t border-border bg-muted/20 flex items-center gap-4">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <div className="h-px w-4 bg-amber-500/60" /> Soft cap
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <div className="h-px w-4 bg-red-500/60" /> Hard cap
          </div>
          <p className="text-[11px] text-muted-foreground ml-auto">
            Weights derived from published ETF holdings · approximate · monitor quarterly
          </p>
        </div>
      </div>

      {/* Sector dependency engines */}
      <div className="rounded-xl border border-border bg-card overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold">Sector Dependency Engine</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Aggregated thematic exposure across all holdings · elevated and excessive thresholds
          </p>
        </div>
        <div className="divide-y divide-border">
          {sectorKeys.map((key) => {
            const { label, elevated, excessive } = SECTOR_CAPS[key]
            const value = sectorExposure[key]
            const status = statusFor(value, elevated, excessive)
            const responses: Record<string, string> = {
              healthy:   "Within governance limits. No action required.",
              elevated:  "Approaching threshold. Monitor closely and redirect contributions.",
              excessive: "Threshold breached. Pause accumulation in concentrated positions.",
            }
            return (
              <div key={key} className="px-5 py-4">
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div>
                    <p className="text-sm font-medium">{label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{responses[status]}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-lg font-semibold tabular-nums ${status === "excessive" ? "text-red-500" : status === "elevated" ? "text-amber-500" : ""}`}>
                      {formatPercent(value, 1, false)}
                    </p>
                    <StatusBadge status={status} />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <MiniBar value={value} soft={elevated} hard={excessive} max={excessive * 1.3} />
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground shrink-0">
                    <span className="text-amber-500">Elevated {formatPercent(elevated, 0, false)}</span>
                    <span className="text-red-500">Excessive {formatPercent(excessive, 0, false)}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ETF contribution breakdown */}
      <div className="rounded-xl border border-border bg-card overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold">Sector Contribution by ETF</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">How each position contributes to total dependency metrics</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="px-5 py-2.5 text-left font-medium text-muted-foreground">ETF</th>
                <th className="px-5 py-2.5 text-left font-medium text-muted-foreground">Weight</th>
                <th className="px-5 py-2.5 text-right font-medium text-muted-foreground">Semiconductor</th>
                <th className="px-5 py-2.5 text-right font-medium text-muted-foreground">Digital Economy</th>
                <th className="px-5 py-2.5 text-right font-medium text-muted-foreground">US Exposure</th>
                <th className="px-5 py-2.5 text-right font-medium text-muted-foreground">AI Infrastructure</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {positions.map((p) => {
                const sw = SECTOR_WEIGHTS[p.ticker]
                if (!sw) return null
                const contrib = {
                  semiconductor: (p.actualPct / 100) * sw.semiconductor,
                  digital:       (p.actualPct / 100) * sw.digital,
                  us:            (p.actualPct / 100) * sw.us,
                  ai:            (p.actualPct / 100) * sw.ai,
                }
                return (
                  <tr key={p.ticker} className="hover:bg-accent/30 transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                        <span className="font-bold">{p.ticker}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground tabular-nums">{formatPercent(p.actualPct, 1, false)}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{formatPercent(contrib.semiconductor, 1, false)}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{formatPercent(contrib.digital, 1, false)}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{formatPercent(contrib.us, 1, false)}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{formatPercent(contrib.ai, 1, false)}</td>
                  </tr>
                )
              })}
              <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                <td className="px-5 py-3 text-muted-foreground">Total</td>
                <td className="px-5 py-3 text-muted-foreground tabular-nums">100.0%</td>
                <td className="px-5 py-3 text-right tabular-nums">{formatPercent(sectorExposure.semiconductor, 1, false)}</td>
                <td className="px-5 py-3 text-right tabular-nums">{formatPercent(sectorExposure.digital, 1, false)}</td>
                <td className="px-5 py-3 text-right tabular-nums">{formatPercent(sectorExposure.us, 1, false)}</td>
                <td className="px-5 py-3 text-right tabular-nums">{formatPercent(sectorExposure.ai, 1, false)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Governance summary */}
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          {
            title: "Contribution Routing",
            body: driftAlerts === 0
              ? "All positions within tolerance. Maintain standard monthly allocation split."
              : `${driftAlerts} position${driftAlerts > 1 ? "s" : ""} outside tolerance band. Redirect contributions to underweight positions before next execution day.`,
            status: driftAlerts === 0 ? "healthy" : "elevated",
          },
          {
            title: "Concentration Review",
            body: companyAlerts === 0
              ? "No single-stock concentration caps breached. Look-through exposure within governance limits."
              : `${companyAlerts} company cap${companyAlerts > 1 ? "s" : ""} breached. Review contributions to QQQM and SMH to reduce concentrated exposure.`,
            status: companyAlerts === 0 ? "healthy" : "elevated",
          },
          {
            title: "Rebalance Trigger",
            body: maxDrift < 5
              ? `Max drift ${formatPercent(maxDrift, 1, false)}. No rebalancing action required. Continue contribution-based routing.`
              : `Max drift ${formatPercent(maxDrift, 1, false)}. Hard trigger review warranted. Redirect contributions to underweight positions first.`,
            status: maxDrift < 5 ? "healthy" : maxDrift < 10 ? "elevated" : "excessive",
          },
        ].map(({ title, body, status }) => (
          <div key={title} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 mb-2">
              {status === "healthy"
                ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                : <AlertTriangle className={`h-3.5 w-3.5 shrink-0 ${status === "excessive" ? "text-red-500" : "text-amber-500"}`} />
              }
              <p className="text-xs font-semibold">{title}</p>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">{body}</p>
          </div>
        ))}
      </div>

      {/* Methodology note */}
      <div className="mt-4 rounded-xl border border-border bg-card p-4">
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          <span className="font-semibold text-foreground">Methodology.</span>{" "}
          Look-through exposures are calculated using approximate ETF holdings data and will vary from published figures.
          Company weights represent recent portfolio snapshots and should be verified against fund provider data quarterly.
          Sector dependency percentages are estimates based on GICS classification and fund mandate analysis.
          All caps are governance soft triggers only — thresholds exist to inform contribution routing, not to mandate automatic sells.
        </p>
      </div>

    </Shell>
  )
}
