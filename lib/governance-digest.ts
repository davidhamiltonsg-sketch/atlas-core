import {db} from "@/lib/db"
import {computeLookThrough} from "@/lib/look-through"
import {evaluateGovernance,type DigestItem} from "@/lib/governance-status"
export type {DigestItem}
export interface GovernanceDigest{user:{id:string;name:string;email:string};totalValue:number;snapshotAgeDays:number|null;items:DigestItem[];actionable:boolean;drawdownPct:number|null;sgovPct:number}
export async function buildGovernanceDigest(userId:string):Promise<GovernanceDigest|null>{
 const user=await db.user.findUnique({where:{id:userId}});if(!user)return null
 const holdings=await db.holding.findMany({where:{userId},include:{snapshots:{orderBy:{date:"desc"},take:2}}})
 const totalValue=holdings.reduce((s,h)=>s+(h.snapshots[0]?.value??0),0);const positions=holdings.map(h=>({ticker:h.ticker,actualPct:totalValue>0?(h.snapshots[0]?.value??0)/totalValue*100:0,targetPct:h.targetPct,toleranceBand:h.toleranceBand}))
 const lookThrough=computeLookThrough(positions),alignment=evaluateGovernance({positions,bufferPct:0,lookThrough})
 const latest=holdings.reduce<Date|null>((x,h)=>h.snapshots[0]?.date&&(!x||h.snapshots[0].date>x)?h.snapshots[0].date:x,null);const age=latest?Math.floor((Date.now()-latest.getTime())/86400000):null
 const items:DigestItem[]=alignment.checks.filter(c=>c.status!=="ok").map(c=>({severity:c.status==="breach"?"breach":"watch",title:c.label,detail:c.detail}));if(age===null||age>7)items.push({severity:age===null||age>35?"breach":"watch",title:"IBKR data freshness",detail:age===null?"No position snapshot is available.":`Latest snapshot is ${age} days old.`})
 return{user:{id:user.id,name:user.name,email:user.email},totalValue,snapshotAgeDays:age,items,actionable:items.length>0,drawdownPct:null,sgovPct:0}
}
