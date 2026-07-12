import {db} from "@/lib/db"
import {SILICON_BRICK_ROAD as SBR} from "@/lib/constitutions"
import {computeSbrNextMove,computeSbrHealth,type SbrPosition} from "@/lib/sbr-engine"
import {evaluateSbrGovernance} from "@/lib/sbr-governance"
import type {DigestItem} from "@/lib/governance-status";import type{NextMove}from"@/lib/next-best-move"
export interface SbrDigest{user:{id:string;name:string;email:string};totalValue:number;phase:{key:string;label:string};nextMove:NextMove;snapshotAgeDays:number|null;healthScore:number;items:DigestItem[];actionable:boolean;phaseCrossed:boolean;newPhaseKey:string|null}
export async function buildSbrDigest(userId:string):Promise<SbrDigest|null>{
 const user=await db.user.findUnique({where:{id:userId}});if(!user)return null
 const holdings=await db.holding.findMany({where:{userId},include:{snapshots:{orderBy:{date:"desc"},take:1}}});const totalValue=holdings.reduce((s,h)=>s+(h.snapshots[0]?.value??0),0)
 const positions:SbrPosition[]=holdings.map(h=>{const f=SBR.funds.find(x=>x.ticker===h.ticker);const value=h.snapshots[0]?.value??0;return{ticker:h.ticker,name:h.name,color:h.color,value,actualPct:totalValue>0?value/totalValue*100:0,targetPct:h.targetPct,rangeLow:f?.rangeLow??h.targetPct-h.toleranceBand,rangeHigh:f?.rangeHigh??h.targetPct+h.toleranceBand,hardCap:h.hardCapPct,floor:f?.floor,latestPrice:h.snapshots[0]?.price??0,hi52:0}})
 const latest=holdings.reduce<Date|null>((x,h)=>h.snapshots[0]?.date&&(!x||h.snapshots[0].date>x)?h.snapshots[0].date:x,null);const age=latest?Math.floor((Date.now()-latest.getTime())/86400000):null;const governance=evaluateSbrGovernance(positions,totalValue),move=computeSbrNextMove(positions,totalValue),health=computeSbrHealth(positions,totalValue,age??999)
 const items:DigestItem[]=governance.checks.filter(c=>c.status!=="ok").map(c=>({severity:c.status==="breach"?"breach":"watch",title:c.label,detail:c.detail}));if(age===null||age>35)items.push({severity:age===null||age>95?"breach":"watch",title:"Data freshness",detail:age===null?"No IBKR snapshot is available.":`Latest snapshot is ${age} days old.`})
 return{user:{id:user.id,name:user.name,email:user.email},totalValue,phase:{key:"GROWTH",label:"Flexible growth"},nextMove:move,snapshotAgeDays:age,healthScore:health.overall,items,actionable:items.length>0,phaseCrossed:false,newPhaseKey:null}
}
