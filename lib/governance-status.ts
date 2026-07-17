import { HARD_THRESHOLDS, TICKER_TARGETS, COMBINED_TECH_RULE, POSITION_PROFILE, OPERATING_ASSUMPTIONS } from "@/lib/constants"
import { isInScope } from "@/lib/approved-alternatives"
import { economicSleeveTicker } from "@/lib/instrument-identity"
import type { LookThroughResult } from "@/lib/look-through"
export interface DigestItem { severity:"breach"|"watch"|"info"; title:string; detail:string }
export type Align="ok"|"watch"|"breach"
export interface GovCheck{id:string;label:string;status:Align;detail:string}
export interface GovAlignment{checks:GovCheck[];breaches:number;watches:number;overall:Align}
interface Pos{ticker:string;actualPct:number;targetPct:number;toleranceBand?:number|null}
export function evaluateGovernance({positions,lookThrough,usSitedValueUsd}:{positions:Pos[];bufferPct:number;lookThrough:LookThroughResult;usSitedValueUsd?:number}):GovAlignment{
 const checks:GovCheck[]=[];let hard=0,soft=0
 // Bands judge the ECONOMIC sleeve (identity over ticker): alternate exchange lines of the
 // same instrument (EQQQ→EQAC, SEMI→SMH, IBIT/GBTC→BTC) are summed before §3 limits apply,
 // so a governed line can never read as its own drift. Sleeve target comes from the spec
 // (TICKER_TARGETS) because callers may pass either raw or sleeve-adjusted row targets.
 const sleeveActual=new Map<string,number>()
 for(const p of positions){const k=economicSleeveTicker(p.ticker);sleeveActual.set(k,(sleeveActual.get(k)??0)+p.actualPct)}
 // Boundary is inclusive (>=/<=) — a sleeve sitting EXACTLY on the cap is already at the
 // limit the constitution names ("at 8%, stop adding and review"), not one basis point shy
 // of it. Matches statusFor's own `pct >= hard` in look-through.ts.
 for(const p of positions){if(p.ticker!==economicSleeveTicker(p.ticker))continue;const h=HARD_THRESHOLDS[p.ticker];if(!h)continue;const a=sleeveActual.get(p.ticker)??p.actualPct;const target=TICKER_TARGETS[p.ticker]??p.targetPct;if(a>=h.high||(h.low!==undefined&&a<=h.low))hard++;else if(Math.abs(a-target)>(p.toleranceBand??2.5))soft++}
 checks.push({id:"drift",label:"Allocation bands",status:hard?"breach":soft?"watch":"ok",detail:hard?`${hard} sleeve(s) outside a hard limit`:soft?`${soft} sleeve(s) outside a soft band`:"All governed sleeves are within their bands"})
 const btc=positions.filter(p=>economicSleeveTicker(p.ticker)==="BTC").reduce((s,p)=>s+p.actualPct,0)
 const btcTarget=TICKER_TARGETS.BTC??5,btcBand=POSITION_PROFILE.BTC?.band??1.25,btcHardCap=HARD_THRESHOLDS.BTC?.high??8
 checks.push({id:"bitcoin",label:"Bitcoin sleeve",status:btc>=btcHardCap?"breach":btc>btcTarget+btcBand?"watch":"ok",detail:`${btc.toFixed(1)}% of NAV; target ${btcTarget}%, hard cap ${btcHardCap}%`})
 const tech=positions.filter(p=>(COMBINED_TECH_RULE.tickers as readonly string[]).includes(economicSleeveTicker(p.ticker))).reduce((s,p)=>s+p.actualPct,0)
 checks.push({id:"tech",label:"EQAC + SMH",status:tech>=COMBINED_TECH_RULE.hardCeiling?"breach":tech>=COMBINED_TECH_RULE.softCeiling?"watch":"ok",detail:`${tech.toFixed(1)}%; watch ${COMBINED_TECH_RULE.softCeiling}%, hard ${COMBINED_TECH_RULE.hardCeiling}%`})
 const companies=lookThrough.companies,sectors=lookThrough.sectors
 checks.push({id:"company",label:"Single-company look-through",status:companies.some(x=>x.status==="breach")?"breach":companies.some(x=>x.status==="watch")?"watch":"ok",detail:companies[0]?`${companies[0].label} is largest at ${companies[0].pct.toFixed(1)}%`:"No exposure data"})
 checks.push({id:"sector",label:"Sector/country look-through",status:sectors.some(x=>x.status==="breach")?"breach":sectors.some(x=>x.status==="watch")?"watch":"ok",detail:sectors[0]?`${sectors[0].label} is largest at ${sectors[0].pct.toFixed(1)}%`:"No exposure data"})
 // Art. XV two-tier trigger: warn past usEstateTaxTriggerUsd (60k), escalate to the stronger
 // "mandatory review" tier once ucitsMandatoryTriggerUsd (100k) is crossed — previously only
 // the warn tier was ever reachable, so the mandatory-review escalation could never fire.
 if(usSitedValueUsd!==undefined&&usSitedValueUsd>0){
   const warnAt=OPERATING_ASSUMPTIONS.usEstateTaxTriggerUsd,breachAt=OPERATING_ASSUMPTIONS.ucitsMandatoryTriggerUsd
   checks.push({id:"estate",label:"US-sited legacy exposure",status:usSitedValueUsd>=breachAt?"breach":usSitedValueUsd>=warnAt?"watch":"ok",detail:`USD ${Math.round(usSitedValueUsd).toLocaleString()} remains in US-sited instruments${usSitedValueUsd>=breachAt?` — mandatory UCITS migration review required above $${breachAt.toLocaleString()}`:""}`})
 }
 const off=positions.filter(p=>p.actualPct>0&&!isInScope(p.ticker)).map(p=>p.ticker)
 checks.push({id:"scope",label:"Approved or transition holdings",status:off.length?"watch":"ok",detail:off.length?`${off.join(", ")} requires a documented transition or amendment`:"All holdings are governed"})
 const breaches=checks.filter(x=>x.status==="breach").length,watches=checks.filter(x=>x.status==="watch").length
 return{checks,breaches,watches,overall:breaches?"breach":watches?"watch":"ok"}
}
