import { ATLAS_SPEC } from "../lib/portfolio-spec"
export interface SeedHolding{ticker:string;name:string;targetPct:number;hardCapPct:number|null;toleranceBand:number;color:string;snapshot:{units:number;price:number;value:number}}
export interface SeedRule{title:string;description:string;category:string;active:boolean}
const meta:Record<string,{name:string;color:string}>={IMID:{name:"SPDR MSCI ACWI IMI UCITS ETF (Acc)",color:"#6366f1"},IWQU:{name:"iShares Edge MSCI World Quality Factor UCITS ETF (Acc)",color:"#06b6d4"},EQAC:{name:"Invesco EQQQ Nasdaq-100 UCITS ETF Acc",color:"#8b5cf6"},SMH:{name:"VanEck Semiconductor UCITS ETF",color:"#a78bfa"},BTC:{name:"Bitcoin sleeve",color:"#f59e0b"}}
export const HOLDINGS_SEED:SeedHolding[]=ATLAS_SPEC.funds.map(f=>({ticker:f.ticker,name:meta[f.ticker]?.name??f.ticker,targetPct:f.target,hardCapPct:f.hardCap,toleranceBand:f.band,color:meta[f.ticker]?.color??"#64748b",snapshot:{units:0,price:0,value:0}}))
export const GOVERNANCE_RULES:SeedRule[]=[
 {title:"Atlas Core target allocation",description:"IMID 52%, IWQU 29%, EQAC 10%, SMH 4%, Bitcoin sleeve 5%.",category:"Portfolio",active:true},
 {title:"Contribution-first rebalancing",description:"Route settled contributions to the furthest-underweight eligible holding; use whole shares and carry residual cash.",category:"Rebalancing",active:true},
 {title:"Growth overlap",description:"EQAC plus SMH watch 16%, hard review 18%; EQAC plus SMH plus Bitcoin hard review 24%.",category:"Concentration",active:true},
 {title:"Look-through governance",description:"Single company watch 7%, hard review 8%; source watch at 35 days and block concentration-led trades after 95 days.",category:"Concentration",active:true},
 {title:"Crash discipline",description:"A market fall alone is not a sell instruction. No margin, borrowing or panic selling.",category:"Behaviour",active:true},
 {title:"External liquidity",description:"Personal SGD emergency liquidity remains outside Atlas; the portfolio has no mandatory cash-fund allocation.",category:"Liquidity",active:true},
]
