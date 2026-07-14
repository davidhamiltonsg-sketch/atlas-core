import {db} from "@/lib/db"
import {computeLookThrough} from "@/lib/look-through"
import {evaluateGovernance,type DigestItem} from "@/lib/governance-status"
import {refreshedLookThroughData} from "@/lib/look-through-data"
import {ibkrCredentialsFor} from "@/lib/ibkr-config"

const SYNC_STALE_DAYS=3
export type {DigestItem}
export interface GovernanceDigest{user:{id:string;name:string;email:string};totalValue:number;snapshotAgeDays:number|null;items:DigestItem[];actionable:boolean;drawdownPct:number|null;crashNewlyTriggered:boolean}

export const CRASH_DRAWDOWN_TRIGGER_PCT=-25
const DRAWDOWN_WATCH_PCT=-20

// Drawdown vs the portfolio's all-time high, reconstructed from daily snapshot totals.
// Returns the current drawdown and the previous snapshot day's drawdown so callers can
// detect a fresh crossing (send the crash email once, not every day it stays breached).
async function computeDrawdown(userId:string,totalValue:number):Promise<{drawdownPct:number|null;previousDrawdownPct:number|null}>{
 const snaps=await db.snapshot.findMany({where:{holding:{userId}},select:{holdingId:true,date:true,value:true},orderBy:{date:"asc"}})
 // Last value per holding per day, then daily portfolio totals.
 const perHoldingDay=new Map<string,number>()
 for(const s of snaps)perHoldingDay.set(`${s.holdingId}|${s.date.toISOString().slice(0,10)}`,s.value)
 const byDay=new Map<string,number>()
 for(const [k,v] of perHoldingDay){const day=k.slice(k.indexOf("|")+1);byDay.set(day,(byDay.get(day)??0)+v)}
 const days=[...byDay.entries()].sort((a,b)=>a[0]<b[0]?-1:1)
 let runPeak=0,prevDd:number|null=null,lastDd:number|null=null
 for(const [,v] of days){if(v>runPeak)runPeak=v;const dd=runPeak>0?((v-runPeak)/runPeak)*100:null;prevDd=lastDd;lastDd=dd}
 const ath=Math.max(runPeak,totalValue)
 const drawdownPct=ath>0&&totalValue>0?((totalValue-ath)/ath)*100:null
 return{drawdownPct,previousDrawdownPct:prevDd}
}

export async function buildGovernanceDigest(userId:string):Promise<GovernanceDigest|null>{
 const user=await db.user.findUnique({where:{id:userId}});if(!user)return null
 const holdings=await db.holding.findMany({where:{userId},include:{snapshots:{orderBy:{date:"desc"},take:2}}})
 const totalValue=holdings.reduce((s,h)=>s+(h.snapshots[0]?.value??0),0);const positions=holdings.map(h=>({ticker:h.ticker,actualPct:totalValue>0?(h.snapshots[0]?.value??0)/totalValue*100:0,targetPct:h.targetPct,toleranceBand:h.toleranceBand}))
 const refreshed=await refreshedLookThroughData(),lookThrough=computeLookThrough(positions,new Date(),refreshed.updatedAt,refreshed.weights),alignment=evaluateGovernance({positions,bufferPct:0,lookThrough})
 const latest=holdings.reduce<Date|null>((x,h)=>h.snapshots[0]?.date&&(h.snapshots[0]?.value??0)>0&&(!x||h.snapshots[0].date<x)?h.snapshots[0].date:x,null);const age=latest?Math.floor((Date.now()-latest.getTime())/86400000):null
 const items:DigestItem[]=alignment.checks.filter(c=>c.status!=="ok").map(c=>({severity:c.status==="breach"?"breach":"watch",title:c.label,detail:c.detail}));if(age===null||age>7)items.push({severity:age===null||age>35?"breach":"watch",title:"IBKR data freshness",detail:age===null?"No position snapshot is available.":`Latest snapshot is ${age} days old.`})
 // Sync-failure watch: IBKR Flex is configured but the last recorded successful sync is older
 // than SYNC_STALE_DAYS (the cron runs daily) — the Flex token has most likely expired.
 {const {token,positionsQuery}=ibkrCredentialsFor("atlas-core")
  if(token&&positionsQuery){
   const lastSync=await db.ibkrSyncLog.findFirst({where:{userId},orderBy:{syncedAt:"desc"},select:{syncedAt:true}})
   const syncAgeDays=lastSync?Math.floor((Date.now()-lastSync.syncedAt.getTime())/86400000):null
   if(syncAgeDays===null||syncAgeDays>SYNC_STALE_DAYS)items.push({severity:"watch",title:"IBKR sync may be broken — regenerate the Flex token",detail:syncAgeDays===null?"IBKR Flex is configured but no successful sync has ever been recorded.":`The last successful IBKR sync was ${syncAgeDays} days ago (syncs run daily). Flex tokens expire — regenerate the token in IBKR Client Portal and update the environment variable.`})}}
 const {drawdownPct,previousDrawdownPct}=await computeDrawdown(userId,totalValue)
 if(drawdownPct!==null&&drawdownPct<=DRAWDOWN_WATCH_PCT)items.push({severity:drawdownPct<=CRASH_DRAWDOWN_TRIGGER_PCT?"breach":"watch",title:"Portfolio drawdown",detail:`Portfolio is ${Math.abs(drawdownPct).toFixed(1)}% below its all-time high. ${drawdownPct<=CRASH_DRAWDOWN_TRIGGER_PCT?"Crash discipline applies: continue contributions, sell nothing, log the event.":"Glide-path or discretionary changes should wait until the drawdown clears 20%."}`})
 const crashNewlyTriggered=drawdownPct!==null&&drawdownPct<=CRASH_DRAWDOWN_TRIGGER_PCT&&(previousDrawdownPct===null||previousDrawdownPct>CRASH_DRAWDOWN_TRIGGER_PCT)
 return{user:{id:user.id,name:user.name,email:user.email},totalValue,snapshotAgeDays:age,items,actionable:items.length>0,drawdownPct,crashNewlyTriggered}
}
