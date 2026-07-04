export interface ThresholdGaugeRow {
  ticker: string
  color: string
  classification: string
  target: number
  hardLow: number
  hardHigh: number
  softLow: number
  softHigh: number
  healthyLow: number
  healthyHigh: number
}

// Shared "where each position stands" gauge — a labeled threshold bar showing the current
// weight against the healthy (green), warning (amber), and hard-limit (red) zones. Built for
// the Atlas governance page; reused as-is for SBR's constitution page so both portfolios get
// the same live, animated read of their positions rather than a static rules table.
export function ThresholdGauge({ rows, allocMap }: { rows: ThresholdGaugeRow[]; allocMap: Record<string, number> }) {
  return (
    <div className="divide-y divide-border">
      {rows.map((t) => {
        const actual = allocMap[t.ticker] ?? 0
        const isHard = actual > t.hardHigh || (t.hardLow > 0 && actual < t.hardLow)
        const isSoft = !isHard && (actual > t.healthyHigh || (t.healthyLow > 0 && actual < t.healthyLow))

        const barColor = isHard ? "#ef4444" : isSoft ? "#f59e0b" : "#22c55e"
        const statusLabel = isHard ? "Hard Breach" : isSoft ? "Soft Drift" : "Healthy"
        const statusCls = isHard
          ? "bg-red-500/10 text-red-500 ring-1 ring-red-500/20"
          : isSoft
          ? "bg-amber-500/10 text-amber-500 ring-1 ring-amber-500/20"
          : "bg-green-500/10 text-green-500 ring-1 ring-green-500/20"

        // Bar scale: 0–max, where max = hardHigh + a little padding
        const scale = (t.hardHigh + 5) || 20
        const pct = (v: number) => `${Math.min(100, (v / scale) * 100)}%`

        return (
          <div key={t.ticker} className="px-5 py-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                <div>
                  <span className="text-sm font-bold">{t.ticker}</span>
                  <span className="text-xs text-muted-foreground ml-2">{t.classification}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-black tabular-nums" style={{ color: barColor }}>{actual.toFixed(1)}%</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusCls}`}>{statusLabel}</span>
              </div>
            </div>

            {/* Threshold bar */}
            <div className="relative h-5 rounded-lg bg-muted overflow-hidden">
              {/* Hard zone overlay */}
              {t.hardLow > 0 && (
                <div
                  className="absolute inset-y-0 bg-red-500/10"
                  style={{ left: 0, width: pct(t.hardLow) }}
                />
              )}
              <div
                className="absolute inset-y-0 bg-red-500/10"
                style={{ left: pct(t.hardHigh), right: 0 }}
              />
              {/* Soft zone overlay */}
              {t.softLow > 0 && t.healthyLow > 0 && (
                <div
                  className="absolute inset-y-0 bg-amber-500/10"
                  style={{ left: pct(t.softLow), width: `calc(${pct(t.healthyLow)} - ${pct(t.softLow)})` }}
                />
              )}
              <div
                className="absolute inset-y-0 bg-amber-500/10"
                style={{ left: pct(t.healthyHigh), width: `calc(${pct(t.softHigh)} - ${pct(t.healthyHigh)})` }}
              />
              {/* Healthy zone overlay */}
              <div
                className="absolute inset-y-0 bg-green-500/[0.08] bar-fill"
                style={{ left: pct(t.healthyLow), width: `calc(${pct(t.healthyHigh)} - ${pct(t.healthyLow)})` }}
              />

              {/* Target marker */}
              <div
                className="absolute inset-y-0 w-0.5 bg-foreground/25"
                style={{ left: pct(t.target) }}
                title={`Target: ${t.target}%`}
              />

              {/* Actual position marker */}
              <div
                className="absolute top-1 bottom-1 w-1.5 rounded-sm transition-all marker-land"
                style={{ left: pct(actual), backgroundColor: barColor, transform: "translateX(-50%)" }}
              />
            </div>

            {/* Scale labels */}
            <div className="relative mt-1 h-3">
              {t.hardLow > 0 && (
                <span className="absolute text-[9px] text-red-500/70" style={{ left: pct(t.hardLow) }}>
                  {t.hardLow}%
                </span>
              )}
              <span className="absolute text-[9px] text-amber-500/70" style={{ left: pct(t.healthyLow) }}>
                {t.healthyLow}%
              </span>
              <span className="absolute text-[9px] text-foreground/40 -translate-x-1/2" style={{ left: pct(t.target) }}>
                {t.target}%
              </span>
              <span className="absolute text-[9px] text-amber-500/70 -translate-x-full" style={{ left: pct(t.healthyHigh) }}>
                {t.healthyHigh}%
              </span>
              <span className="absolute text-[9px] text-red-500/70 -translate-x-full" style={{ left: pct(t.hardHigh) }}>
                {t.hardHigh}%
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
