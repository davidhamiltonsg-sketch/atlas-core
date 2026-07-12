import Link from "next/link"
import { redirect } from "next/navigation"
import { ArrowDown, Download, ExternalLink, ShieldCheck } from "lucide-react"
import { Shell } from "@/components/shell"
import { getSession } from "@/lib/session"
import { getConstitution } from "@/lib/constitutions"
import { activePortfolioContext } from "@/lib/active-portfolio"
import { governanceRules } from "@/lib/governance-rules"

export default async function GovernancePage(){
  const session=await getSession();if(!session)redirect("/login?portfolio=atlas-core")
  const active=await activePortfolioContext(session),c=getConstitution(active.constitutionId),sbr=c.id==="silicon-brick-road",rules=governanceRules(c.id)
  const categories=[...new Set(rules.map(r=>r.category))]
  return <Shell title={sbr?"Your Constitution":"Constitution & Rules"} subtitle={`${c.shortName} v${c.version} · the controlling mandate`} userName={session.name} isAdmin={session.role==="admin"} constitutionId={c.id}>
    <div className="governance-deck">
      <section className="governance-hero">
        <div><p>THE CONTROLLING MANDATE</p><h1>{sbr?"A simple plan strong enough to survive difficult markets.":"A portfolio governed by mathematics, evidence and restraint."}</h1><span>{c.objective}</span><div className="governance-actions"><Link href={c.docPath} target="_blank"><Download/>Download the full v{c.version} constitution</Link><Link href={`/mission-control?portfolio=${c.id}`}><ExternalLink/>Open Mission Control</Link></div></div>
        <div className="constitution-seal"><ShieldCheck/><b>v{c.version}</b><span>CANONICAL · CURRENT</span><small>{sbr?"Owner: Dami":"Owner: David"}</small></div>
      </section>

      <section className="governance-hierarchy" aria-labelledby="hierarchy-title">
        <header><p>DECISION HIERARCHY</p><h2 id="hierarchy-title">The application must ask these questions in this order.</h2><span>A lower rule cannot overrule a higher one. A breach pauses the affected action; it never creates an automatic sale.</span></header>
        <ol>{[
          ["Authority","Does the instruction agree with this exact constitution version?"],
          ["Data integrity","Are broker records, sources and classifications complete enough to act?"],
          ["Hard limits","Has any sleeve or look-through exposure crossed an outer limit?"],
          ["Contribution routing","Which eligible sleeve is furthest below its target band?"],
          ["Behaviour","Is this a planned decision rather than a reaction to price or fear?"],
          ["Evidence & record","Can the action, source and result be reconciled afterwards?"],
        ].map(([title,text],i)=><li key={title}><i>{String(i+1).padStart(2,"0")}</i><div><b>{title}</b><span>{text}</span></div>{i<5&&<ArrowDown/>}</li>)}</ol>
      </section>

      <section className="governance-math">
        <header><p>THE MATHEMATICS</p><h2>How the rules turn holdings into decisions</h2><span>These equations describe the actual calculations. They are controls, not predictions of certainty.</span></header>
        <div className="math-grid">
          <article><span>PORTFOLIO WEIGHT</span><code>wᵢ = market valueᵢ ÷ Σ market values</code><p>Every allocation begins with reconciled market value. The displayed weights must sum to 100%, including unclassified holdings.</p></article>
          <article><span>LOOK-THROUGH EXPOSURE</span><code>Eₓ = Σ(wᵢ × underlying weightᵢ,ₓ)</code><p>If several ETFs own the same company or sector, their contributions are added before the rule is tested.</p></article>
          <article><span>WHOLE-SHARE DCA</span><code>units = ⌊(cash − costs) ÷ price⌋</code><p>The floor function prevents imaginary fractional purchases. The exact residual enters the cash bank for the next cycle.</p></article>
          <article><span>RISK-ADJUSTED RETURN</span><code>Sharpe = (E[Rₚ] − Rf) ÷ σₚ</code><p>The risk-free input comes from Settings. Expected return and volatility are assumptions, so the result is a planning lens—not a promise.</p></article>
        </div>
      </section>

      <section className="governance-allocation">
        <header><p>APPROVED ARCHITECTURE</p><h2>Five sleeves. Explicit bands. No hidden sixth idea.</h2><span>The target is the destination; the soft band routes contributions; the hard boundary forces review.</span></header>
        <div>{c.funds.map(f=><article key={f.ticker}><div><b>{f.ticker}</b><span>{f.role}</span></div><strong>{f.target}%</strong><div className="band-track"><i style={{left:`${Math.max(0,f.rangeLow)}%`,width:`${Math.max(1,f.rangeHigh-f.rangeLow)}%`}}/><em style={{left:`${f.target}%`}}/></div><small>Soft {f.rangeLow}–{f.rangeHigh}% · hard {f.floor??0}–{f.hardCap??"—"}%</small></article>)}</div>
      </section>

      <section className="rule-register">
        <header><div><p>APPLICATION RULE REGISTER</p><h2>Every rule the app is permitted to use</h2><span>Each rule records its purpose and the precise response allowed in software.</span></div><Link href={c.docPath} target="_blank">Open canonical document ↗</Link></header>
        <div>{categories.map((category,categoryIndex)=><section key={category}><div className="rule-category"><i>{String(categoryIndex+1).padStart(2,"0")}</i><h3>{category}</h3><span>{rules.filter(r=>r.category===category).length} rule{rules.filter(r=>r.category===category).length===1?"":"s"}</span></div><div className="rule-grid">{rules.filter(r=>r.category===category).map((r,i)=><article key={r.id} id={`rule-${r.id}`}><span>{String(categoryIndex+1).padStart(2,"0")}.{String(i+1).padStart(2,"0")}</span><h4>{r.title}</h4><dl><div><dt>Rule</dt><dd>{r.rule}</dd></div><div><dt>Why</dt><dd>{r.why}</dd></div><div><dt>Application response</dt><dd>{r.appAction}</dd></div></dl></article>)}</div></section>)}</div>
      </section>

      <section className="review-rhythm">{[["Monthly","Reconcile","Holdings, executions, cash, dividends, fees, FX and residual cash bank."],["Quarterly","Look underneath","Refresh official sources and review bands, overlap and classification."],["Annually","Check the destination","Review purpose, liquidity, instruments, beneficiaries, tax and legal changes."]].map(([when,title,text])=><article key={when}><span>{when}</span><h2>{title}</h2><p>{text}</p></article>)}</section>
    </div>
  </Shell>
}
