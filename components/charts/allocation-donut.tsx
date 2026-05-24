"use client"

import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from "recharts"
import { formatCurrency } from "@/lib/utils"

interface HoldingSlice {
  ticker: string
  name: string
  actualPct: number
  targetPct: number
  color: string
  value: number
}

interface Props {
  data: HoldingSlice[]
  totalValue: number
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: HoldingSlice }> }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="chart-tooltip">
      <div className="flex items-center gap-2 mb-1">
        <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
        <span className="font-bold text-foreground">{d.ticker}</span>
      </div>
      <div className="space-y-0.5 text-[11px] text-muted-foreground">
        <div className="flex justify-between gap-4">
          <span>Actual</span>
          <span className="font-semibold text-foreground tabular-nums">{d.actualPct.toFixed(1)}%</span>
        </div>
        <div className="flex justify-between gap-4">
          <span>Target</span>
          <span className="tabular-nums">{d.targetPct.toFixed(1)}%</span>
        </div>
        <div className="flex justify-between gap-4">
          <span>Value</span>
          <span className="tabular-nums">{formatCurrency(d.value, "USD")}</span>
        </div>
      </div>
    </div>
  )
}

export function AllocationDonut({ data, totalValue }: Props) {
  return (
    <div className="flex flex-col items-center gap-0 chart-enter">
      {/* Donut */}
      <div className="relative w-full" style={{ height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            {/* Outer ring: actual allocation */}
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius="58%"
              outerRadius="80%"
              dataKey="actualPct"
              strokeWidth={2}
              stroke="hsl(var(--card))"
              paddingAngle={2}
              startAngle={90}
              endAngle={-270}
              isAnimationActive={true}
              animationBegin={0}
              animationDuration={1000}
              animationEasing="ease-out"
            >
              {data.map((entry) => (
                <Cell key={entry.ticker} fill={entry.color} />
              ))}
            </Pie>
            {/* Inner ring: target allocation */}
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius="40%"
              outerRadius="54%"
              dataKey="targetPct"
              strokeWidth={2}
              stroke="hsl(var(--card))"
              paddingAngle={2}
              startAngle={90}
              endAngle={-270}
              isAnimationActive={true}
              animationBegin={200}
              animationDuration={1000}
              animationEasing="ease-out"
            >
              {data.map((entry) => (
                <Cell key={entry.ticker} fill={entry.color} fillOpacity={0.35} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
          </PieChart>
        </ResponsiveContainer>

        {/* Centre label */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Total</span>
          <span className="text-xl font-black tabular-nums leading-tight">
            {formatCurrency(totalValue, "USD")}
          </span>
          <span className="text-[10px] text-muted-foreground mt-0.5">USD · IBKR</span>
        </div>
      </div>

      {/* Ring legend */}
      <div className="flex items-center gap-4 text-[11px] text-muted-foreground mb-2">
        <div className="flex items-center gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-foreground/70" />
          <span>Actual (outer)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-foreground/25" />
          <span>Target (inner)</span>
        </div>
      </div>

      {/* Ticker legend */}
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 w-full px-2">
        {data.map((d) => (
          <div key={d.ticker} className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
            <span className="text-[11px] font-semibold text-foreground">{d.ticker}</span>
            <span className="text-[11px] text-muted-foreground">{d.actualPct.toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}
