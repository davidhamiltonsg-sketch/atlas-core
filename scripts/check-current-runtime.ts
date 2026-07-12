import fs from "node:fs"
import { ATLAS_SPEC, SBR_SPEC } from "../lib/portfolio-spec"
import { ATLAS_CORE, SILICON_BRICK_ROAD } from "../lib/constitutions"

const failures:string[]=[]
const read=(f:string)=>fs.readFileSync(f,"utf8")
const expect=(ok:boolean,msg:string)=>{if(!ok)failures.push(msg)}
expect(ATLAS_CORE.version==="10.4","Atlas runtime version is not 10.4")
expect(SILICON_BRICK_ROAD.version==="10.2","SBR runtime version is not 10.2")
expect(ATLAS_SPEC.funds.map(f=>`${f.ticker}:${f.target}`).join("|")==="VWRA:70|EQAC:10|SMH:5|BTC:5|DBMFE:10","Atlas canonical weights drifted")
expect(SBR_SPEC.funds.map(f=>`${f.ticker}:${f.target}`).join("|")==="VWRA:65|EQAC:15|SMH:5|BTC:5|DBMFE:10","SBR canonical weights drifted")
for(const [file,version,weights] of [["public/atlas-core-constitution.html","v10.4","VWRA 70 · EQAC 10 · SMH 5 · BTC 5 · DBMFE 10"],["public/downloads/atlas-core-constitution-v10.4.html","v10.4","VWRA 70 · EQAC 10 · SMH 5 · BTC 5 · DBMFE 10"],["public/silicon-brick-road.html","v10.2","VWRA 65 · EQAC 15 · SMH 5 · BTC 5 · DBMFE 10"],["public/downloads/silicon-brick-road-constitution-v10.2.html","v10.2","VWRA 65 · EQAC 15 · SMH 5 · BTC 5 · DBMFE 10"]]){const t=read(file);expect(t.includes(version),`${file}: wrong version`);expect(t.includes(weights),`${file}: wrong target`);expect(t.includes("LU2951555403")&&t.includes("iMGP DBi Managed Futures"),`${file}: DBMFE identity missing`)}
expect(read("public/atlas-core-constitution.html")===read("public/downloads/atlas-core-constitution-v10.4.html"),"Atlas served/download constitutions differ")
expect(read("public/silicon-brick-road.html")===read("public/downloads/silicon-brick-road-constitution-v10.2.html"),"SBR served/download constitutions differ")
for(const file of ["lib/next-best-move.ts","lib/ladder.ts","lib/sbr-governance.ts","components/sbr/sbr-dashboard.tsx","components/reports/sbr-report-page.tsx","app/api/cron/monthly/route.ts"]){const t=read(file);for(const p of [/Start with IMID/i,/IMID 80%/i,/IB01 5%/i,/Constitution v3\.[12]/i])expect(!p.test(t),`${file}: stale active instruction ${p}`)}
const init=read("scripts/init-db.mjs");expect(!/IMID 52%|IWQU 29%/.test(init),"init-db still seeds retired Atlas mandate")
const engine=read("lib/portfolio-engine-v2.ts");expect(engine.includes('"SMH.US"')&&engine.includes('"GBTC"'),"migration engine lacks legacy identities")
const identity=read("lib/instrument-identity.ts");expect(identity.includes('symbol === "IBIT" || symbol === "GBTC"'),"Bitcoin economic-sleeve aggregation missing")
const page=read("app/page.tsx");for(const old of ["<DecisionLadderCard","<GovernanceSeal","<ComplianceBoard","<HealthMethodology"])expect(!page.includes(old),`Atlas first page still renders legacy ${old}`)
for(const file of ["app/portfolio/page.tsx","app/reports/page.tsx","app/risk/page.tsx","app/forecast/page.tsx"])expect(read(file).includes("activePortfolioContext"),`${file}: route is not active-owner scoped`)
if(failures.length)throw new Error(`Current-runtime guard failed:\n${failures.join("\n")}`)
console.log("Current-runtime guard passed: canonical documents, engines and app agree ✓")
