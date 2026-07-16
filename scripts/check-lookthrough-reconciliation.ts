import assert from "node:assert/strict"
import {computeLookThrough} from "../lib/look-through"
import {computeSbrLookThrough} from "../lib/sbr-look-through"

const atlas=[{ticker:"VWRA",actualPct:70},{ticker:"EQAC",actualPct:10},{ticker:"SMH",actualPct:5},{ticker:"IBIT",actualPct:5},{ticker:"DBMFE",actualPct:10}]
const sbr=[{ticker:"VWRA",actualPct:65},{ticker:"EQAC",actualPct:10},{ticker:"SMH",actualPct:5},{ticker:"BTC",actualPct:5},{ticker:"DBMFE",actualPct:10},{ticker:"A35",actualPct:5}]
const near=(a:number,b:number,label:string)=>assert.ok(Math.abs(a-b)<0.0001,`${label}: ${a} != ${b}`)
const a=computeLookThrough(atlas,new Date("2026-07-12"))
for(const line of [...a.companies,...a.sectors,...a.geographies,...a.assets])near(line.pct,line.contributors.reduce((sum,row)=>sum+row.contributionPct,0),`Atlas ${line.label}`)
near(a.assets.reduce((s,x)=>s+x.pct,0),100,"Atlas asset classes")
near(a.geographies.reduce((s,x)=>s+x.pct,0)+a.managedFuturesPct,100,"Atlas geography plus non-geographic managed futures")
const dynamic=computeLookThrough(atlas,new Date("2026-07-12"),undefined,{VWRA:{sectorWeights:{digital:50,semiconductor:8,us:62,ai:15}}})
assert.notEqual(dynamic.sectors.find(x=>x.key==="digital")?.pct,a.sectors.find(x=>x.key==="digital")?.pct,"Refreshed coefficients must change Atlas output")
near(a.unclassifiedPct,0,"Atlas canonical mix must be fully classified")
const b=computeSbrLookThrough(sbr,new Date("2026-07-12"))
near(b.unclassifiedPct,0,"SBR canonical mix (incl. A35) must be fully classified")
for(const line of [...b.companies,...b.countries,...b.industries,...b.assets])near(line.pct,(line.contributors??[]).reduce((sum,row)=>sum+row.contributionPct,0),`SBR ${line.name}`)
near(sbr.reduce((sum,row)=>sum+row.actualPct,0),100,"SBR position control")
near(atlas.reduce((sum,row)=>sum+row.actualPct,0),100,"Atlas position control")
console.log("Look-through contribution matrices reconcile and refreshed coefficients change output ✓")
