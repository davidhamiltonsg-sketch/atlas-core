import {redirect} from "next/navigation"
import {Shell} from "@/components/shell"
import {getSession} from "@/lib/session"
import {activePortfolioContext} from "@/lib/active-portfolio"
import {getAtlasReportData} from "@/lib/reports/atlas-report-data"
import {SbrReportPage} from "@/components/reports/sbr-report-page"
import {AllocationDonut} from "@/components/charts/allocation-donut"
import {DownloadReportCard} from "@/components/reports/download-report-card"
import {RefreshLookThroughButton} from "@/components/reports/refresh-look-through-button"
import {LookThroughReconciliation} from "@/components/reports/look-through-reconciliation"
import {formatCurrency} from "@/lib/utils"
import {db} from "@/lib/db"

// Dividends, fees and interest received so far this calendar year, from the imported IBKR
// records (Dividend rows + immutable ledger FEE/INTEREST categories). Amounts are stored in
// the account base currency (SGD) — same as every other figure on this page. Returns null
// when nothing has been recorded so the page renders no empty-state noise.
async function getYtdIncomeAndCosts(userId:string):Promise<{dividends:number;fees:number;interest:number}|null>{
 const yearStart=new Date(new Date().getFullYear(),0,1)
 const [divAgg,ledgerRows]=await Promise.all([
  db.dividend.aggregate({_sum:{amount:true},where:{userId,paymentDate:{gte:yearStart}}}),
  db.ibkrLedgerEntry.findMany({where:{userId,category:{in:["FEE","INTEREST"]},date:{gte:yearStart}},select:{category:true,amount:true,amountBase:true,fxRate:true}}),
 ])
 const dividends=divAgg._sum.amount??0
 const baseOf=(r:{amount:number;amountBase:number|null;fxRate:number|null})=>r.amountBase??(r.fxRate?r.amount*r.fxRate:r.amount)
 const fees=ledgerRows.filter(r=>r.category==="FEE").reduce((s,r)=>s+baseOf(r),0)
 const interest=ledgerRows.filter(r=>r.category==="INTEREST").reduce((s,r)=>s+baseOf(r),0)
 if(dividends===0&&ledgerRows.length===0)return null
 return {dividends,fees,interest}
}

export default async function Reports(){const session=await getSession();if(!session)redirect("/login");const active=await activePortfolioContext(session);if(active.constitutionId==="silicon-brick-road")return <SbrReportPage userId={active.owner.id} userName={session.name} isAdmin={session.role==="admin"}/>;const d=await getAtlasReportData(active.owner.id,"monthly");const ytd=await getYtdIncomeAndCosts(active.owner.id);return <Shell title="Look-through" subtitle="Atlas Core · every headline reconciled to its fund contributions" userName={session.name} isAdmin={session.role==="admin"} constitutionId="atlas-core"><div className="report-deck">
 <section className="report-hero"><div><p>PORTFOLIO X-RAY</p><h1>See through the ETF labels.</h1><span>Actual settled holdings, including transition positions. Every exposure below opens into the fund-level multiplication that creates it.</span><RefreshLookThroughButton compact lastUpdated={null}/></div><AllocationDonut data={d.positions.map(p=>({ticker:p.ticker,name:p.name,color:p.color,value:p.value,actualPct:p.actualPct,targetPct:p.targetPct}))} totalValue={d.totalValue}/><dl><div><dt>Portfolio value</dt><dd>{formatCurrency(d.totalValue,"SGD")}</dd></div><div><dt>Health</dt><dd>{d.health.overall}/100</dd></div><div><dt>Source status</dt><dd className={d.lookThrough.stale?"down":"up"}>{d.lookThrough.freshness}</dd></div></dl></section>
 <section className="report-decision"><article><span>NEXT PERMITTED ACTION</span><h2>{d.nextMove.headline}</h2><p>{d.nextMove.instruction}</p><small>{d.nextMove.rationale}</small></article><article><span>CLASSIFICATION CONTROL</span><h2>{d.lookThrough.unclassifiedPct.toFixed(2)}% unclassified</h2><p>Managed futures {d.lookThrough.managedFuturesPct.toFixed(2)}% · Bitcoin {d.lookThrough.cryptoPct.toFixed(2)}%</p><small>Overlapping themes do not sum to 100%; each headline reconciles independently.</small></article></section>
 <section className="allocation-ledger"><header><p>POSITION CONTROL</p><h2>Actual allocation versus mandate</h2></header><table><thead><tr><th>Holding</th><th>Value</th><th>Actual</th><th>Target</th><th>Drift</th><th>Status</th></tr></thead><tbody>{d.positions.map(p=><tr key={p.ticker}><td>{p.ticker}</td><td>{formatCurrency(p.value,"SGD")}</td><td>{p.actualPct.toFixed(2)}%</td><td>{p.targetPct}%</td><td>{p.drift>=0?"+":""}{p.drift.toFixed(2)}%</td><td className={p.status==="hard"?"down":p.status==="soft"?"warn":"up"}>{p.status}</td></tr>)}</tbody><tfoot><tr><td>Total</td><td>{formatCurrency(d.positions.reduce((s,p)=>s+p.value,0),"SGD")}</td><td>{d.positions.reduce((s,p)=>s+p.actualPct,0).toFixed(2)}%</td><td colSpan={3}>Reconciled to portfolio value</td></tr></tfoot></table></section>
 <div className="report-matrices"><LookThroughReconciliation title="Company exposure" description="Portfolio weight × the company weight inside each fund. This is a covered-company lens, not a 100% taxonomy." lines={d.lookThrough.companies}/><LookThroughReconciliation title="Overlapping themes" description="Technology, semiconductors and AI are independent lenses and must not be added together." lines={d.lookThrough.sectors.filter(x=>x.key!=="us")}/><LookThroughReconciliation title="Countries" description="Mutually exclusive geographic buckets reconcile the classified portfolio." lines={d.lookThrough.geographies}/><LookThroughReconciliation title="Asset classes" description="Equity, managed futures, Bitcoin and unclassified holdings reconcile to NAV." lines={d.lookThrough.assets}/></div>
 {ytd&&<section className="rounded-xl border border-border bg-card overflow-hidden"><div className="px-5 py-4 border-b border-border"><h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Dividends &amp; costs — year to date</h2></div><div className="p-5 grid grid-cols-1 sm:grid-cols-3 gap-6"><div><p className="text-xs text-muted-foreground mb-1">Dividends received</p><p className="text-xl font-black tabular-nums text-success">{formatCurrency(ytd.dividends,"SGD")}</p></div><div><p className="text-xs text-muted-foreground mb-1">Fees &amp; charges</p><p className={`text-xl font-black tabular-nums ${ytd.fees<0?"text-danger":"text-foreground"}`}>{formatCurrency(ytd.fees,"SGD")}</p></div><div><p className="text-xs text-muted-foreground mb-1">Interest</p><p className={`text-xl font-black tabular-nums ${ytd.interest<0?"text-danger":"text-foreground"}`}>{formatCurrency(ytd.interest,"SGD")}</p></div></div><div className="px-5 pb-4"><p className="text-[11px] text-muted-foreground">From imported IBKR activity since 1 January. Figures update after each activity sync.</p></div></section>}
 {d.totalValue>0&&<DownloadReportCard endpoint="/api/reports/atlas" accent="violet" title="Download Atlas report" subtitle="Current holdings, mandate status and reconciled look-through summary."/>}
 </div></Shell>}
