"use client"

interface PhaseGate {
  key: string
  threshold: number
  label: string
}

interface BrickRoadProps {
  totalValue: number
  targetValue: number
  currentPhase: string
  phases: PhaseGate[]
  monthsToGoal: number | null
}

const BRICKS_PER_PHASE = 6
const TOTAL_BRICKS = 24

function bricksLaid(totalValue: number, targetValue: number, phases: PhaseGate[]): number {
  if (totalValue <= 0) return 0
  if (totalValue >= targetValue) return TOTAL_BRICKS

  for (let i = 0; i < phases.length; i++) {
    const lo = i === 0 ? 0 : phases[i - 1].threshold
    const hi = phases[i].threshold
    if (totalValue < hi) {
      const within = (totalValue - lo) / (hi - lo)
      return Math.floor(i * BRICKS_PER_PHASE + within * BRICKS_PER_PHASE)
    }
  }
  return TOTAL_BRICKS
}

export function BrickRoad({ totalValue, targetValue, currentPhase, phases, monthsToGoal }: BrickRoadProps) {
  const laid = bricksLaid(totalValue, targetValue, phases)
  const pct = targetValue > 0 ? Math.min(100, Math.round((totalValue / targetValue) * 100)) : 0

  return (
    <div className="rounded-2xl border border-sky-500/20 bg-gradient-to-b from-sky-500/[0.03] to-transparent p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-sky-400">The Road</p>
          <p className="text-xs text-muted-foreground mt-0.5">Each brick is a step closer to your home deposit</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-bold tabular-nums">{laid} / {TOTAL_BRICKS}</p>
          <p className="text-[10px] text-muted-foreground">bricks laid</p>
        </div>
      </div>

      {/* Brick grid */}
      <div className="grid grid-cols-6 gap-1.5 mb-3">
        {Array.from({ length: TOTAL_BRICKS }, (_, i) => {
          const isLaid = i < laid
          const isNext = i === laid
          const phaseIdx = Math.floor(i / BRICKS_PER_PHASE)
          const isGateBrick = (i + 1) % BRICKS_PER_PHASE === 0 && i < TOTAL_BRICKS - 1

          return (
            <div
              key={i}
              className={`
                relative h-5 rounded-sm transition-all duration-500
                ${isLaid
                  ? phaseIdx === 0 ? "bg-sky-500/80"
                  : phaseIdx === 1 ? "bg-blue-500/80"
                  : phaseIdx === 2 ? "bg-indigo-500/80"
                  : "bg-violet-500/80"
                  : isNext
                  ? "bg-sky-500/20 ring-1 ring-sky-500/40"
                  : "bg-muted/40"
                }
                ${isGateBrick && isLaid ? "ring-1 ring-white/20" : ""}
              `}
            >
              {isNext && (
                <span className="absolute inset-0 flex items-center justify-center text-[8px] font-bold text-sky-400">
                  next
                </span>
              )}
            </div>
          )
        })}
      </div>

      {/* Phase gates legend */}
      <div className="flex justify-between text-[10px] text-muted-foreground/60 mb-4">
        {phases.map((p, i) => (
          <div key={p.key} className={`text-center flex-1 ${currentPhase === p.key ? "text-sky-400 font-bold" : ""}`}>
            <span>{p.label}</span>
          </div>
        ))}
      </div>

      {/* Progress summary */}
      <div className="flex items-center justify-between pt-3 border-t border-border/50">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/10">
            <span className="text-sm font-black text-sky-400">{pct}%</span>
          </div>
          <div>
            <p className="text-xs font-semibold">Phase {currentPhase}</p>
            <p className="text-[10px] text-muted-foreground">
              {phases.find(p => p.key === currentPhase)?.label ?? ""}
            </p>
          </div>
        </div>
        {monthsToGoal !== null && monthsToGoal > 0 && (
          <p className="text-[11px] text-muted-foreground">
            ~{monthsToGoal} month{monthsToGoal === 1 ? "" : "s"} to go
          </p>
        )}
      </div>
    </div>
  )
}
