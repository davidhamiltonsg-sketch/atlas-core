"use client"

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
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

const SUCCESS = "hsl(var(--success))"
const WARNING = "hsl(var(--warning))"
const DANGER  = "hsl(var(--danger))"

function barColor(status: string) {
  if (status === "excessive") return DANGER
  if (status === "elevated")  return WARNING
  return SUCCESS
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
          <span className="text-warning">Warning limit</span>
          <span className="tabular-nums text-warning">{d.soft.toFixed(0)}%</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-danger">Hard limit</span>
          <span className="tabular-nums text-danger">{d.hard.toFixed(0)}%</span>
        </div>
        <div className="flex justify-between gap-4 border-t border-border/50 pt-1 mt-1">
          <span className="text-muted-foreground">Headroom</span>
          <span className={`tabular-nums font-semibold ${headroom < 0 ? "text-danger" : headroom < 2 ? "text-warning" : "text-success"}`}>
            {headroom >= 0 ? "+" : ""}{headroom.toFixed(1)}%
          </span>
        </div>
      </div>
    </div>
  )
}

// Geometry Recharts hands a custom Bar `background` shape: the full-domain
// rect for this row (x = plot left, width = plot width) plus the row's datum.
interface ZoneShapeProps {
  x: number
  y: number
  width: number
  height: number
  payload: ExposureBar
}

export function ExposureBarChart({ data, unit = "%" }: Props) {
  const maxVal = Math.max(...data.map((d) => d.hard)) * 1.3

  // Per-row drift zones painted behind each value bar: 0→soft healthy tint,
  // soft→hard warning tint, >hard danger tint, with a tick at each boundary.
  // Rows keep their own caps — no shared ReferenceLines, which were wrong
  // whenever soft/hard differed between rows.
  const renderZones = (props: unknown) => {
    const { x, y, width, height, payload } = props as ZoneShapeProps
    const px = (v: number) => x + (Math.min(v, maxVal) / maxVal) * width
    const softX = px(payload.soft)
    const hardX = px(payload.hard)
    return (
      <g aria-hidden>
        <rect x={x} y={y} width={softX - x} height={height} fill={SUCCESS} fillOpacity={0.08} />
        <rect x={softX} y={y} width={Math.max(0, hardX - softX)} height={height} fill={WARNING} fillOpacity={0.10} />
        <rect x={hardX} y={y} width={Math.max(0, x + width - hardX)} height={height} fill={DANGER} fillOpacity={0.10} />
        {/* Boundary ticks — this row's own soft / hard caps */}
        <rect x={softX - 0.75} y={y - 2} width={1.5} height={height + 4} fill={WARNING} fillOpacity={0.7} />
        <rect x={hardX - 0.75} y={y - 2} width={1.5} height={height + 4} fill={DANGER} fillOpacity={0.7} />
      </g>
    )
  }

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
            background={renderZones}
            isAnimationActive={true}
            animationBegin={100}
            animationDuration={900}
            animationEasing="ease-out"
          >
            {data.map((entry) => (
              <Cell key={entry.name} fill={barColor(entry.status)} fillOpacity={0.85} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
