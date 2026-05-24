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
}

function fmt(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`
  return `$${v.toFixed(0)}`
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

export function PortfolioHistoryChart({ data }: Props) {
  if (data.length < 2) {
    return (
      <div className="flex items-center justify-center h-[90px] text-[11px] text-muted-foreground">
        Not enough snapshots yet
      </div>
    )
  }

  const min = Math.min(...data.map(d => d.value)) * 0.98
  const max = Math.max(...data.map(d => d.value)) * 1.02
  const isGain = data[data.length - 1].value >= data[0].value
  const color = isGain ? "#22c55e" : "#ef4444"

  return (
    <ResponsiveContainer width="100%" height={90}>
      <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="histGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={color} stopOpacity={0.3} />
            <stop offset="95%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <XAxis dataKey="label" hide />
        <YAxis domain={[min, max]} hide />
        <Tooltip content={<CustomTooltip />} />
        <Area
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2}
          fill="url(#histGrad)"
          dot={false}
          activeDot={{ r: 3, fill: color }}
          isAnimationActive={true}
          animationDuration={800}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
