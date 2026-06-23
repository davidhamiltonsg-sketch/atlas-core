import { Shield, AlertTriangle } from "lucide-react"

// F2 — Buffer-status indicator. Turns "build the buffer" into a tracked metric:
// current SGOV % of NAV vs the 8–10% target band, months-to-band at the current
// contribution rate, and SGOV's live yield (so the buffer's role is shown honestly).
export function BufferStatus({
  currentPct, targetLow, targetHigh, monthsToBand, yieldPct, secYieldPct,
  monthlyContribution, stale,
}: {
  currentPct: number
  targetLow: number
  targetHigh: number
  monthsToBand: number
  yieldPct: number
  secYieldPct: number
  monthlyContribution: number
  stale: boolean
}) {
  const inBand = currentPct >= targetLow
  const pctOfBand = Math.min(100, (currentPct / targetHigh) * 100)
  const fmtYield = `${yieldPct.toFixed(2)}%`

  return (
    <div className="rounded-xl border border-border bg-card p-5 card-elevated">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Shield className={`h-4 w-4 ${inBand ? "text-green-500" : "text-amber-500"}`} />
          <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Shock Buffer (SGOV)</h2>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
          inBand ? "bg-green-500/10 text-green-600 dark:text-green-400" : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
        }`}>
          {inBand ? "In band" : "Below floor"}
        </span>
      </div>

      <div className="flex items-end justify-between mb-1">
        <p className="text-2xl font-black tabular-nums">{currentPct.toFixed(1)}%</p>
        <p className="text-[11px] text-muted-foreground">target {targetLow}–{targetHigh}% of NAV</p>
      </div>

      {/* Band bar: 0 → targetHigh, with the floor marked */}
      <div className="relative h-2 rounded-full bg-muted overflow-hidden mb-1">
        <div className="absolute inset-y-0 left-0 bg-green-500/15" style={{ left: `${(targetLow / targetHigh) * 100}%`, right: 0 }} />
        <div className={`absolute inset-y-0 left-0 rounded-full ${inBand ? "bg-green-500" : "bg-amber-500"}`} style={{ width: `${pctOfBand}%` }} />
        <div className="absolute inset-y-0 w-0.5 bg-foreground/40" style={{ left: `${(targetLow / targetHigh) * 100}%` }} />
      </div>

      <p className="text-[11px] text-muted-foreground leading-relaxed mt-2">
        {inBand ? (
          <>Buffer is within its target band. Maintain it from new contributions.</>
        ) : monthsToBand > 0 ? (
          <>At ${monthlyContribution.toLocaleString()}/mo routed to SGOV, about <span className="font-semibold text-foreground">{monthsToBand} month{monthsToBand !== 1 ? "s" : ""}</span> to reach the {targetLow}% floor. Built from new contributions only — never by selling.</>
        ) : (
          <>Start an SGOV position from new contributions toward the {targetLow}–{targetHigh}% band.</>
        )}
      </p>

      <div className="mt-3 pt-3 border-t border-border flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">SGOV yield</span>
        <span className="text-[11px] font-semibold tabular-nums flex items-center gap-1.5">
          {fmtYield} <span className="text-muted-foreground font-normal">div · {secYieldPct.toFixed(2)}% SEC</span>
          {stale && (
            <span className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[9px] font-bold">
              <AlertTriangle className="h-2.5 w-2.5" /> STALE
            </span>
          )}
        </span>
      </div>
    </div>
  )
}
