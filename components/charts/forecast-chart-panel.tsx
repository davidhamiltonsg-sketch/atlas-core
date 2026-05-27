"use client"

import { useState } from "react"
import {
  AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts"
import { TrendingUp, Activity, DollarSign } from "lucide-react"

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ExtendedForecastPoint {
  year: number
  label: string
  yr: number
  // Nominal scenarios
  conservative: number
  base: number
  aggressive: number
  savings: number
  // Real (inflation-adjusted)
  realConservative: number
  realBase: number
  realAggressive: number
  realSavings: number
  // Uncertainty cone (log-normal P10/P90 around base)
  coneP10: number
  coneP90: number
  realConeP10: number
  realConeP90: number
  // Contribution sensitivity at base CAGR
  contribLow: number
  contribHigh: number
}

export interface MilestoneMarker {
  value: number
  label: string
}

interface Props {
  data: ExtendedForecastPoint[]
  currentValue: number
  milestones?: MilestoneMarker[]
  monthlyContribution: number
}

// ── Formatters ─────────────────────────────────────────────────────────────────

function fmt(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`
  return `$${v.toFixed(0)}`
}

function fmtShort(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`
  return `$${v.toFixed(0)}`
}

// ── Tooltips ───────────────────────────────────────────────────────────────────

function ScenarioTooltip({ active, payload, label, inflated }: {
  active?: boolean
  payload?: Array<{ name: string; value: number; color: string }>
  label?: string
  inflated?: boolean
}) {
  if (!active || !payload?.length) return null
  const order = ["aggressive", "base", "conservative", "savings"]
  const sorted = [...payload].sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name))
  const nameMap: Record<string, string> = {
    aggressive:   "Best case (15%)",
    base:         "Base case (10%)",
    conservative: "Conservative (5%)",
    savings:      "Cash savings (3%)",
  }
  return (
    <div className="chart-tooltip min-w-[200px]">
      <div className="flex items-center justify-between mb-2">
        <p className="font-bold text-foreground text-xs">{label}</p>
        {inflated && <span className="text-[10px] text-muted-foreground">Real (2.5% CPI)</span>}
      </div>
      {sorted.map((p) => (
        <div key={p.name} className="flex items-center justify-between gap-4 text-[11px] mb-0.5">
          <div className="flex items-center gap-1.5">
            <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: p.color }} />
            <span className="text-muted-foreground">{nameMap[p.name] ?? p.name}</span>
          </div>
          <span className="font-semibold text-foreground tabular-nums">{fmtShort(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

function ConeTooltip({ active, payload, label, inflated }: {
  active?: boolean
  payload?: Array<{ name: string; value: number; color: string }>
  label?: string
  inflated?: boolean
}) {
  if (!active || !payload?.length) return null
  const p10Entry  = payload.find(p => p.name === "coneP10")
  const spreadEntry = payload.find(p => p.name === "coneSpreadVal")
  const baseEntry = payload.find(p => p.name === "base")
  const p10 = p10Entry?.value ?? 0
  const p90 = p10 + (spreadEntry?.value ?? 0)
  const base = baseEntry?.value ?? 0
  return (
    <div className="chart-tooltip min-w-[200px]">
      <div className="flex items-center justify-between mb-2">
        <p className="font-bold text-foreground text-xs">{label}</p>
        {inflated && <span className="text-[10px] text-muted-foreground">Real (2.5% CPI)</span>}
      </div>
      <div className="space-y-1 text-[11px]">
        <div className="flex justify-between gap-4">
          <div className="flex items-center gap-1.5">
            <div className="h-1.5 w-1.5 rounded-full bg-green-500/60" />
            <span className="text-muted-foreground">P90 (optimistic)</span>
          </div>
          <span className="font-semibold text-foreground tabular-nums">{fmtShort(p90)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <div className="flex items-center gap-1.5">
            <div className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
            <span className="text-muted-foreground">Base (expected)</span>
          </div>
          <span className="font-bold text-foreground tabular-nums">{fmtShort(base)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <div className="flex items-center gap-1.5">
            <div className="h-1.5 w-1.5 rounded-full bg-amber-500/60" />
            <span className="text-muted-foreground">P10 (adverse)</span>
          </div>
          <span className="font-semibold text-foreground tabular-nums">{fmtShort(p10)}</span>
        </div>
        <p className="text-[10px] text-muted-foreground pt-1 border-t border-border mt-1">
          80% probability interval · 15% annual vol
        </p>
      </div>
    </div>
  )
}

function ContribTooltip({ active, payload, label, monthlyContribution }: {
  active?: boolean
  payload?: Array<{ name: string; value: number; color: string }>
  label?: string
  monthlyContribution?: number
}) {
  if (!active || !payload?.length) return null
  const order = ["contribHigh", "base", "contribLow"]
  const sorted = [...payload].sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name))
  const mc = monthlyContribution ?? 3000
  const nameMap: Record<string, string> = {
    contribHigh: `+20% ($${Math.round(mc * 1.2).toLocaleString()}/mo)`,
    base:        `Current ($${mc.toLocaleString()}/mo)`,
    contribLow:  `−20% ($${Math.round(mc * 0.8).toLocaleString()}/mo)`,
  }
  return (
    <div className="chart-tooltip min-w-[220px]">
      <p className="font-bold text-foreground text-xs mb-2">{label}</p>
      {sorted.map((p) => (
        <div key={p.name} className="flex items-center justify-between gap-4 text-[11px] mb-0.5">
          <div className="flex items-center gap-1.5">
            <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: p.color }} />
            <span className="text-muted-foreground">{nameMap[p.name] ?? p.name}</span>
          </div>
          <span className="font-semibold text-foreground tabular-nums">{fmtShort(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

// ── Chart Renderers ────────────────────────────────────────────────────────────

function ScenarioChart({ data, currentValue, milestones, inflated }: {
  data: ExtendedForecastPoint[]
  currentValue: number
  milestones: MilestoneMarker[]
  inflated: boolean
}) {
  const chartData = data.map(d => ({
    label: d.label,
    conservative: inflated ? d.realConservative : d.conservative,
    base:         inflated ? d.realBase         : d.base,
    aggressive:   inflated ? d.realAggressive   : d.aggressive,
    savings:      inflated ? d.realSavings       : d.savings,
  }))
  const maxVal = inflated
    ? data[data.length - 1].realAggressive
    : data[data.length - 1].aggressive

  return (
    <ResponsiveContainer width="100%" height={360}>
      <AreaChart data={chartData} margin={{ top: 12, right: 16, left: 10, bottom: 0 }}>
        <defs>
          <linearGradient id="sgAggressive" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#22c55e" stopOpacity={0.22} />
            <stop offset="95%" stopColor="#22c55e" stopOpacity={0.01} />
          </linearGradient>
          <linearGradient id="sgBase" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.30} />
            <stop offset="95%" stopColor="#6366f1" stopOpacity={0.01} />
          </linearGradient>
          <linearGradient id="sgConservative" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#a78bfa" stopOpacity={0.22} />
            <stop offset="95%" stopColor="#a78bfa" stopOpacity={0.01} />
          </linearGradient>
          <linearGradient id="sgSavings" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#64748b" stopOpacity={0.12} />
            <stop offset="95%" stopColor="#64748b" stopOpacity={0.01} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.4} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} interval={1} />
        <YAxis tickFormatter={fmtShort} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={56} />
        <Tooltip content={<ScenarioTooltip inflated={inflated} />} />
        <ReferenceLine y={inflated ? currentValue : currentValue} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" strokeOpacity={0.5} label={{ value: "Today", position: "insideTopLeft", fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
        <ReferenceLine x="2045" stroke="hsl(var(--primary))" strokeDasharray="4 4" strokeOpacity={0.5} label={{ value: "2045", position: "insideTopRight", fontSize: 10, fill: "hsl(var(--primary))" }} />
        {milestones.filter(m => m.value < maxVal).map(m => (
          <ReferenceLine key={m.label} y={m.value} stroke="#94a3b8" strokeDasharray="3 4" strokeOpacity={0.5} label={{ value: m.label, position: "insideTopRight", fontSize: 9, fill: "#94a3b8" }} />
        ))}
        <Area type="monotone" dataKey="savings"      name="savings"       stroke="#64748b" strokeWidth={1.5} strokeDasharray="5 3" fill="url(#sgSavings)"      dot={false} activeDot={{ r: 3 }} animationDuration={1000} />
        <Area type="monotone" dataKey="conservative" name="conservative"  stroke="#a78bfa" strokeWidth={2}   fill="url(#sgConservative)" dot={false} activeDot={{ r: 3 }} animationBegin={150} animationDuration={1000} />
        <Area type="monotone" dataKey="base"         name="base"          stroke="#6366f1" strokeWidth={2.5} fill="url(#sgBase)"          dot={false} activeDot={{ r: 4 }} animationBegin={300} animationDuration={1000} />
        <Area type="monotone" dataKey="aggressive"   name="aggressive"    stroke="#22c55e" strokeWidth={2}   fill="url(#sgAggressive)"   dot={false} activeDot={{ r: 3 }} animationBegin={450} animationDuration={1000} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

function ConeChart({ data, currentValue, inflated }: {
  data: ExtendedForecastPoint[]
  currentValue: number
  inflated: boolean
}) {
  const chartData = data.map(d => {
    const p10 = inflated ? d.realConeP10 : d.coneP10
    const p90 = inflated ? d.realConeP90 : d.coneP90
    return {
      label: d.label,
      coneP10: p10,
      coneSpreadVal: Math.max(0, p90 - p10),
      base: inflated ? d.realBase : d.base,
    }
  })

  return (
    <div>
      <ResponsiveContainer width="100%" height={360}>
        <AreaChart data={chartData} margin={{ top: 12, right: 16, left: 10, bottom: 0 }}>
          <defs>
            <linearGradient id="gradCone" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.20} />
              <stop offset="95%" stopColor="#6366f1" stopOpacity={0.04} />
            </linearGradient>
            <linearGradient id="gradConeFloor" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor="transparent" stopOpacity={0} />
              <stop offset="100%" stopColor="transparent" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.4} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} interval={1} />
          <YAxis tickFormatter={fmtShort} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={56} />
          <Tooltip content={<ConeTooltip inflated={inflated} />} />
          <ReferenceLine y={currentValue} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" strokeOpacity={0.5} label={{ value: "Today", position: "insideTopLeft", fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
          <ReferenceLine x="2045" stroke="hsl(var(--primary))" strokeDasharray="4 4" strokeOpacity={0.4} label={{ value: "2045", position: "insideTopRight", fontSize: 10, fill: "hsl(var(--primary))" }} />
          {/* Cone band: stack P10 (transparent floor) + spread (visible fill) */}
          <Area type="monotone" dataKey="coneP10"      name="coneP10"      stackId="cone" stroke="none" fill="url(#gradConeFloor)" dot={false} activeDot={false} legendType="none" animationDuration={900} />
          <Area type="monotone" dataKey="coneSpreadVal" name="coneSpreadVal" stackId="cone" stroke="none" fill="url(#gradCone)"      dot={false} activeDot={false} legendType="none" animationDuration={900} />
          {/* Base case line on top */}
          <Area type="monotone" dataKey="base" name="base" stroke="#6366f1" strokeWidth={2.5} fill="none" dot={false} activeDot={{ r: 4 }} animationBegin={300} animationDuration={900} />
        </AreaChart>
      </ResponsiveContainer>
      <div className="mt-3 flex flex-wrap gap-4 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-2">
          <div className="h-3 w-8 rounded" style={{ background: "linear-gradient(to right, rgba(99,102,241,0.05), rgba(99,102,241,0.22))" }} />
          <span>P10–P90 range (80% probability)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-0.5 w-6 rounded bg-indigo-500" />
          <span>Base case (10% p.a.)</span>
        </div>
        <div className="flex items-center gap-1.5 ml-auto">
          <span className="text-[10px]">Model: log-normal · σ = 15% annual vol</span>
        </div>
      </div>
    </div>
  )
}

function ContribChart({ data, currentValue, monthlyContribution }: {
  data: ExtendedForecastPoint[]
  currentValue: number
  monthlyContribution: number
}) {
  const chartData = data.map(d => ({
    label: d.label,
    contribHigh: d.contribHigh,
    base:        d.base,
    contribLow:  d.contribLow,
  }))

  return (
    <div>
      <ResponsiveContainer width="100%" height={360}>
        <AreaChart data={chartData} margin={{ top: 12, right: 16, left: 10, bottom: 0 }}>
          <defs>
            <linearGradient id="gcHigh" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#22c55e" stopOpacity={0.22} />
              <stop offset="95%" stopColor="#22c55e" stopOpacity={0.01} />
            </linearGradient>
            <linearGradient id="gcBase" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.28} />
              <stop offset="95%" stopColor="#6366f1" stopOpacity={0.01} />
            </linearGradient>
            <linearGradient id="gcLow" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#f59e0b" stopOpacity={0.20} />
              <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.4} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} interval={1} />
          <YAxis tickFormatter={fmtShort} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={56} />
          <Tooltip content={<ContribTooltip monthlyContribution={monthlyContribution} />} />
          <ReferenceLine y={currentValue} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" strokeOpacity={0.5} label={{ value: "Today", position: "insideTopLeft", fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
          <ReferenceLine x="2045" stroke="hsl(var(--primary))" strokeDasharray="4 4" strokeOpacity={0.4} label={{ value: "2045", position: "insideTopRight", fontSize: 10, fill: "hsl(var(--primary))" }} />
          <Area type="monotone" dataKey="contribLow"  name="contribLow"  stroke="#f59e0b" strokeWidth={1.5} fill="url(#gcLow)"  dot={false} activeDot={{ r: 3 }} animationDuration={900} />
          <Area type="monotone" dataKey="base"        name="base"        stroke="#6366f1" strokeWidth={2.5} fill="url(#gcBase)" dot={false} activeDot={{ r: 4 }} animationBegin={150} animationDuration={900} />
          <Area type="monotone" dataKey="contribHigh" name="contribHigh" stroke="#22c55e" strokeWidth={1.5} fill="url(#gcHigh)" dot={false} activeDot={{ r: 3 }} animationBegin={300} animationDuration={900} />
        </AreaChart>
      </ResponsiveContainer>
      <div className="mt-3 flex flex-wrap gap-4 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-2">
          <div className="h-0.5 w-6 rounded bg-green-500" />
          <span>+20% contributions (${Math.round(monthlyContribution * 1.2).toLocaleString()}/mo)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-0.5 w-6 rounded bg-indigo-500" />
          <span>Current (${monthlyContribution.toLocaleString()}/mo)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-0.5 w-6 rounded bg-amber-500" />
          <span>−20% (${Math.round(monthlyContribution * 0.8).toLocaleString()}/mo)</span>
        </div>
        <div className="flex items-center gap-1.5 ml-auto text-[10px]">
          All at 10% p.a. CAGR
        </div>
      </div>
    </div>
  )
}

// ── Main panel ─────────────────────────────────────────────────────────────────

const VIEWS = [
  { id: "scenarios",     label: "Scenarios",    icon: TrendingUp, desc: "Conservative / Base / Aggressive / Cash" },
  { id: "cone",          label: "Uncertainty",  icon: Activity,   desc: "P10–P90 probability range at base CAGR" },
  { id: "contributions", label: "Contributions", icon: DollarSign, desc: "Impact of ±20% monthly contributions" },
] as const

type ViewId = typeof VIEWS[number]["id"]

export function ForecastChartPanel({ data, currentValue, milestones = [], monthlyContribution }: Props) {
  const [view, setView] = useState<ViewId>("scenarios")
  const [inflated, setInflated] = useState(false)
  const showInflationToggle = view !== "contributions"

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-5">
        {/* View tabs */}
        <div className="flex rounded-lg border border-border bg-muted/40 p-0.5 gap-0.5">
          {VIEWS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setView(id)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                view === id
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        {/* Inflation toggle */}
        {showInflationToggle && (
          <button
            onClick={() => setInflated(v => !v)}
            className={`ml-auto flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
              inflated
                ? "border-indigo-500/50 bg-indigo-500/10 text-indigo-400"
                : "border-border bg-muted/40 text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${inflated ? "bg-indigo-400" : "bg-muted-foreground"}`} />
            {inflated ? "Real values (−2.5% CPI)" : "Nominal values"}
          </button>
        )}
      </div>

      {/* View description */}
      <p className="text-[11px] text-muted-foreground mb-3">
        {VIEWS.find(v => v.id === view)?.desc}
        {inflated && showInflationToggle && " · inflation-adjusted"}
      </p>

      {/* Chart */}
      <div className="chart-enter">
        {view === "scenarios" && (
          <ScenarioChart data={data} currentValue={currentValue} milestones={milestones} inflated={inflated} />
        )}
        {view === "cone" && (
          <ConeChart data={data} currentValue={currentValue} inflated={inflated} />
        )}
        {view === "contributions" && (
          <ContribChart data={data} currentValue={currentValue} monthlyContribution={monthlyContribution} />
        )}
      </div>

      {/* Disclaimer */}
      {view === "cone" && (
        <div className="mt-4 rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-[11px] text-muted-foreground leading-relaxed">
          <strong className="text-foreground">Reading the cone:</strong> The shaded region represents the 80% probability interval —
          in 8 out of 10 market histories, the outcome would fall within this range.
          In 1 out of 10, it would be worse than the P10 floor. Tail risks (deep recessions, lost decades) are not fully captured.
          The cone widens with time because annual return variance compounds. Consistent contributions narrow the dispersion relative to a pure lump-sum investment.
        </div>
      )}
      {view === "contributions" && (
        <div className="mt-4 rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-[11px] text-muted-foreground leading-relaxed">
          <strong className="text-foreground">Contribution leverage:</strong> Over a 19-year horizon,
          increasing monthly contributions by 20% typically produces a larger terminal wealth improvement than a 1–2% increase in annual returns.
          This is because contributions are within your direct control — returns are not.
        </div>
      )}
    </div>
  )
}
