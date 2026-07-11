import type { Constitution, ConstitutionFund } from "@/lib/constitutions"
import type { DcaPlan, NextMove } from "@/lib/next-best-move"

export interface GovernedPosition {
  ticker: string
  name: string
  color: string
  value: number
  actualPct: number
}

export interface PortfolioDecision {
  move: NextMove
  contribution: DcaPlan
  state: "unfunded" | "transition" | "invested"
  legacyTickers: string[]
}

const LEGACY_ATLAS = new Set(["VT", "QQQM", "VWO", "SMH_US", "SMH-US", "GBTC", "BTC", "IBIT"])

function move(severity: NextMove["severity"], ticker: string | null, action: string, what: string, why: string, color = "#38bdf8"): NextMove {
  return { severity, ticker, action, what, why, when: "At the next permitted dealing window.", color }
}

function allocationPlan(c: Constitution, monthly: number, selected: ConstitutionFund | null, note: string): DcaPlan {
  return {
    allocations: c.funds.map((f) => ({
      ticker: f.ticker,
      name: f.name,
      color: f.color,
      amount: selected?.ticker === f.ticker ? monthly : 0,
      standardAmount: Math.round(monthly * f.target / 100),
      tag: selected?.ticker === f.ticker ? "boosted" : "zeroed",
      reason: selected?.ticker === f.ticker ? note : "Not selected by this contribution route.",
    })),
    headline: selected ? `Route this contribution to ${selected.ticker}` : "No contribution instruction",
    marketOverlayActive: false,
    overlayNote: note,
  }
}

export function decidePortfolio(c: Constitution, positions: GovernedPosition[], monthly = c.monthlyContribution): PortfolioDecision {
  const total = positions.reduce((sum, p) => sum + Math.max(0, p.value), 0)
  const approved = new Map(c.funds.map((f) => [f.ticker, f]))
  const legacyTickers = positions.filter((p) => p.value > 0 && !approved.has(p.ticker) && LEGACY_ATLAS.has(p.ticker)).map((p) => p.ticker)

  if (total <= 0) {
    const core = c.funds[0]
    return {
      state: "unfunded",
      legacyTickers: [],
      move: move("none", core.ticker, `Start with ${core.ticker}`, `Invest the first contribution in ${core.ticker}; do not pretend the target portfolio is already owned.`, `${core.ticker} is the broad core and the account currently holds no securities.`, core.color),
      contribution: allocationPlan(c, monthly, core, "First purchase goes to the broad core."),
    }
  }

  if (legacyTickers.length) {
    return {
      state: "transition",
      legacyTickers,
      move: move("high", null, "Review the migration trades", `Keep ${legacyTickers.join(", ")} visible as legacy positions until their sale executions settle. Replacement purchases begin only from settled proceeds.`, "Historical cost basis and realised gains must remain attached to the original instruments; ticker renaming is prohibited.", "#d6a74f"),
      contribution: allocationPlan(c, monthly, c.funds[0], "While migration is pending, new contributions strengthen the approved global core."),
    }
  }

  const actual = new Map(positions.map((p) => [p.ticker, p.actualPct]))
  const hardBreach = c.funds
    .filter((f) => f.hardCap !== null && (actual.get(f.ticker) ?? 0) > f.hardCap)
    .sort((a, b) => ((actual.get(b.ticker) ?? 0) - (b.hardCap ?? 100)) - ((actual.get(a.ticker) ?? 0) - (a.hardCap ?? 100)))[0]
  if (hardBreach) {
    const pct = actual.get(hardBreach.ticker) ?? 0
    const core = c.funds[0]
    return {
      state: "invested",
      legacyTickers: [],
      move: move("critical", hardBreach.ticker, `Pause ${hardBreach.ticker} purchases`, `${hardBreach.ticker} is ${pct.toFixed(1)}%, above its ${hardBreach.hardCap}% hard cap. Document a correction; do not make an automatic market order.`, "Hard limits require review, while new cash is routed away from the breached holding.", hardBreach.color),
      contribution: allocationPlan(c, monthly, core, `A hard cap is breached; route new money to ${core.ticker}.`),
    }
  }

  const eligible = c.funds.filter((f) => (actual.get(f.ticker) ?? 0) < f.rangeHigh)
  const underweight = (eligible.length ? eligible : c.funds).sort((a, b) => ((actual.get(a.ticker) ?? 0) - a.target) - ((actual.get(b.ticker) ?? 0) - b.target))[0]
  const pct = actual.get(underweight.ticker) ?? 0
  return {
    state: "invested",
    legacyTickers: [],
    move: move(pct < underweight.rangeLow ? "medium" : "none", underweight.ticker, `Route cash to ${underweight.ticker}`, `Direct the next contribution to ${underweight.ticker}.`, `${underweight.ticker} is ${pct.toFixed(1)}% versus its ${underweight.target}% target and is the furthest underweight eligible holding.`, underweight.color),
    contribution: allocationPlan(c, monthly, underweight, "Furthest-underweight eligible holding."),
  }
}
