import { db } from "@/lib/db"
import type { FundLookThroughWeights } from "@/lib/look-through"

function record(value:string):Record<string,number>|null{try{const parsed=JSON.parse(value);if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))return null;const entries=Object.entries(parsed);if(entries.some(([,v])=>typeof v!=="number"||!Number.isFinite(v)||v<0||v>100))return null;return Object.fromEntries(entries) as Record<string,number>}catch{return null}}
function hasKeys(row:Record<string,number>,keys:string[]){return keys.every(key=>Object.hasOwn(row,key))}

export async function refreshedLookThroughData(){
  const rows=await db.etfLookThrough.findMany()
  const weights:Record<string,FundLookThroughWeights>={},updatedAt:Record<string,Date>={},sources:Record<string,string>={}
  for(const row of rows){const company=record(row.companyWeights),sector=record(row.sectorWeights),geo=record(row.geoWeights);if(!company||!sector||!geo||!hasKeys(sector,["semiconductor","digital","us","ai"])||!hasKeys(geo,["us","intlDev","emerging","crypto"]))continue;const ticker=row.ticker.toUpperCase();weights[ticker]={companyWeights:company,sectorWeights:sector,geoWeights:geo};updatedAt[ticker]=row.updatedAt;sources[ticker]=row.source}
  return {weights,updatedAt,sources}
}
