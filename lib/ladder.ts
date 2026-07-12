import { computeNextBestMove, type EngineMarket, type PositionInput, type Severity } from "@/lib/next-best-move"

export type { PositionInput }
export interface LiveMarketPos { price: number; lo52: number; hi52: number; histVolPct?: number }
export type StepStatus = "fired" | "passed" | "warning" | "not_reached"
export interface LadderStep { step: number; label: string; status: StepStatus; reason?: string }
export interface LadderOptions {
  market?: EngineMarket
  lookThroughHardBreach?: { label: string; pct: number; hard: number; trimTicker: string | null }
  lookThroughSoftWarning?: { label: string; pct: number; soft: number }
  portfolioDrawdownPct?: number
  drawdownDays?: number
}
export interface LadderInstruction {
  firedStep: number
  severity: Severity
  ticker: string | null
  headline: string
  instruction: string
  rationale: string
  when: string
  citation: string
  steps: LadderStep[]
  exceptions: string[]
  isTerminal: boolean
}

const labels = [
  "Hard limits and look-through",
  "Legacy-position migration",
  "Contribution-first rebalancing",
  "Hold the constitutional course",
]

export function computeLadder(positions: PositionInput[], _totalValue: number, opts: LadderOptions = {}): LadderInstruction {
  const move = computeNextBestMove(positions, 0, {
    market: opts.market,
    lookThroughBreach: opts.lookThroughHardBreach,
    portfolioDrawdownPct: opts.portfolioDrawdownPct,
    drawdownDays: opts.drawdownDays,
  })
  const legacy = positions.some((p) => p.value > 0 && !["IMID", "IWQU", "EQAC", "SMH", "BTC", "IBIT"].includes(p.ticker))
  const firedStep = move.severity === "critical" ? 1 : legacy ? 2 : move.ticker ? 3 : 4
  const steps = labels.map<LadderStep>((label, index) => {
    const step = index + 1
    if (step < firedStep) return { step, label, status: "passed", reason: "No trigger." }
    if (step === firedStep) return { step, label, status: "fired", reason: move.why }
    return { step, label, status: "not_reached" }
  })
  const exceptions: string[] = []
  if (opts.lookThroughSoftWarning) exceptions.push(`${opts.lookThroughSoftWarning.label} is ${opts.lookThroughSoftWarning.pct.toFixed(1)}%, above its ${opts.lookThroughSoftWarning.soft}% watch level; refresh sources and route cash away from its largest contributor.`)
  if ((opts.portfolioDrawdownPct ?? 0) <= -20) exceptions.push(`Portfolio drawdown is ${opts.portfolioDrawdownPct?.toFixed(1)}%; the constitution does not permit panic selling.`)
  return {
    firedStep, severity: move.severity, ticker: move.ticker, headline: move.action,
    instruction: move.what, rationale: move.why, when: move.when,
    citation: "Atlas Core Constitution v3.1 · contribution-first decision ladder",
    steps, exceptions, isTerminal: move.severity === "none",
  }
}
