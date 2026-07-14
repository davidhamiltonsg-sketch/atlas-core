import {db} from "@/lib/db"
import {SILICON_BRICK_ROAD as SBR} from "@/lib/constitutions"
import {computeSbrNextMove,computeSbrHealth,type SbrPosition} from "@/lib/sbr-engine"
import {evaluateSbrGovernance} from "@/lib/sbr-governance"
import {computeSbrLookThrough} from "@/lib/sbr-look-through";import {refreshedLookThroughData} from "@/lib/look-through-data"
import {ibkrCredentialsFor} from "@/lib/ibkr-config"
import type {DigestItem} from "@/lib/governance-status";import type{NextMove}from"@/lib/next-best-move"
const SYNC_STALE_DAYS=3
export interface SbrDigest{user:{id:string;name:string;email:string};totalValue:number;phase:{key:string;label:string};nextMove:NextMove;snapshotAgeDays:number|null;healthScore:number;items:DigestItem[];actionable:boolean;phaseCrossed:boolean;newPhaseKey:string|null}
export async function buildSbrDigest(userId:string):Promise<SbrDigest|null>{
 const user=await db.user.findUnique({where:{id:userId}});if(!user)return null
 const holdings=await db.holding.findMany({where:{userId},include:{snapshots:{orderBy:{date:"desc"},take:1}}});const totalValue=holdings.reduce((s,h)=>s+(h.snapshots[0]?.value??0),0)
 const positions:SbrPosition[]=holdings.map(h=>{const f=SBR.funds.find(x=>x.ticker===h.ticker);const value=h.snapshots[0]?.value??0;return{ticker:h.ticker,name:h.name,color:h.color,value,actualPct:totalValue>0?value/totalValue*100:0,targetPct:h.targetPct,rangeLow:f?.rangeLow??h.targetPct-h.toleranceBand,rangeHigh:f?.rangeHigh??h.targetPct+h.toleranceBand,hardCap:h.hardCapPct,floor:f?.floor,latestPrice:h.snapshots[0]?.price??0,hi52:0}})
 const latest=holdings.reduce<Date|null>((x,h)=>h.snapshots[0]?.date&&(h.snapshots[0]?.value??0)>0&&(!x||h.snapshots[0].date<x)?h.snapshots[0].date:x,null);const age=latest?Math.floor((Date.now()-latest.getTime())/86400000):null;const refreshed=await refreshedLookThroughData(),dates=Object.values(refreshed.updatedAt),asOf=dates.length?new Date(Math.min(...dates.map(d=>d.getTime()))):new Date(0),lt=computeSbrLookThrough(positions,new Date(),asOf,refreshed.weights),governance=evaluateSbrGovernance(positions,totalValue,asOf,new Date(),lt),move=computeSbrNextMove(positions,totalValue),health=computeSbrHealth(positions,totalValue,age??999,SBR,user.sbrExternalLiquidityVerified)
 const items:DigestItem[]=governance.checks.filter(c=>c.status!=="ok").map(c=>({severity:c.status==="breach"?"breach":"watch",title:c.label,detail:c.detail}));if(age===null||age>35)items.push({severity:age===null||age>75?"breach":"watch",title:"Data freshness",detail:age===null?"No IBKR snapshot is available.":`Oldest open-position snapshot is ${age} days old.`})
 // Sync-failure watch: the broker connection is configured but the last recorded successful
 // sync is older than SYNC_STALE_DAYS (syncs run daily) — the access token has likely expired.
 {const {token,positionsQuery}=ibkrCredentialsFor("silicon-brick-road")
  if(token&&positionsQuery){
   const lastSync=await db.ibkrSyncLog.findFirst({where:{userId},orderBy:{syncedAt:"desc"},select:{syncedAt:true}})
   const syncAgeDays=lastSync?Math.floor((Date.now()-lastSync.syncedAt.getTime())/86400000):null
   if(syncAgeDays===null||syncAgeDays>SYNC_STALE_DAYS)items.push({severity:"watch",title:"IBKR sync may be broken — regenerate the Flex token",detail:syncAgeDays===null?"The broker connection is set up but the app has never received an automatic update.":`The app last received an automatic broker update ${syncAgeDays} days ago (updates normally arrive daily). The connection token has probably expired — creating a fresh one on the broker's website restores automatic updates.`})}}
 return{user:{id:user.id,name:user.name,email:user.email},totalValue,phase:{key:"GROWTH",label:"Flexible growth"},nextMove:move,snapshotAgeDays:age,healthScore:health.overall,items,actionable:items.length>0,phaseCrossed:false,newPhaseKey:null}
}
