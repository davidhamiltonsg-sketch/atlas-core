import { TICKER_TARGETS, POSITION_PROFILE, OPERATING_ASSUMPTIONS } from "@/lib/constants"
import { isInScope } from "@/lib/approved-alternatives"
import { ATLAS_CORE } from "@/lib/constitutions"
import { evaluateFundLimits, evaluateCombinedSleeve, sleeveActuals, summarize, type Align, type GovCheck } from "@/lib/governance-engine"
import type { LookThroughResult } from "@/lib/look-through"
export interface DigestItem { severity:"breach"|"watch"|"info"; title:string; detail:string }
export type { Align, GovCheck }
export interface GovAlignment{checks:GovCheck[];breaches:number;watches:number;overall:Align}
interface Pos{ticker:string;actualPct:number;targetPct:number;toleranceBand?:number|null}
export function evaluateGovernance({positions,lookThrough,usSitedValueUsd}:{positions:Pos[];bufferPct:number;lookThrough:LookThroughResult;usSitedValueUsd?:number}):GovAlignment{
 const checks:GovCheck[]=[]
 // Per-fund hard cap / floor / soft-band and the combined EQAC+SMH ceiling are the shared
 // engine (lib/governance-engine.ts) — same implementation SBR's evaluateSbrGovernance uses,
 // reading limits straight off ATLAS_CORE.funds instead of a parallel hand-copied threshold
 // map, so a boundary/threshold fix can never need a second edit in sbr-governance.ts.
 checks.push(evaluateFundLimits(ATLAS_CORE.funds, positions))
 if (ATLAS_CORE.combined) checks.push({ ...evaluateCombinedSleeve(ATLAS_CORE.combined, positions), id: "tech", label: "EQAC + SMH" })
 const sleeveActual=sleeveActuals(positions)
 const btc=sleeveActual.get("BTC")??0
 const btcTarget=TICKER_TARGETS.BTC??5,btcBand=POSITION_PROFILE.BTC?.band??1.25,btcHardCap=ATLAS_CORE.funds.find(f=>f.ticker==="BTC")?.hardCap??8
 checks.push({id:"bitcoin",label:"Bitcoin sleeve",status:btc>=btcHardCap?"breach":btc>btcTarget+btcBand?"watch":"ok",detail:`${btc.toFixed(1)}% of NAV; target ${btcTarget}%, hard cap ${btcHardCap}%`})
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
 return{checks,...summarize(checks)}
}
