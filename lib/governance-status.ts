import { HARD_THRESHOLDS, COMBINED_TECH_RULE, BITCOIN_TICKERS } from "@/lib/constants"
import { isInScope } from "@/lib/approved-alternatives"
import type { LookThroughResult } from "@/lib/look-through"
export interface DigestItem { severity:"breach"|"watch"|"info"; title:string; detail:string }
export type Align="ok"|"watch"|"breach"
export interface GovCheck{id:string;label:string;status:Align;detail:string}
export interface GovAlignment{checks:GovCheck[];breaches:number;watches:number;overall:Align}
interface Pos{ticker:string;actualPct:number;targetPct:number;toleranceBand?:number|null}
export function evaluateGovernance({positions,lookThrough,usSitedValueUsd}:{positions:Pos[];bufferPct:number;lookThrough:LookThroughResult;usSitedValueUsd?:number}):GovAlignment{
 const checks:GovCheck[]=[];let hard=0,soft=0
 for(const p of positions){const h=HARD_THRESHOLDS[p.ticker];if(!h)continue;if(p.actualPct>h.high||(h.low!==undefined&&p.actualPct<h.low))hard++;else if(Math.abs(p.actualPct-p.targetPct)>(p.toleranceBand??2.5))soft++}
 checks.push({id:"drift",label:"Allocation bands",status:hard?"breach":soft?"watch":"ok",detail:hard?`${hard} holding(s) outside a hard limit`:soft?`${soft} holding(s) outside a soft band`:"All governed holdings are within their bands"})
 const btc=positions.filter(p=>(BITCOIN_TICKERS as readonly string[]).includes(p.ticker.toUpperCase())).reduce((s,p)=>s+p.actualPct,0)
 checks.push({id:"bitcoin",label:"Bitcoin sleeve",status:btc>8?"breach":btc>7?"watch":"ok",detail:`${btc.toFixed(1)}% of NAV; target 5%, hard cap 8%`})
 const tech=positions.filter(p=>(COMBINED_TECH_RULE.tickers as readonly string[]).includes(p.ticker.toUpperCase())).reduce((s,p)=>s+p.actualPct,0)
 checks.push({id:"tech",label:"EQAC + SMH",status:tech>=COMBINED_TECH_RULE.hardCeiling?"breach":tech>=COMBINED_TECH_RULE.softCeiling?"watch":"ok",detail:`${tech.toFixed(1)}%; watch ${COMBINED_TECH_RULE.softCeiling}%, hard ${COMBINED_TECH_RULE.hardCeiling}%`})
 const companies=lookThrough.companies,sectors=lookThrough.sectors
 checks.push({id:"company",label:"Single-company look-through",status:companies.some(x=>x.status==="breach")?"breach":companies.some(x=>x.status==="watch")?"watch":"ok",detail:companies[0]?`${companies[0].label} is largest at ${companies[0].pct.toFixed(1)}%`:"No exposure data"})
 checks.push({id:"sector",label:"Sector/country look-through",status:sectors.some(x=>x.status==="breach")?"breach":sectors.some(x=>x.status==="watch")?"watch":"ok",detail:sectors[0]?`${sectors[0].label} is largest at ${sectors[0].pct.toFixed(1)}%`:"No exposure data"})
 if(usSitedValueUsd!==undefined&&usSitedValueUsd>0)checks.push({id:"estate",label:"US-sited legacy exposure",status:usSitedValueUsd>60000?"watch":"ok",detail:`USD ${Math.round(usSitedValueUsd).toLocaleString()} remains in US-sited instruments`})
 const off=positions.filter(p=>p.actualPct>0&&!isInScope(p.ticker)).map(p=>p.ticker)
 checks.push({id:"scope",label:"Approved or transition holdings",status:off.length?"watch":"ok",detail:off.length?`${off.join(", ")} requires a documented transition or amendment`:"All holdings are governed"})
 const breaches=checks.filter(x=>x.status==="breach").length,watches=checks.filter(x=>x.status==="watch").length
 return{checks,breaches,watches,overall:breaches?"breach":watches?"watch":"ok"}
}
