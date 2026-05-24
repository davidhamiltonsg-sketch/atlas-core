"use client"

import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts"

interface Props {
  score: number
  label: string
}

export function HealthGauge({ score, label }: Props) {
  const clamped = Math.max(0, Math.min(100, score))
  const filled  = clamped
  const empty   = 100 - clamped

  const isGood    = clamped >= 80
  const isWarning = clamped >= 60 && clamped < 80
  const isCritical = clamped < 60

  const color      = isGood ? "#22c55e" : isWarning ? "#f59e0b" : "#ef4444"
  const animClass  = isGood ? "gauge-healthy" : isWarning ? "gauge-warning" : "gauge-critical"
  const statusText = isGood ? "All good" : isWarning ? "Needs attention" : "Action required"
  const statusEmoji = isGood ? "✓" : isWarning ? "!" : "!!"

  return (
    <div className={`flex flex-col items-center ${animClass}`}>
      {/* Arc chart — half-circle, cy="100%" keeps arc at bottom of SVG */}
      <div style={{ width: 190, height: 105 }}>
        <ResponsiveContainer width="100%" height={105}>
          <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
            {/* Background track */}
            <Pie
              data={[{ value: 100 }]}
              cx="50%"
              cy="100%"
              startAngle={180}
              endAngle={0}
              innerRadius={52}
              outerRadius={74}
              dataKey="value"
              strokeWidth={0}
              isAnimationActive={false}
            >
              <Cell fill="hsl(var(--muted))" fillOpacity={0.6} />
            </Pie>
            {/* Filled arc */}
            <Pie
              data={[{ value: filled }, { value: empty }]}
              cx="50%"
              cy="100%"
              startAngle={180}
              endAngle={0}
              innerRadius={52}
              outerRadius={74}
              dataKey="value"
              strokeWidth={0}
              paddingAngle={filled > 0 && empty > 0 ? 2 : 0}
              isAnimationActive={true}
              animationBegin={100}
              animationDuration={1400}
              animationEasing="ease-out"
            >
              <Cell fill={color} />
              <Cell fill="transparent" />
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* Score display — sits below the arc in normal flow */}
      <div className="flex flex-col items-center -mt-1 mb-1">
        <div className="flex items-baseline gap-1">
          <span className="text-4xl font-black tabular-nums leading-none" style={{ color }}>
            {clamped}
          </span>
          <span className="text-base font-bold text-muted-foreground">/100</span>
        </div>
        <span
          className="mt-1 text-xs font-bold tracking-wide uppercase px-2.5 py-0.5 rounded-full"
          style={{
            color,
            backgroundColor: `${color}18`,
            border: `1px solid ${color}40`,
          }}
        >
          {statusEmoji} {statusText}
        </span>
        <span className="text-xs text-muted-foreground mt-1">{label}</span>
      </div>

      {/* Scale markers */}
      <div className="flex justify-between w-[160px] mt-1 text-[10px] text-muted-foreground">
        <span>0</span>
        <span className="text-amber-500 font-semibold">60</span>
        <span className="text-green-500 font-semibold">80</span>
        <span>100</span>
      </div>
    </div>
  )
}
