interface Props {
  data: number[]
  /** Explicit line colour (any CSS colour). Omit for gain/loss semantics
   *  from the theme tokens: green when the series ends >= where it started,
   *  red otherwise. */
  color?: string
  width?: number
  height?: number
}

// Hand-rolled sparkline — a single <path> in a fixed-size <svg>. No Recharts:
// at 80×28 a chart library buys nothing, and this renders on the server too.
export function Sparkline({ data, color, width = 80, height = 28 }: Props) {
  if (data.length < 2) return null

  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min
  // End-dot radius + half the stroke width must stay inside the viewBox.
  const padX = 3
  const padY = 3
  const innerW = width - padX * 2
  const innerH = height - padY * 2

  const points = data.map((v, i) => {
    const x = padX + (i / (data.length - 1)) * innerW
    // Flat series (range 0) draws a midline rather than dividing by zero.
    const t = range === 0 ? 0.5 : (v - min) / range
    const y = padY + (1 - t) * innerH
    return [x, y] as const
  })
  const d = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(" ")
  const [endX, endY] = points[points.length - 1]

  const first = data[0]
  const last = data[data.length - 1]
  const isGain = last >= first
  const stroke = color ?? (isGain ? "hsl(var(--success))" : "hsl(var(--danger))")
  const changePct = first !== 0 ? ((last - first) / Math.abs(first)) * 100 : 0

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Trend: ${isGain ? "up" : "down"} ${Math.abs(changePct).toFixed(1)}% over ${data.length} points`}
      className="shrink-0"
    >
      <title>{`${isGain ? "+" : "−"}${Math.abs(changePct).toFixed(1)}% across ${data.length} points`}</title>
      <path
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={endX} cy={endY} r={2} fill={stroke} />
    </svg>
  )
}
