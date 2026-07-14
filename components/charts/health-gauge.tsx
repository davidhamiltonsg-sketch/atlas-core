interface Props {
  score: number
  label: string
}

// Semicircle geometry — mirrors the old Recharts pie (innerRadius 52 /
// outerRadius 74) as a single stroked arc: mid radius 63, stroke width 22.
// Fill level uses the stroke-dashoffset technique proven in
// components/cockpit/governance-seal.tsx; .gauge-arc-fill in globals.css
// animates the sweep-in (and hardcodes this same π·63 arc length).
const R = 63
const STROKE = 22
const W = 190
const H = 105
const CX = W / 2
const CY = 103
const ARC = Math.PI * R
const ARC_PATH = `M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`

export function HealthGauge({ score, label }: Props) {
  const clamped = Math.max(0, Math.min(100, score))

  const isGood    = clamped >= 80
  const isWarning = clamped >= 60 && clamped < 80

  const toneText   = isGood ? "text-success" : isWarning ? "text-warning" : "text-danger"
  const chipTone   = isGood
    ? "bg-success/10 border-success/25 text-success"
    : isWarning
    ? "bg-warning/10 border-warning/25 text-warning"
    : "bg-danger/10 border-danger/25 text-danger"
  const animClass  = isGood ? "gauge-healthy" : isWarning ? "gauge-warning" : "gauge-critical"
  const statusText = isGood ? "All good" : isWarning ? "Needs attention" : "Action required"
  const statusEmoji = isGood ? "✓" : isWarning ? "!" : "!!"

  return (
    <div className={`flex flex-col items-center ${animClass}`}>
      {/* Arc — hand-rolled semicircle, arc endpoints flush with the SVG bottom */}
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${label}: ${clamped} out of 100 — ${statusText}`}
      >
        {/* Background track */}
        <path d={ARC_PATH} fill="none" stroke="hsl(var(--muted))" strokeOpacity={0.6} strokeWidth={STROKE} />
        {/* Filled arc — dashoffset trims the sweep to the score */}
        <path
          d={ARC_PATH}
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE}
          strokeDasharray={ARC}
          strokeDashoffset={ARC * (1 - clamped / 100)}
          className={`${toneText} gauge-arc-fill`}
        />
      </svg>

      {/* Score display — sits below the arc in normal flow */}
      <div className="flex flex-col items-center -mt-1 mb-1">
        <div className="flex items-baseline gap-1">
          <span className={`text-4xl font-black tabular-nums leading-none ${toneText}`}>
            {clamped}
          </span>
          <span className="text-base font-bold text-muted-foreground">/100</span>
        </div>
        <span className={`mt-1 text-xs font-bold tracking-wide uppercase px-2.5 py-0.5 rounded-full border ${chipTone}`}>
          {statusEmoji} {statusText}
        </span>
        <span className="text-xs text-muted-foreground mt-1">{label}</span>
      </div>

      {/* Scale markers */}
      <div className="flex justify-between w-[160px] mt-1 text-[10px] text-muted-foreground">
        <span>0</span>
        <span className="text-warning font-semibold">60</span>
        <span className="text-success font-semibold">80</span>
        <span>100</span>
      </div>
    </div>
  )
}
