import type { DcaPlan, DcaAllocation, NextMove } from "@/lib/next-best-move"
import { SILICON_BRICK_ROAD, type Constitution } from "@/lib/constitutions"

export interface SbrPosition {
  ticker: string; name: string; color: string; value: number; actualPct: number
  targetPct: number; rangeLow: number; rangeHigh: number; hardCap: number | null
  floor?: number; latestPrice: number; hi52: number
}
export interface SbrEngineOpts { drawdownPct?: number }
export type SbrBranch =
  | { tag: "empty" }
  | { tag: "hard_cap"; fund: SbrPosition; cap: number }
  | { tag: "floor"; fund: SbrPosition; floor: number }
  | { tag: "combined_hard"; combined: number }
  | { tag: "combined_watch"; combined: number }
  | { tag: "underweight"; fund: SbrPosition }
  | { tag: "standard"; fund: SbrPosition }

export function getPhaseCaps(_phaseKey: string) {
  return { smhHard: 15, combinedHard: 43, combinedWarning: 37.5, combinedResume: 35 }
}

function route(positions: SbrPosition[], totalValue: number, c: Constitution): SbrBranch {
  if (totalValue <= 0) return { tag: "empty" }
  const byGap = [...positions].sort((a,b) => (a.actualPct-a.targetPct)-(b.actualPct-b.targetPct))
  const cap = positions.filter(p => p.hardCap !== null && p.actualPct > p.hardCap).sort((a,b) => (b.actualPct-(b.hardCap??100))-(a.actualPct-(a.hardCap??100)))[0]
  if (cap) return { tag: "hard_cap", fund: cap, cap: cap.hardCap! }
  const floor = positions.filter(p => p.floor !== undefined && p.actualPct < p.floor).sort((a,b) => (a.actualPct-(a.floor??0))-(b.actualPct-(b.floor??0)))[0]
  if (floor) return { tag: "floor", fund: floor, floor: floor.floor! }
  const combined = positions.filter(p => c.combined?.tickers.includes(p.ticker)).reduce((s,p)=>s+p.actualPct,0)
  if (combined > (c.combined?.hard ?? 20)) return { tag: "combined_hard", combined }
  if (combined >= (c.combined?.warning ?? 18)) return { tag: "combined_watch", combined }
  const under = byGap.find(p => p.actualPct < p.rangeLow && p.actualPct < p.rangeHigh)
  return under ? { tag: "underweight", fund: under } : { tag: "standard", fund: byGap.find(p=>p.actualPct<p.rangeHigh) ?? byGap[0] }
}

export function sbrRoute(positions: SbrPosition[], totalValue: number, _opts: SbrEngineOpts = {}, c: Constitution = SILICON_BRICK_ROAD): SbrBranch {
  return route(positions,totalValue,c)
}

function eligibleDestination(positions: SbrPosition[], excluded: Set<string>): SbrPosition | null {
  return [...positions]
    .filter(p => !excluded.has(p.ticker) && (p.hardCap === null || p.actualPct < p.hardCap))
    .sort((a,b) => (a.actualPct-a.targetPct)-(b.actualPct-b.targetPct))[0] ?? null
}

function result(branch: SbrBranch, c: Constitution, positions: SbrPosition[]): { move: NextMove; selected: string | null } {
  const core=c.funds[0], combined=c.combined
  if(branch.tag==="empty") return { selected:core.ticker, move:{severity:"none",ticker:core.ticker,action:`Start with ${core.ticker}`,what:`Invest the first contribution in ${core.ticker}.`,why:"SBR currently holds no securities; the global core is the first building block.",when:"At the next permitted dealing window.",color:core.color} }
  if(branch.tag==="hard_cap") { const destination=eligibleDestination(positions,new Set([branch.fund.ticker])); return { selected:destination?.ticker??null, move:{severity:"critical",ticker:branch.fund.ticker,action:`Pause ${branch.fund.ticker}`,what:`${branch.fund.ticker} is ${branch.fund.actualPct.toFixed(1)}%, above its ${branch.cap}% hard cap.`,why:destination?`Document the correction and route new cash to ${destination.ticker}; no automatic sale is created.`:"No governed fund is currently eligible for new cash; bank the contribution pending review.",when:"Before the next contribution.",color:branch.fund.color} } }
  if(branch.tag==="floor") return { selected:branch.fund.ticker, move:{severity:"high",ticker:branch.fund.ticker,action:`Restore ${branch.fund.ticker}`,what:`${branch.fund.ticker} is ${branch.fund.actualPct.toFixed(1)}%, below its ${branch.floor}% hard floor.`,why:"The documented reserve floor takes priority for new cash.",when:"At the next permitted dealing window.",color:branch.fund.color} }
  if(branch.tag==="combined_hard" || branch.tag==="combined_watch") { const destination=eligibleDestination(positions,new Set(combined?.tickers??[])); return { selected:destination?.ticker??null, move:{severity:branch.tag==="combined_hard"?"critical":"medium",ticker:destination?.ticker??core.ticker,action:"Pause growth satellites",what:`EQAC plus SMH is ${branch.combined.toFixed(1)}%. ${destination?`Route new cash to ${destination.ticker}.`:"Bank new cash pending review."}`,why:`The combined ${combined?.warning}% watch and ${combined?.hard}% hard limits govern overlapping growth exposure.`,when:"Until the combined allocation is below the resume level.",color:destination?.color??core.color} } }
  return { selected:branch.fund.ticker, move:{severity:branch.tag==="underweight"?"medium":"none",ticker:branch.fund.ticker,action:`Route cash to ${branch.fund.ticker}`,what:`Direct the next contribution to ${branch.fund.ticker}.`,why:`It is ${branch.fund.actualPct.toFixed(1)}% versus its ${branch.fund.targetPct}% target and is the furthest-underweight eligible holding.`,when:"At the next permitted dealing window.",color:branch.fund.color} }
}

export function computeSbrNextMove(positions:SbrPosition[],totalValue:number,_opts:SbrEngineOpts={},c:Constitution=SILICON_BRICK_ROAD):NextMove { return result(route(positions,totalValue,c),c,positions).move }

export function computeSbrDca(positions:SbrPosition[],monthly:number,_opts:SbrEngineOpts={},c:Constitution=SILICON_BRICK_ROAD):DcaPlan {
  const {selected,move}=result(route(positions,positions.reduce((s,p)=>s+p.value,0),c),c,positions)
  const allocations=c.funds.map<DcaAllocation>(f=>({ticker:f.ticker,name:f.name,color:f.color,amount:f.ticker===selected?monthly:0,standardAmount:Math.round(monthly*f.target/100),tag:f.ticker===selected?"boosted":"zeroed",reason:f.ticker===selected?move.why:"Not selected by the contribution-first rule."}))
  return {allocations,headline:selected?`Route this contribution to ${selected}`:"Bank this contribution pending review",marketOverlayActive:move.severity==="critical",overlayNote:move.why}
}

export interface SbrHealth { overall:number; overallLabel:"Good standing"|"Review recommended"|"Action required"; governance:number; risk:number; allocation:number; contribution:number; behavioural:number; liquidity:number; documentation:number }
export function computeSbrHealth(positions:SbrPosition[],totalValue:number,snapshotAgeDays:number,c:Constitution=SILICON_BRICK_ROAD):SbrHealth {
  if(totalValue<=0) return {overall:0,overallLabel:"Action required",governance:0,risk:0,allocation:0,contribution:0,behavioural:0,liquidity:0,documentation:0}
  const b=route(positions,totalValue,c), breach=b.tag==="hard_cap"||b.tag==="floor"||b.tag==="combined_hard", watch=b.tag==="combined_watch"||b.tag==="underweight"
  const governance=breach?35:watch?75:100, risk=breach?25:watch?70:100
  const allocation=Math.max(0,100-positions.reduce((s,p)=>s+Math.min(20,Math.abs(p.actualPct-p.targetPct)*4),0))
  const freshness=snapshotAgeDays<=7?100:snapshotAgeDays<=35?75:snapshotAgeDays<=95?45:10
  const liquidity=(positions.find(p=>p.ticker==="DBMFE")?.actualPct ?? 0) >= 5 ? 100 : 50
  const overall=Math.round(governance*.25+risk*.20+allocation*.15+freshness*.20+100*.10+liquidity*.10)
  return {overall,overallLabel:overall>=80?"Good standing":overall>=60?"Review recommended":"Action required",governance,risk,allocation,contribution:freshness,behavioural:100,liquidity,documentation:freshness}
}

export interface AccrualBalance { [ticker:string]:number }
export interface ShareBuyInstruction { ticker:string; sharesToBuy:number; lotSize:number; costSgd:number; carryForward:number; priceSgd:number }
export interface WholeSharBuyResult { instructions:ShareBuyInstruction[]; totalDeployed:number; totalCarried:number; note:string|null }
export function computeWholeShareBuy(plan:DcaPlan,prices:Record<string,number>,accrual:AccrualBalance={},commissionSgd=0):WholeSharBuyResult {
  const instructions:ShareBuyInstruction[]=[]; let totalDeployed=0,totalCarried=0; let commissionRemaining=Math.max(0,commissionSgd)
  for(const a of plan.allocations){ const available=Math.max(0,a.amount+(accrual[a.ticker]??0)-commissionRemaining); if(a.amount>0) commissionRemaining=0; const price=prices[a.ticker]??0; const shares=price>0?Math.floor(available/price):0; const cost=shares*price; const carry=available-cost; instructions.push({ticker:a.ticker,sharesToBuy:shares,lotSize:1,costSgd:cost,carryForward:carry,priceSgd:price}); totalDeployed+=cost; totalCarried+=carry }
  return {instructions,totalDeployed,totalCarried,note:totalCarried>0?`SGD ${totalCarried.toFixed(2)} remains in the SBR DCA cash bank for a future whole-share purchase.`:null}
}
