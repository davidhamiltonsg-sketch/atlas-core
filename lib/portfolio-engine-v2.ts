import type { Constitution, ConstitutionFund } from "@/lib/constitutions"
import type { DcaPlan, NextMove } from "@/lib/next-best-move"
import { economicSleeveTicker } from "@/lib/instrument-identity"

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

const LEGACY_ATLAS = new Set(["VT", "QQQM", "VWO", "SMH.US", "SMH_US", "SMH-US", "GBTC", "IB01", "IMID", "IWQU"])

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
  const legacyTickers = positions.filter((p) => p.value > 0 && LEGACY_ATLAS.has(p.ticker.toUpperCase())).map((p) => p.ticker)

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
      contribution: allocationPlan(c, monthly, c.funds
        .slice().sort((a,b) => ((positions.filter(p => economicSleeveTicker(p.ticker) === a.ticker).reduce((s,p)=>s+p.actualPct,0))-a.target)-((positions.filter(p => economicSleeveTicker(p.ticker) === b.ticker).reduce((s,p)=>s+p.actualPct,0))-b.target))[0], "Migration cash remains unavailable until settlement; ordinary contributions still go to the furthest-underweight approved sleeve."),
    }
  }

  const actual = new Map<string, number>()
  for (const p of positions) {
    const sleeve = economicSleeveTicker(p.ticker)
    if (approved.has(sleeve)) actual.set(sleeve, (actual.get(sleeve) ?? 0) + p.actualPct)
  }
  const hardBreach = c.funds
    .filter((f) => f.hardCap !== null && (actual.get(f.ticker) ?? 0) > f.hardCap)
    .sort((a, b) => ((actual.get(b.ticker) ?? 0) - (b.hardCap ?? 100)) - ((actual.get(a.ticker) ?? 0) - (a.hardCap ?? 100)))[0]
  if (hardBreach) {
    const pct = actual.get(hardBreach.ticker) ?? 0
    const breached = new Set(c.funds.filter(f => f.hardCap !== null && (actual.get(f.ticker) ?? 0) > f.hardCap).map(f => f.ticker))
    const candidates = c.funds.filter(f => !breached.has(f.ticker) && (f.hardCap === null || (actual.get(f.ticker) ?? 0) < f.hardCap))
    const core = c.funds[0]
    const destination = candidates.find(f => f.ticker === core.ticker) ??
      candidates.sort((a,b) => ((actual.get(a.ticker) ?? 0)-a.target)-((actual.get(b.ticker) ?? 0)-b.target))[0] ?? null
    return {
      state: "invested",
      legacyTickers: [],
      move: move("critical", hardBreach.ticker, `Pause ${hardBreach.ticker} purchases`, `${hardBreach.ticker} is ${pct.toFixed(1)}%, above its ${hardBreach.hardCap}% hard cap. Document a correction; do not make an automatic market order.`, "Hard limits require review, while new cash is routed away from the breached holding.", hardBreach.color),
      contribution: allocationPlan(c, monthly, destination, destination ? `A hard cap is breached; route new money to ${destination.ticker}.` : "All governed funds are ineligible; bank the contribution pending review."),
    }
  }

  const hardFloor = c.funds
    .filter((f) => f.floor !== undefined && (actual.get(f.ticker) ?? 0) < f.floor)
    .sort((a, b) => ((actual.get(a.ticker) ?? 0) - (a.floor ?? 0)) - ((actual.get(b.ticker) ?? 0) - (b.floor ?? 0)))[0]
  if (hardFloor) {
    const pct = actual.get(hardFloor.ticker) ?? 0
    return {
      state: "invested", legacyTickers: [],
      move: move("high", hardFloor.ticker, `Restore ${hardFloor.ticker}`, `${hardFloor.ticker} is ${pct.toFixed(1)}%, below its ${hardFloor.floor}% hard floor.`, "The governed multi-factor floor takes priority for new cash.", hardFloor.color),
      contribution: allocationPlan(c, monthly, hardFloor, `Restore the ${hardFloor.floor}% hard floor.`),
    }
  }

  const combinedPct = c.combined?.tickers.reduce((sum, ticker) => sum + (actual.get(ticker) ?? 0), 0) ?? 0
  if (c.combined && combinedPct >= c.combined.warning) {
    const excluded = new Set(c.combined.tickers)
    const destination = c.funds
      .filter(f => !excluded.has(f.ticker) && (f.hardCap === null || (actual.get(f.ticker) ?? 0) < f.hardCap))
      .sort((a,b) => ((actual.get(a.ticker) ?? 0)-a.target)-((actual.get(b.ticker) ?? 0)-b.target))[0] ?? null
    const severity = combinedPct > c.combined.hard ? "critical" : "medium"
    return {
      state: "invested", legacyTickers: [],
      move: move(severity, destination?.ticker ?? null, "Pause EQAC and SMH purchases", `EQAC plus SMH is ${combinedPct.toFixed(1)}%.`, `The combined watch/hard levels are ${c.combined.warning}%/${c.combined.hard}%; route new cash away from both sleeves.`, destination?.color),
      contribution: allocationPlan(c, monthly, destination, destination ? `Combined concentration routes cash to ${destination.ticker}.` : "Bank the contribution pending review."),
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
