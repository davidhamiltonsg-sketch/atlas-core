import Link from "next/link"
import { redirect } from "next/navigation"
import { Shell } from "@/components/shell"
import { getSession } from "@/lib/session"
import { getConstitution } from "@/lib/constitutions"
import { activePortfolioContext } from "@/lib/active-portfolio"
import { governanceRules } from "@/lib/governance-rules"

export default async function GovernancePage(){
  const session=await getSession();if(!session)redirect("/login?portfolio=atlas-core")
  const active=await activePortfolioContext(session),c=getConstitution(active.constitutionId),sbr=c.id==="silicon-brick-road",rules=governanceRules(c.id)
  const categories=[...new Set(rules.map(r=>r.category))]
  return <Shell title="Constitution" subtitle={`${c.shortName} v${c.version} · the rules used by the app`} userName={session.name} isAdmin={session.role==="admin"}>
    <div className="space-y-6">
      <section className="atlas-flightdeck overflow-hidden"><div className="atlas-flightdeck-head"><div><p className="atlas-kicker">THE WRITTEN MANDATE</p><h2>{sbr?"Build patiently. Keep every decision understandable.":"Compound with discipline. Make calm decisions under pressure."}</h2><p>{c.objective}</p></div></div><div className="atlas-flightdeck-foot"><div><span>Owner</span><b>{sbr?"Dami":"David"}</b></div><div><span>Version</span><b>{c.version}</b></div><div><span>Approved sleeves</span><b>{c.funds.length}</b></div><div><span>Automatic selling</span><b>Never</b></div></div></section>
      <section className="atlas-command-band"><div><span>WHY THIS EXISTS</span><h2>Your future emotions do not get to rewrite today&apos;s plan.</h2><p>The rules were written while the portfolio could be considered calmly. They help when fear says “sell everything” or excitement says “buy more before it is too late.”</p></div><Link href={c.docPath} target="_blank">Read or download the full constitution →</Link></section>
      <section className="grid gap-3 md:grid-cols-5">{c.funds.map(f=><article key={f.ticker} className="deck-ledger p-5"><p className="ph-eyebrow">{f.ticker}</p><p className="mt-2 text-3xl font-bold tabular-nums">{f.target}%</p><p className="mt-2 font-semibold">{f.role}</p><p className="mt-2 text-muted-foreground">Soft {f.rangeLow}–{f.rangeHigh}% · hard {f.floor??0}–{f.hardCap??"—"}%</p></article>)}</section>
      <section className="deck-ledger"><div className="deck-ledger-head"><div><span>APPLICATION RULEBOOK</span><h2>Every rule the app uses</h2><p>Each row says what the rule is, why it exists and exactly what the application may do.</p></div><Link href={`/mission-control?portfolio=${c.id}`}>Open Mission Control →</Link></div><div className="p-5 md:p-7 space-y-8">{categories.map(category=><section key={category}><h3 className="ph-eyebrow mb-3">{category}</h3><div className="grid gap-3 lg:grid-cols-2">{rules.filter(r=>r.category===category).map((r,i)=><article key={r.id} id={`rule-${r.id}`} className="border border-border p-5"><div className="flex gap-3"><span className="font-data text-primary">{String(i+1).padStart(2,"0")}</span><div><h4 className="font-bold">{r.title}</h4><p className="mt-2"><b>Rule:</b> {r.rule}</p><p className="mt-2 text-muted-foreground"><b>Why:</b> {r.why}</p><p className="mt-2 text-muted-foreground"><b>What the app does:</b> {r.appAction}</p></div></div></article>)}</div></section>)}</div></section>
      <section className="grid gap-4 md:grid-cols-3"><article className="atlas-command-band"><div><span>MONTHLY</span><h2>Reconcile</h2><p>Confirm holdings, executions, cash, dividends, fees, FX and the cash-bank residual.</p></div></article><article className="atlas-command-band"><div><span>QUARTERLY</span><h2>Look underneath</h2><p>Refresh official fund sources and review bands, overlap and data quality.</p></div></article><article className="atlas-command-band"><div><span>ANNUALLY</span><h2>Check the destination</h2><p>Review purpose, liquidity, instruments, beneficiaries and any legal or tax change.</p></div></article></section>
    </div>
  </Shell>
}
