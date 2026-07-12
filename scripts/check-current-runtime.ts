import fs from "node:fs"
const files=["lib/sbr-engine.ts","lib/constitutions.ts","lib/sbr-market.ts","lib/provision-dami.ts","lib/sbr-digest.ts","lib/governance-digest.ts","components/sbr/sbr-dashboard.tsx","components/reports/sbr-report-page.tsx","components/reports/sbr-report-pdf.tsx","components/mission-control/mission-control.tsx","lib/reports/sbr-report-data.ts","app/api/reports/sbr/route.tsx","app/portfolio/actions.ts","prisma/governance-data.ts","prisma/seed-sbr.ts","app/login/page.tsx","app/page.tsx","components/sidebar.tsx","app/forecast/page.tsx","app/reports/page.tsx"]
const banned=[/HDB/i,/property (?:deposit|purchase|goal)/i,/Phase III|Phase IV/i,/A35/i,/VWRA 50%|EQQQ 25%|SEMI 15%/i,/Constitution v1\.5/i]
let failures:string[]=[]
for(const file of files){const text=fs.readFileSync(file,"utf8");for(const p of banned)if(p.test(text))failures.push(`${file}: ${p}`)}
const sidebar=fs.readFileSync("components/sidebar.tsx","utf8")
const atlasBlock=sidebar.split('"atlas-core": [')[1]?.split('"silicon-brick-road": [')[0]??""
const atlasLinks=(atlasBlock.match(/href:/g)??[]).length
if(atlasLinks!==7)failures.push(`Atlas primary navigation has ${atlasLinks} links; expected 7`)
for(const file of ["app/portfolio/page.tsx","app/reports/page.tsx","app/risk/page.tsx","app/forecast/page.tsx"]){const text=fs.readFileSync(file,"utf8");if(!text.includes("activePortfolioContext"))failures.push(`${file}: shared route is not active-owner scoped`)}
const proxy=fs.readFileSync("proxy.ts","utf8");for(const route of ["/holdings","/trades","/contributions","/dividends","/rebalance","/history","/ytd","/calendar","/behaviour","/smart-money","/watchlist","/export"])if(!proxy.includes(`"${route}"`))failures.push(`proxy.ts: missing legacy redirect for ${route}`)
const syncRoute=fs.readFileSync("app/api/sync-ibkr/route.ts","utf8");if(!syncRoute.includes("const fresh=await fetchFlexPositions"))failures.push("IBKR confirmation does not re-fetch authoritative server data")
for(const file of ["app/api/reports/atlas/route.tsx","app/api/reports/sbr/route.tsx"]){if(!fs.readFileSync(file,"utf8").includes("activePortfolioContext"))failures.push(`${file}: report export is not active-owner scoped`)}
for(const file of ["public/silicon-brick-road.html","public/downloads/silicon-brick-road-constitution-v3.2.html"]){const text=fs.readFileSync(file,"utf8");if(text.includes("preview.html"))failures.push(`${file}: links to a deleted preview`)}
if(failures.length)throw new Error(`Current-runtime guard failed:\n${failures.join("\n")}`)
console.log("Current-runtime guard passed: no stale strategy and Atlas navigation remains bounded ✓")
