"use client"

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts"

export interface HistoryPoint {
  label: string
  value: number
}

interface Props {
  data: HistoryPoint[]
  height?: number
  accent?: string
}

function fmt(v: number): string {
  if (v >= 1_000_000) return `S$${(v / 1_000_000).toFixed(2)}M`
  if (v >= 1_000) return `S$${(v / 1_000).toFixed(0)}K`
  return `S$${v.toFixed(0)}`
}

function CustomTooltip({ active, payload, label }: {
  active?: boolean
  payload?: Array<{ value: number }>
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tooltip text-[11px]">
      <p className="text-muted-foreground mb-0.5">{label}</p>
      <p className="font-bold text-foreground">{fmt(payload[0].value)}</p>
    </div>
  )
}

export function PortfolioHistoryChart({ data, height = 260, accent = "var(--deck-accent, #8567ff)" }: Props) {
  if (data.length < 2) {
    return (
      <div className="flex items-center justify-center text-[11px] text-muted-foreground" style={{ height }}>
        Not enough snapshots yet
      </div>
    )
  }

  const min = Math.min(...data.map(d => d.value)) * 0.98
  const max = Math.max(...data.map(d => d.value)) * 1.02
  const color = accent

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 12, right: 8, left: 0, bottom: 4 }}>
        <defs>
          <linearGradient id="histGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={color} stopOpacity={0.42} />
            <stop offset="95%" stopColor={color} stopOpacity={0.015} />
          </linearGradient>
        </defs>
        <XAxis dataKey="label" hide={height <= 90} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
        <YAxis domain={[min, max]} hide={height <= 90} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} tickFormatter={fmt} width={60} />
        <Tooltip content={<CustomTooltip />} />
        <Area
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={3}
          fill="url(#histGrad)"
          dot={height > 90 ? { r: 3, fill: color, strokeWidth: 0 } : false}
          activeDot={{ r: 4, fill: color }}
          isAnimationActive={true}
          animationDuration={800}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
