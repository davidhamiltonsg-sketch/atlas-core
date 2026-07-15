import {
  COMBINED_TECH_RULE,
  BITCOIN_TICKERS,
  BITCOIN_SLEEVE_TARGET_PCT,
  BITCOIN_RUNOFF_TICKER,
  BITCOIN_ACCUMULATION_TICKER,
  applyBitcoinSleeve,
  applyEconomicSleeves,
} from "@/lib/constants"
import { ATLAS_SPEC } from "@/lib/portfolio-spec"
import { economicSleeveTicker, GOVERNED_LINE_ALIASES } from "@/lib/instrument-identity"

export type Severity = "critical" | "high" | "medium" | "low" | "none"
export interface LiveMarketPos { price: number; lo52: number; hi52: number; histVolPct?: number }
export type EngineMarket = Record<string, LiveMarketPos>
export interface EngineOptions {
  market?: EngineMarket
  lookThroughBreach?: { label: string; pct: number; hard: number; trimTicker: string | null }
  portfolioDrawdownPct?: number
  drawdownDays?: number
}
export interface PositionInput {
  ticker: string; name: string; color: string; value: number; actualPct: number
  targetPct: number; hardCapPct: number | null; toleranceBand: number; latestPrice: number
}
export interface NextMove {
  severity: Severity; ticker: string | null; action: string; what: string; why: string; when: string; color: string
}
export interface DcaAllocation {
  ticker: string; name: string; color: string; amount: number; standardAmount: number
  tag: "standard" | "boosted" | "zeroed" | "skipped"; reason: string
}
export interface DcaPlan { allocations: DcaAllocation[]; headline: string; marketOverlayActive: boolean; overlayNote: string | null }

export { BITCOIN_TICKERS, BITCOIN_SLEEVE_TARGET_PCT, BITCOIN_RUNOFF_TICKER, BITCOIN_ACCUMULATION_TICKER, applyBitcoinSleeve, applyEconomicSleeves }

const governed = new Set(ATLAS_SPEC.funds.map((f) => f.ticker))
const core = "VWRA"
// Hard floors (constitution priority 3): a sleeve below its floor receives all new money
// until the floor is restored — EQAC and DBMFE both carry a 5% hard floor.
const floors = new Map(ATLAS_SPEC.funds.filter((f) => f.hardFloor != null).map((f) => [f.ticker, f.hardFloor as number]))
// A governed position's ECONOMIC exposure — its own weight plus every alternate line of
// the same instrument (EQAC + EQQQ, SMH + SEMI, BTC + IBIT + GBTC). Floors, caps and the
// combined ceiling judge this, not the single row, so a second exchange line of the same
// ISIN can never read as "underweight" or "over target" on its own.
function sleevePct(positions: PositionInput[], governedTicker: string) {
  return positions.filter((p) => economicSleeveTicker(p.ticker) === governedTicker).reduce((s, p) => s + p.actualPct, 0)
}
function exposurePct(positions: PositionInput[], p: PositionInput) {
  return governed.has(p.ticker) ? sleevePct(positions, p.ticker) : p.actualPct
}
function techPct(positions: PositionInput[]) {
  return positions
    .filter((p) => (COMBINED_TECH_RULE.tickers as readonly string[]).includes(economicSleeveTicker(p.ticker)))
    .reduce((s, p) => s + p.actualPct, 0)
}
function belowFloor(positions: PositionInput[]) {
  return positions
    .filter((p) => governed.has(p.ticker) && floors.has(p.ticker) && sleevePct(positions, p.ticker) < floors.get(p.ticker)!)
    .filter((p) => p.hardCapPct === null || sleevePct(positions, p.ticker) < p.hardCapPct)
    .sort((a, b) => (sleevePct(positions, a.ticker) - floors.get(a.ticker)!) - (sleevePct(positions, b.ticker) - floors.get(b.ticker)!))[0] ?? null
}
function selectedHolding(positions: PositionInput[]) {
  const combined = techPct(positions)
  const techPaused = combined >= COMBINED_TECH_RULE.softCeiling
  // Floor routing outranks the combined-ceiling pause in the constitution's priority order.
  const floorFund = belowFloor(positions)
  if (floorFund) return { selected: floorFund, techPaused, combined, floorRouted: true }
  const eligible = positions
    .filter((p) => governed.has(p.ticker) && p.targetPct > 0 && p.ticker !== BITCOIN_RUNOFF_TICKER)
    .filter((p) => !(techPaused && (COMBINED_TECH_RULE.tickers as readonly string[]).includes(p.ticker)))
    .filter((p) => p.hardCapPct === null || exposurePct(positions, p) < p.hardCapPct)
    .sort((a, b) => (a.actualPct - a.targetPct) - (b.actualPct - b.targetPct))
  return { selected: eligible[0] ?? positions.find((p) => p.ticker === core) ?? null, techPaused, combined, floorRouted: false }
}

export function computeMarketAwareDca(raw: PositionInput[], monthlyAmount: number, _opts: EngineOptions = {}): DcaPlan {
  const positions = applyEconomicSleeves(raw)
  const { selected, techPaused, floorRouted } = selectedHolding(positions)
  const allocations = positions.map<DcaAllocation>((p) => ({
    ticker: p.ticker, name: p.name, color: p.color,
    amount: selected?.ticker === p.ticker ? monthlyAmount : 0,
    standardAmount: Math.round(monthlyAmount * p.targetPct / 100),
    tag: selected?.ticker === p.ticker ? "boosted" : "zeroed",
    reason: selected?.ticker === p.ticker
      ? (floorRouted ? `${p.ticker} is below its ${floors.get(p.ticker)}% hard floor — all new money routes here until the floor is restored.` : `${p.ticker} is the furthest-underweight eligible constitutional holding.`)
      : "Not selected by the contribution-first rule.",
  }))
  return {
    allocations,
    headline: selected ? `Route this contribution to ${selected.ticker}` : "Hold contribution in the DCA cash bank",
    marketOverlayActive: techPaused,
    overlayNote: techPaused ? `EQAC and SMH additions are paused at the ${COMBINED_TECH_RULE.softCeiling}% combined watch level.` : "Contribution-first rebalancing; no price forecast used.",
  }
}

export function computeNextBestMove(raw: PositionInput[], _monthlyAmount: number, opts: EngineOptions = {}): NextMove {
  const positions = applyEconomicSleeves(raw)
  if (!positions.some((p) => p.value > 0)) return { severity:"none",ticker:core,action:"Start with VWRA",what:"Invest the first contribution in VWRA.",why:"VWRA is the broad global core.",when:"At the next permitted dealing window.",color:"#7c3aed" }
  // Constitution priority order: 1) sleeve hard caps, 2) look-through hard limits,
  // 3) hard-floor routing, 4) combined satellite ceiling, then standard routing.
  // Caps judge the economic sleeve (row + alternate lines of the same instrument).
  const hard = positions.filter((p) => p.hardCapPct !== null && exposurePct(positions, p) > p.hardCapPct).sort((a,b)=>(exposurePct(positions,b)-(b.hardCapPct??100))-(exposurePct(positions,a)-(a.hardCapPct??100)))[0]
  if (hard) return { severity:"critical",ticker:hard.ticker,action:`Pause ${hard.ticker}`,what:`${hard.ticker} is ${exposurePct(positions, hard).toFixed(1)}%, above its ${hard.hardCapPct}% hard cap.`,why:"Hard caps require a documented correction; no automatic market order is created.",when:"At the next permitted review.",color:hard.color }
  if (opts.lookThroughBreach) {
    const b=opts.lookThroughBreach, ticker=b.trimTicker ?? "SMH"
    return { severity:"critical",ticker,action:`Pause ${ticker}`,what:`Refresh sources and correct ${b.label}, now ${b.pct.toFixed(1)}% versus its ${b.hard}% hard review level.`,why:"Look-through concentration overrides ticker-level comfort.",when:"Document the correction before trading.",color:"#ef4444" }
  }
  const floorFund = belowFloor(positions)
  if (floorFund) return { severity:"high",ticker:floorFund.ticker,action:`Route all new money to ${floorFund.ticker}`,what:`${floorFund.ticker} is ${sleevePct(positions, floorFund.ticker).toFixed(1)}%, below its ${floors.get(floorFund.ticker)}% hard floor.`,why:"A sleeve below its hard floor takes priority for every new contribution until the floor is restored.",when:"At the next permitted dealing window.",color:floorFund.color }
  const combined=techPct(positions)
  if (combined >= COMBINED_TECH_RULE.hardCeiling) return { severity:"critical",ticker:"SMH",action:"Pause growth satellites",what:`EQAC plus SMH is ${combined.toFixed(1)}%, above the ${COMBINED_TECH_RULE.hardCeiling}% cap.`,why:"Overlapping technology exposure is governed as one risk.",when:"Route new cash to an eligible core holding.",color:"#ef4444" }
  // Genuinely-legacy = a DIFFERENT instrument outside the plan (VT, VWO, QQQM, GBTC, …).
  // An alternate exchange line of a governed instrument (EQQQ/SEMI — same ISIN) is
  // governed exposure inside its sleeve, never a migration item.
  const legacy=positions.filter((p)=>p.value>0 && !governed.has(p.ticker) && p.ticker!=="IBIT" && !GOVERNED_LINE_ALIASES[p.ticker])
  if (legacy.length) return { severity:"high",ticker:null,action:"Complete legacy migration",what:`Keep ${legacy.map(p=>p.ticker).join(", ")} visible until sale executions settle.`,why:"History and cost basis must remain attached to the original instruments.",when:"Replacement buys use settled proceeds only.",color:"#d6a74f" }
  const {selected,techPaused}=selectedHolding(positions)
  if (!selected) return { severity:"none",ticker:null,action:"Hold course",what:"No eligible contribution route is available.",why:"The DCA cash bank carries forward until a constitutional route opens.",when:"Review next month.",color:"#64748b" }
  const gap=selected.actualPct-selected.targetPct
  return { severity:gap < -selected.toleranceBand ? "medium" : "none",ticker:selected.ticker,action:`Route cash to ${selected.ticker}`,what:`Direct the next contribution to ${selected.ticker}.`,why:`${selected.ticker} is ${selected.actualPct.toFixed(1)}% versus its ${selected.targetPct.toFixed(1)}% target.${techPaused?" EQAC and SMH are paused by their combined watch level.":""}`,when:"At the next permitted dealing window.",color:selected.color }
}
