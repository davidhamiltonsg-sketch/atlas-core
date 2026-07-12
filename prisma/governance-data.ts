import { ATLAS_SPEC } from "../lib/portfolio-spec"
export interface SeedHolding{ticker:string;name:string;targetPct:number;hardCapPct:number|null;toleranceBand:number;color:string;snapshot:{units:number;price:number;value:number}}
export interface SeedRule{title:string;description:string;category:string;active:boolean}
const meta:Record<string,{name:string;color:string}>={VWRA:{name:"Vanguard FTSE All-World UCITS ETF (USD) Accumulating",color:"#8567ff"},EQAC:{name:"Invesco EQQQ Nasdaq-100 UCITS ETF Acc",color:"#c25cff"},SMH:{name:"VanEck Semiconductor UCITS ETF",color:"#ff6685"},BTC:{name:"Bitcoin sleeve",color:"#ffb454"},DBMFE:{name:"iMGP DBi Managed Futures Fund R EUR UCITS ETF",color:"#52e3bd"}}
export const HOLDINGS_SEED:SeedHolding[]=ATLAS_SPEC.funds.map(f=>({ticker:f.ticker,name:meta[f.ticker]?.name??f.ticker,targetPct:f.target,hardCapPct:f.hardCap,toleranceBand:f.band,color:meta[f.ticker]?.color??"#64748b",snapshot:{units:0,price:0,value:0}}))
export const GOVERNANCE_RULES:SeedRule[]=[
 {title:"Atlas Core target allocation",description:"VWRA 70%, EQAC 10%, SMH 5%, Bitcoin through IBIT 5%, DBMFE managed futures 10%.",category:"Portfolio",active:true},
 {title:"Contribution-first rebalancing",description:"Route settled contributions to the furthest-underweight eligible holding; use whole shares and carry residual cash.",category:"Rebalancing",active:true},
 {title:"Growth overlap",description:"EQAC plus SMH plus Bitcoin target 25%; pause overlapping purchases at the governed watch level and require review at the hard cap.",category:"Concentration",active:true},
 {title:"Look-through governance",description:"Single company watch 7%, hard review 9%; technology 45/50%, semiconductors 25/30%, US 70/75%; source watch at 35 days and block concentration-led trades after 75 days.",category:"Concentration",active:true},
 {title:"Crash discipline",description:"A market fall alone is not a sell instruction. No margin, borrowing or panic selling.",category:"Behaviour",active:true},
 {title:"External liquidity",description:"Personal SGD emergency liquidity remains outside Atlas. Managed futures are a diversifier, not cash, a hedge guarantee or an emergency reserve.",category:"Liquidity",active:true},
]
