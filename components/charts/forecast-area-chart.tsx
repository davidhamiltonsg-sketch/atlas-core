"use client"

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts"

export interface ForecastDataPoint {
  year: number
  label: string
  conservative: number
  base: number
  aggressive: number
  savings: number
}

export interface MilestoneMarker {
  value: number
  label: string
}

interface Props {
  data: ForecastDataPoint[]
  currentValue: number
  milestones?: MilestoneMarker[]
}

function formatM(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`
  return `$${v.toFixed(0)}`
}

function CustomTooltip({ active, payload, label }: {
  active?: boolean
  payload?: Array<{ name: string; value: number; color: string }>
  label?: string
}) {
  if (!active || !payload?.length) return null
  const order = ["aggressive", "base", "conservative", "savings"]
  const sorted = [...payload].sort(
    (a, b) => order.indexOf(a.name) - order.indexOf(b.name)
  )
  const nameMap: Record<string, string> = {
    aggressive: "Best case (15%/yr)",
    base: "Expected (10%/yr)",
    conservative: "Cautious (5%/yr)",
    savings: "Cash savings",
  }
  return (
    <div className="chart-tooltip min-w-[180px]">
      <p className="font-bold text-foreground mb-2">{label}</p>
      {sorted.map((p) => (
        <div key={p.name} className="flex items-center justify-between gap-4 text-[11px]">
          <div className="flex items-center gap-1.5">
            <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: p.color }} />
            <span className="text-muted-foreground">{nameMap[p.name] ?? p.name}</span>
          </div>
          <span className="font-semibold text-foreground tabular-nums">{formatM(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

export function ForecastAreaChart({ data, currentValue, milestones = [] }: Props) {
  return (
    <div className="chart-enter">
      <ResponsiveContainer width="100%" height={340}>
        <AreaChart data={data} margin={{ top: 10, right: 16, left: 10, bottom: 0 }}>
          <defs>
            <linearGradient id="gradAggressive" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#22c55e" stopOpacity={0.28} />
              <stop offset="95%" stopColor="#22c55e" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="gradBase" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#1d4ed8" stopOpacity={0.32} />
              <stop offset="95%" stopColor="#1d4ed8" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="gradConservative" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#f59e0b" stopOpacity={0.25} />
              <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="gradSavings" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#64748b" stopOpacity={0.15} />
              <stop offset="95%" stopColor="#64748b" stopOpacity={0.01} />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.5} />

          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            axisLine={false}
            tickLine={false}
            interval={1}
          />
          <YAxis
            tickFormatter={formatM}
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            axisLine={false}
            tickLine={false}
            width={54}
          />

          <Tooltip content={<CustomTooltip />} />

          <ReferenceLine
            y={currentValue}
            stroke="hsl(var(--muted-foreground))"
            strokeDasharray="4 4"
            strokeOpacity={0.5}
            label={{ value: "Today", position: "insideTopLeft", fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
          />
          <ReferenceLine
            x="2045"
            stroke="hsl(var(--primary))"
            strokeDasharray="4 4"
            strokeOpacity={0.6}
            label={{ value: "2045", position: "insideTopRight", fontSize: 10, fill: "hsl(var(--primary))" }}
          />

          {milestones.map(m => (
            <ReferenceLine
              key={m.label}
              y={m.value}
              stroke="#94a3b8"
              strokeDasharray="3 4"
              strokeOpacity={0.6}
              label={{ value: m.label, position: "insideTopRight", fontSize: 9, fill: "#94a3b8" }}
            />
          ))}

          <Area
            type="monotone" dataKey="savings"      name="savings"
            stroke="#64748b" strokeWidth={1.5} strokeDasharray="5 3"
            fill="url(#gradSavings)" dot={false} activeDot={{ r: 4 }}
            isAnimationActive={true} animationBegin={0} animationDuration={1200} animationEasing="ease-out"
          />
          <Area
            type="monotone" dataKey="conservative" name="conservative"
            stroke="#f59e0b" strokeWidth={2}
            fill="url(#gradConservative)" dot={false} activeDot={{ r: 4 }}
            isAnimationActive={true} animationBegin={200} animationDuration={1200} animationEasing="ease-out"
          />
          <Area
            type="monotone" dataKey="base"         name="base"
            stroke="#1d4ed8" strokeWidth={2.5}
            fill="url(#gradBase)" dot={false} activeDot={{ r: 5 }}
            isAnimationActive={true} animationBegin={400} animationDuration={1200} animationEasing="ease-out"
          />
          <Area
            type="monotone" dataKey="aggressive"   name="aggressive"
            stroke="#22c55e" strokeWidth={2}
            fill="url(#gradAggressive)" dot={false} activeDot={{ r: 4 }}
            isAnimationActive={true} animationBegin={600} animationDuration={1200} animationEasing="ease-out"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
