import { formatCurrency } from "@/lib/utils"

export interface ComplianceBandPosition {
  ticker: string
  name: string
  color: string
  value: number
  actualPct: number
  targetPct: number
  softLow: number    // target - toleranceBand (soft underweight threshold)
  softHigh: number   // target + toleranceBand (soft overweight threshold)
  hardLow?: number   // hard underweight floor (from HARD_THRESHOLDS)
  hardHigh: number   // hard cap (from hardCapPct or HARD_THRESHOLDS)
  status: "healthy" | "soft" | "hard"
}

interface Props {
  positions: ComplianceBandPosition[]
  totalValue: number
}

function BandRow({ p }: { p: ComplianceBandPosition }) {
  // Build a scale: 0 → max(hardHigh + buffer, actualPct + buffer)
  const scaleMax = Math.max(p.hardHigh * 1.1, p.actualPct + 3, p.softHigh + 4)
  const toX = (pct: number) => Math.min(100, (pct / scaleMax) * 100)

  const hardLowX   = p.hardLow !== undefined ? toX(p.hardLow) : null
  const softLowX   = toX(p.softLow)
  const targetX    = toX(p.targetPct)
  const softHighX  = toX(p.softHigh)
  const hardHighX  = toX(p.hardHigh)
  const actualX    = toX(p.actualPct)

  // Zone color for the soft band
  const softBandColor =
    p.status === "hard"    ? "bg-red-500/20" :
    p.status === "soft"    ? "bg-amber-400/20" :
    "bg-green-500/15"

  const markerColor =
    p.status === "hard"    ? "bg-red-500" :
    p.status === "soft" && p.actualPct < p.targetPct ? "bg-amber-400" :
    p.status === "soft"    ? "bg-orange-400" :
    "bg-green-500"

  const statusLabel =
    p.status === "hard"    ? (p.actualPct < (p.hardLow ?? 0) ? "HARD ↓" : "HARD ↑") :
    p.status === "soft" && p.actualPct < p.targetPct ? "SOFT ↓" :
    p.status === "soft"    ? "SOFT ↑" :
    "OK"

  const statusStyle =
    p.status === "hard"    ? "text-red-500" :
    p.status === "soft"    ? "text-amber-500" :
    "text-green-500"

  return (
    <div className="flex items-center gap-4 py-3">
      {/* Ticker + status */}
      <div className="w-28 shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: p.color }} />
          <span className="text-xs font-bold">{p.ticker}</span>
          <span className={`font-data text-[9px] font-bold ml-auto ${statusStyle}`}>{statusLabel}</span>
        </div>
        <div className="font-data text-[10px] text-muted-foreground mt-0.5 pl-4">
          {p.actualPct.toFixed(1)}% · <span className="text-muted-foreground/60">{p.targetPct}% tgt</span>
        </div>
      </div>

      {/* Band track */}
      <div className="flex-1 relative h-5 bg-muted rounded-full overflow-hidden">
        {/* Hard low zone (red, left of hard floor) */}
        {hardLowX !== null && hardLowX > 0 && (
          <div className="absolute top-0 left-0 h-full bg-red-500/20 rounded-l-full bar-fill" style={{ width: `${hardLowX}%` }} />
        )}
        {/* Soft band (green/amber zone between soft low and soft high) */}
        <div
          className={`absolute top-0 h-full bar-fill ${softBandColor}`}
          style={{ left: `${softLowX}%`, width: `${softHighX - softLowX}%` }}
        />
        {/* Hard high line */}
        <div
          className="absolute top-0 h-full w-0.5 bg-red-500/60"
          style={{ left: `${hardHighX}%` }}
        />
        {/* Target tick */}
        <div
          className="absolute top-0 h-full w-0.5 bg-foreground/30"
          style={{ left: `${targetX}%` }}
        />
        {/* Current position marker */}
        <div
          className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-card ${markerColor} shadow-sm transition-all marker-land`}
          style={{ left: `calc(${actualX}% - 6px)` }}
        />
      </div>

      {/* Value */}
      <div className="w-16 text-right shrink-0">
        <p className="text-[11px] font-semibold tabular-nums">{formatCurrency(p.value, "SGD")}</p>
      </div>
    </div>
  )
}

/** Visual compliance bands — shows every position's current vs. target vs. limits. */
export function ComplianceBoard({ positions, totalValue }: Props) {
  if (positions.length === 0) return null
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Compliance Board</p>
          <p className="text-xs text-muted-foreground mt-0.5">Soft band · Target tick | Hard cap</p>
        </div>
        <p className="text-[10px] text-muted-foreground">{formatCurrency(totalValue, "SGD")}</p>
      </div>
      <div className="divide-y divide-border/60">
        {positions.map(p => <BandRow key={p.ticker} p={p} />)}
      </div>
    </div>
  )
}
