"use client"

import { formatCurrency } from "@/lib/utils"

export interface ProjectionPoint {
  month: number
  conservative: number
  base: number
  aggressive: number
  invested: number
}

interface EquityCurveProps {
  points: ProjectionPoint[]
  currentMonth: number
  currentValue: number
  targetValue: number
  currency?: string
}

const W = 600
const H = 240
const PT = 24
const PB = 36
const PL = 24
const PR = 16

export function EquityCurve({ points, currentMonth, currentValue, targetValue, currency = "SGD" }: EquityCurveProps) {
  if (points.length < 2) return null

  const totalMonths = points[points.length - 1].month
  const maxVal = Math.max(
    ...points.map(p => p.aggressive),
    targetValue * 1.05,
  )

  const x = (m: number) => PL + (m / totalMonths) * (W - PL - PR)
  const y = (v: number) => H - PB - (v / maxVal) * (H - PT - PB)

  const toPath = (accessor: (p: ProjectionPoint) => number) =>
    points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.month).toFixed(1)} ${y(accessor(p)).toFixed(1)}`).join(" ")

  const aggPath = toPath(p => p.aggressive)
  const basePath = toPath(p => p.base)
  const consPath = toPath(p => p.conservative)
  const investedPath = toPath(p => p.invested)

  // Fan band between aggressive and conservative
  const topPoints = points.map(p => `${x(p.month).toFixed(1)} ${y(p.aggressive).toFixed(1)}`)
  const bottomPoints = [...points].reverse().map(p => `${x(p.month).toFixed(1)} ${y(p.conservative).toFixed(1)}`)
  const bandPath = `M${topPoints.join(" L")} L${bottomPoints.join(" L")} Z`

  // Target line
  const targetY = y(targetValue)

  // Today marker
  const todayX = x(currentMonth)
  const todayY = y(currentValue)

  // Y-axis grid
  const gridValues = [0.25, 0.5, 0.75, 1.0].map(f => Math.round(f * maxVal))

  return (
    <div className="rounded-2xl border border-border bg-card/50 p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Where the road leads</p>
          <p className="text-xs text-muted-foreground mt-0.5">Projected portfolio value over time</p>
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Projected portfolio value over time">
        {/* Grid lines */}
        {gridValues.map((v, i) => (
          <g key={i}>
            <line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} stroke="currentColor" strokeOpacity={0.06} />
            <text x={PL - 4} y={y(v) + 3} textAnchor="end" className="fill-muted-foreground/40" fontSize="8" fontFamily="monospace">
              {v >= 1000 ? `${Math.round(v / 1000)}k` : v}
            </text>
          </g>
        ))}

        {/* Fan band */}
        <path d={bandPath} fill="rgb(56 189 248)" opacity={0.06} />

        {/* Projection lines */}
        <path d={aggPath} fill="none" stroke="rgb(34 197 94)" strokeWidth={1.2} strokeDasharray="4 3" opacity={0.5} />
        <path d={basePath} fill="none" stroke="rgb(56 189 248)" strokeWidth={1.8} />
        <path d={consPath} fill="none" stroke="rgb(245 158 11)" strokeWidth={1.2} strokeDasharray="4 3" opacity={0.5} />

        {/* Target line */}
        <line x1={PL} x2={W - PR} y1={targetY} y2={targetY} stroke="rgb(168 85 247)" strokeWidth={1} strokeDasharray="6 4" opacity={0.5} />
        <text x={W - PR + 2} y={targetY + 3} className="fill-purple-400/60" fontSize="8" fontFamily="monospace">goal</text>

        {/* Invested capital floor */}
        <path d={investedPath} fill="none" stroke="currentColor" strokeWidth={1} opacity={0.15} strokeDasharray="2 3" />

        {/* Today marker */}
        {currentMonth > 0 && currentValue > 0 && (
          <>
            <line x1={todayX} x2={todayX} y1={PT} y2={H - PB} stroke="rgb(56 189 248)" strokeWidth={0.7} opacity={0.3} />
            <circle cx={todayX} cy={todayY} r={4} fill="rgb(56 189 248)" stroke="rgb(14 165 233)" strokeWidth={1.5} />
          </>
        )}

        {/* X-axis labels */}
        {[0, Math.round(totalMonths * 0.25), Math.round(totalMonths * 0.5), Math.round(totalMonths * 0.75), totalMonths].map(m => (
          <text key={m} x={x(m)} y={H - PB + 14} textAnchor="middle" className="fill-muted-foreground/40" fontSize="8" fontFamily="monospace">
            M{m}
          </text>
        ))}
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 justify-center">
        <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="h-0.5 w-4 bg-green-500/50 inline-block" style={{ borderBottom: "1px dashed rgb(34 197 94)" }} /> Aggressive
        </span>
        <span className="flex items-center gap-1.5 text-[10px] text-sky-400 font-semibold">
          <span className="h-0.5 w-4 bg-sky-400 inline-block rounded-full" /> Base
        </span>
        <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="h-0.5 w-4 bg-amber-500/50 inline-block" style={{ borderBottom: "1px dashed rgb(245 158 11)" }} /> Conservative
        </span>
        <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="h-0.5 w-4 bg-purple-400/50 inline-block" style={{ borderBottom: "1px dashed rgb(168 85 247)" }} /> Goal
        </span>
        {currentMonth > 0 && (
          <span className="flex items-center gap-1.5 text-[10px] text-sky-400">
            <span className="h-2 w-2 bg-sky-400 rounded-full inline-block" /> Now
          </span>
        )}
      </div>
    </div>
  )
}
