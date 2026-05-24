"use client"

import { LineChart, Line, ResponsiveContainer, Tooltip } from "recharts"

interface Props {
  data: number[]
  color: string
}

function SparkTooltip({ active, payload }: { active?: boolean; payload?: Array<{ value: number }> }) {
  if (!active || !payload?.length) return null
  const v = payload[0].value
  return (
    <div className="chart-tooltip text-[10px] py-1 px-2">
      ${v >= 1000 ? `${(v / 1000).toFixed(1)}K` : v.toFixed(0)}
    </div>
  )
}

export function Sparkline({ data, color }: Props) {
  if (data.length < 2) return null
  const points = data.map((value, i) => ({ i, value }))
  const isGain = data[data.length - 1] >= data[0]
  const lineColor = isGain ? "#22c55e" : "#ef4444"

  return (
    <ResponsiveContainer width={80} height={32}>
      <LineChart data={points}>
        <Line
          type="monotone"
          dataKey="value"
          stroke={lineColor}
          strokeWidth={1.5}
          dot={false}
          activeDot={{ r: 2, fill: lineColor }}
          isAnimationActive={false}
        />
        <Tooltip content={<SparkTooltip />} />
      </LineChart>
    </ResponsiveContainer>
  )
}
