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

const SUCCESS = "hsl(var(--success))"
const WARNING = "hsl(var(--warning))"
const DANGER  = "hsl(var(--danger))"

// Each row is normalised to its OWN hard cap (bullet-graph style): bar length =
// share of that row's hard limit in use, so a 10%-cap satellite is as readable
// as an 80%-cap core sleeve on the same axis. 100% = the hard cap for every
// row; the amber tick marks each row's own soft/warning cap. A shared linear
// axis was illegible at the real cap mix (80/15/10/8/15) — small-cap rows
// compressed into slivers.
const AXIS_MAX = 130 // headroom past the cap so breaches remain visible

function barColor(status: string) {
  if (status === "excessive") return DANGER
  if (status === "elevated")  return WARNING
  return SUCCESS
}

function CustomTooltip({ active, payload, unit }: {
  active?: boolean
  payload?: Array<{ payload: ExposureBar & { util: number } }>
  unit: string
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
          <span className="font-semibold text-foreground tabular-nums">{d.value.toFixed(1)}{unit}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-warning">Warning limit</span>
          <span className="tabular-nums text-warning">{d.soft.toFixed(0)}{unit}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-danger">Hard limit</span>
          <span className="tabular-nums text-danger">{d.hard.toFixed(0)}{unit}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Cap in use</span>
          <span className="font-semibold text-foreground tabular-nums">{d.util.toFixed(0)}%</span>
        </div>
        <div className="flex justify-between gap-4 border-t border-border/50 pt-1 mt-1">
          <span className="text-muted-foreground">Headroom</span>
          <span className={`tabular-nums font-semibold ${headroom < 0 ? "text-danger" : headroom < 2 ? "text-warning" : "text-success"}`}>
            {headroom >= 0 ? "+" : ""}{headroom.toFixed(1)}{unit}
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
  payload: ExposureBar & { util: number; softUtil: number }
}

export function ExposureBarChart({ data, unit = "%" }: Props) {
  // util = % of the row's own hard cap in use; displayed bar clamps at AXIS_MAX.
  const rows = data
    .filter((d) => d.hard > 0)
    .map((d) => ({
      ...d,
      util: Math.min((d.value / d.hard) * 100, AXIS_MAX),
      softUtil: Math.min((d.soft / d.hard) * 100, 100),
    }))
  if (rows.length === 0) return null

  // Per-row zone tints behind each bar: 0→soft (healthy), soft→hard (warning),
  // past the cap (danger), with an amber tick at the row's own soft cap. The
  // hard cap needs no per-row tick — normalisation puts it at 100% for every
  // row, drawn once as the shared reference line below.
  const renderZones = (props: unknown) => {
    const { x, y, width, height, payload } = props as ZoneShapeProps
    const px = (v: number) => x + (Math.min(v, AXIS_MAX) / AXIS_MAX) * width
    const softX = px(payload.softUtil)
    const hardX = px(100)
    return (
      <g aria-hidden>
        <rect x={x} y={y} width={softX - x} height={height} fill={SUCCESS} fillOpacity={0.08} />
        <rect x={softX} y={y} width={Math.max(0, hardX - softX)} height={height} fill={WARNING} fillOpacity={0.10} />
        <rect x={hardX} y={y} width={Math.max(0, x + width - hardX)} height={height} fill={DANGER} fillOpacity={0.10} />
        <rect x={softX - 0.75} y={y - 2} width={1.5} height={height + 4} fill={WARNING} fillOpacity={0.7} />
      </g>
    )
  }

  return (
    <div className="chart-enter">
      <ResponsiveContainer width="100%" height={rows.length * 48 + 32}>
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ top: 4, right: 32, left: 4, bottom: 4 }}
          barCategoryGap="32%"
        >
          <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.5} />
          <XAxis
            type="number"
            domain={[0, AXIS_MAX]}
            ticks={[0, 25, 50, 75, 100]}
            tickFormatter={(v: number) => `${v}%`}
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
          <Tooltip content={<CustomTooltip unit={unit} />} cursor={{ fill: "hsl(var(--accent))", opacity: 0.5 }} />

          {/* Normalisation puts every row's hard cap at 100% — one shared line is correct here. */}
          <ReferenceLine
            x={100}
            stroke={DANGER}
            strokeWidth={1.5}
            strokeDasharray="4 3"
            strokeOpacity={0.8}
            label={{ value: "hard cap", position: "top", fontSize: 9, fill: DANGER }}
          />

          <Bar
            dataKey="util"
            radius={[0, 5, 5, 0]}
            maxBarSize={22}
            background={renderZones}
            isAnimationActive={true}
            animationBegin={100}
            animationDuration={900}
            animationEasing="ease-out"
          >
            {rows.map((entry) => (
              <Cell key={entry.name} fill={barColor(entry.status)} fillOpacity={0.85} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="mt-1 text-[10px] text-muted-foreground">
        Bar length = share of each row&apos;s own hard limit in use · amber tick = that row&apos;s warning cap · 100% = hard cap. Hover for actual weights.
      </p>
    </div>
  )
}
