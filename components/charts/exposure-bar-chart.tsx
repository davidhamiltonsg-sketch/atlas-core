"use client"

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from "recharts"

export interface ExposureBar {
  name: string
  value: number
  soft: number
  hard: number
  status: "healthy" | "elevated" | "excessive"
}

interface Props {
  data: ExposureBar[]
  unit?: string
}

function barColor(status: string) {
  if (status === "excessive") return "#ef4444"   /* red  */
  if (status === "elevated")  return "#f59e0b"   /* amber */
  return "#22c55e"                               /* green */
}

function CustomTooltip({ active, payload }: {
  active?: boolean
  payload?: Array<{ payload: ExposureBar }>
}) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  const headroom = d.soft - d.value
  return (
    <div className="chart-tooltip">
      <p className="font-bold text-foreground mb-1.5">{d.name}</p>
      <div className="space-y-0.5 text-[11px]">
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Your exposure</span>
          <span className="font-semibold text-foreground tabular-nums">{d.value.toFixed(1)}%</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-amber-500">Warning limit</span>
          <span className="tabular-nums text-amber-500">{d.soft.toFixed(0)}%</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-red-500">Hard limit</span>
          <span className="tabular-nums text-red-500">{d.hard.toFixed(0)}%</span>
        </div>
        <div className="flex justify-between gap-4 border-t border-border/50 pt-1 mt-1">
          <span className="text-muted-foreground">Headroom</span>
          <span className={`tabular-nums font-semibold ${headroom < 0 ? "text-red-500" : headroom < 2 ? "text-amber-500" : "text-green-500"}`}>
            {headroom >= 0 ? "+" : ""}{headroom.toFixed(1)}%
          </span>
        </div>
      </div>
    </div>
  )
}

export function ExposureBarChart({ data, unit = "%" }: Props) {
  const softCaps = [...new Set(data.map((d) => d.soft))]
  const hardCaps = [...new Set(data.map((d) => d.hard))]
  const maxVal   = Math.max(...data.map((d) => d.hard)) * 1.3

  return (
    <div className="chart-enter">
      <ResponsiveContainer width="100%" height={data.length * 48 + 32}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 32, left: 4, bottom: 4 }}
          barCategoryGap="32%"
        >
          <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.5} />
          <XAxis
            type="number"
            domain={[0, maxVal]}
            tickFormatter={(v: number) => `${v}${unit}`}
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fontSize: 11, fill: "hsl(var(--foreground))", fontWeight: 600 }}
            axisLine={false}
            tickLine={false}
            width={90}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "hsl(var(--accent))", opacity: 0.5 }} />

          <Bar
            dataKey="value"
            radius={[0, 5, 5, 0]}
            maxBarSize={22}
            isAnimationActive={true}
            animationBegin={100}
            animationDuration={900}
            animationEasing="ease-out"
          >
            {data.map((entry) => (
              <Cell key={entry.name} fill={barColor(entry.status)} fillOpacity={0.85} />
            ))}
          </Bar>

          {softCaps.map((cap) => (
            <ReferenceLine
              key={`soft-${cap}`}
              x={cap}
              stroke="#f59e0b"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              strokeOpacity={0.8}
              label={{ value: `${cap}%`, position: "top", fontSize: 9, fill: "#f59e0b" }}
            />
          ))}
          {hardCaps.map((cap) => (
            <ReferenceLine
              key={`hard-${cap}`}
              x={cap}
              stroke="#ef4444"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              strokeOpacity={0.8}
              label={{ value: `${cap}%`, position: "top", fontSize: 9, fill: "#ef4444" }}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
