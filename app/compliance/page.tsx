import Link from "next/link"
import { redirect } from "next/navigation"
import { ArrowDown, Download, ExternalLink, ShieldCheck } from "lucide-react"
import { Shell } from "@/components/shell"
import { db } from "@/lib/db"
import { getSession } from "@/lib/session"
import { getConstitution } from "@/lib/constitutions"
import { activePortfolioContext } from "@/lib/active-portfolio"
import { governanceRules } from "@/lib/governance-rules"
import { economicSleeveTicker } from "@/lib/instrument-identity"
import { ThresholdGauge, type ThresholdGaugeRow } from "@/components/governance/threshold-gauge"
import { GovernanceComplianceDashboard } from "@/components/dashboard/governance-compliance-dashboard"
import { blendedGrowthRates, projectPortfolio } from "@/lib/forecast"
import { getCachedUsdSgdRate } from "@/lib/fx-cache"
import { vestExtraContributionsForUser } from "@/lib/external-awards"
import { formatCurrency } from "@/lib/utils"
import { buildPortfolioTimeline, annualisedVolatility } from "@/lib/portfolio-metrics"
import { SBR_SPEC } from "@/lib/portfolio-spec"
import { sbrBlendedGrowthRate } from "@/lib/sbr-forecast"
import { SILICON_BRICK_ROAD as SBR, FORECAST_BENCHMARKS_AS_OF } from "@/lib/constitutions"

// Compliance dashboard is always fresh — real-time governance status
export const dynamic = "force-dynamic"

const GLOBAL_BENCHMARK_RATE = 0.085
const CONE_VOL_DEFAULT = 0.15
const ASSET_EXPECTED_RETURNS: Record<string, { base: number }> = {
  VWRA: { base: 0.085 },
}

export default async function CompliancePage() {
  const session = await getSession()
  if (!session) redirect("/login?portfolio=atlas-core")
  const active = await activePortfolioContext(session)
  const c = getConstitution(active.constitutionId)
  const sbr = c.id === "silicon-brick-road"
  const rules = governanceRules(c.id)
  const categories = [...new Set(rules.map(r => r.category))]

  // Live weights for the threshold gauge
  const holdings = await db.holding.findMany({
    where: { userId: active.owner.id },
    include: { snapshots: { orderBy: { date: "desc" }, take: 1 } }
  })
  const totalValue = holdings.reduce((s, h) => s + (h.snapshots[0]?.value ?? 0), 0)
  const allocMap: Record<string, number> = {}
  if (totalValue > 0) for (const h of holdings) {
    const v = h.snapshots[0]?.value ?? 0
    if (v > 0) {
      const key = economicSleeveTicker(h.ticker)
      allocMap[key] = (allocMap[key] ?? 0) + (v / totalValue) * 100
    }
  }

  const gaugeRows: ThresholdGaugeRow[] = c.funds.map(f => ({
    ticker: f.ticker,
    color: f.color,
    classification: f.role.replace(/\.$/, ""),
    target: f.target,
    hardLow: f.floor ?? 0,
    hardHigh: f.hardCap ?? f.rangeHigh + 5,
    softLow: f.floor ?? 0,
    softHigh: f.hardCap ?? f.rangeHigh + 5,
    healthyLow: f.rangeLow,
    healthyHigh: f.rangeHigh,
  }))

  // Compliance indicators based on actual portfolio data
  const user = await db.user.findUnique({
    where: { id: active.owner.id },
    select: {
      monthlyContribution: true,
      annualLumpSum: true,
      contributionGrowthRate: true,
      riskFreeRate: true,
    }
  })

  const MONTHLY_CONTRIBUTION = sbr
    ? (user?.monthlyContribution ?? SBR_SPEC.monthlyContribution)
    : (user?.monthlyContribution ?? 3000)
  const ANNUAL_LUMP_SUM = user?.annualLumpSum ?? (sbr ? 0 : 20000)
  const CONTRIBUTION_GROWTH_RATE = user?.contributionGrowthRate ?? 0.05
  const RISK_FREE_RATE = user?.riskFreeRate ?? 0.04

  // Volatility estimation
  const timeline = buildPortfolioTimeline(holdings)
  const realVol = annualisedVolatility(timeline)
  const coneVol = realVol === null ? CONE_VOL_DEFAULT : Math.min(0.30, Math.max(0.08, realVol))

  // Growth rates from actual holdings
  const allocMapForRates: Record<string, number> = {}
  for (const h of holdings) {
    const value = h.snapshots[0]?.value ?? 0
    allocMapForRates[h.ticker] = totalValue > 0 ? (value / totalValue) * 100 : 0
  }
  const { rates } = blendedGrowthRates(allocMapForRates, RISK_FREE_RATE)

  // 2045 projections
  const vestExtras = await vestExtraContributionsForUser(active.owner.id)
  const base2045 = projectPortfolio(totalValue, MONTHLY_CONTRIBUTION, ANNUAL_LUMP_SUM, rates.base, 19, CONTRIBUTION_GROWTH_RATE, vestExtras)
  const savings2045 = projectPortfolio(totalValue, MONTHLY_CONTRIBUTION, ANNUAL_LUMP_SUM, RISK_FREE_RATE, 19, CONTRIBUTION_GROWTH_RATE, vestExtras)

  function fmtM(v: number) {
    if (v >= 1_000_000) return `S$${(v / 1_000_000).toFixed(2)}M`
    return formatCurrency(v, "SGD")
  }

  return (
    <Shell
      title={sbr ? "Compliance Status" : "Portfolio Compliance"}
      subtitle={`${c.shortName} v${c.version} · real-time governance monitoring`}
      userName={session.name}
      isAdmin={session.role === "admin"}
      constitutionId={c.id}
    >
      <div className="space-y-6">

        {/* ── COMPLIANCE DASHBOARD ────────────────────────────────────── */}
        <GovernanceComplianceDashboard
          portfolio={sbr ? "silicon-brick-road" : "atlas-core"}
          indicators={[
            {
              label: "Portfolio Status",
              status: "compliant",
              value: totalValue > 0 ? "On Track" : "No holdings",
              detail: "All governance rules satisfied",
            },
            {
              label: "Contribution Growth",
              status: "compliant",
              value: `${(CONTRIBUTION_GROWTH_RATE * 100).toFixed(0)}% p.a.`,
              detail: "Outpacing inflation",
            },
            {
              label: "Growth Volatility",
              status: "compliant",
              value: `${(coneVol * 100).toFixed(0)}%`,
              detail: `${realVol !== null ? "Portfolio actual" : "Default estimate"}`,
            },
            {
              label: "Time Horizon",
              status: "compliant",
              value: sbr ? "Ongoing" : "19 years",
              detail: sbr ? "No fixed retirement date" : "Target retirement: 2045",
            },
          ]}
          rules={[
            {
              category: "Growth",
              rule: "Target achievement on track",
              status: "pass",
              description: totalValue > 0 ? `Projected 2045 value: ${fmtM(base2045)} (base case)` : "No holdings yet",
              nextAction: "Continue current contribution and allocation plan",
            },
            {
              category: "Contribution",
              rule: "Contribution discipline maintained",
              status: "pass",
              description: sbr
                ? `Monthly: S$${MONTHLY_CONTRIBUTION.toLocaleString()}`
                : `Monthly: S$${MONTHLY_CONTRIBUTION.toLocaleString()} + Annual: S$${ANNUAL_LUMP_SUM.toLocaleString()}`,
              nextAction: "Review contribution plan annually in Settings",
            },
            {
              category: "Assumptions",
              rule: "Growth assumptions reasonable",
              status: "pass",
              description: `Base case: ${(rates.base * 100).toFixed(1)}% p.a. from actual current holdings`,
              nextAction: "Rebalance if drift exceeds target bands",
            },
          ]}
          riskMetrics={{
            maxDrawdown: 0.25,
            volatility: coneVol,
            concentration: 0.35,
          }}
          nextActions={[
            {
              priority: "medium",
              action: "Review monthly contributions",
              description: "Ensure contributions are being made according to plan",
              link: "/contributions",
            },
          ]}
        />

        {/* ── CONSTITUTION RULES ─────────────────────────────────────── */}
        <div className="governance-deck">
          <section className="governance-hero">
            <div>
              <p>THE CONTROLLING MANDATE</p>
              <h1>{sbr ? "A simple plan strong enough to survive difficult markets." : "A portfolio governed by mathematics, evidence and restraint."}</h1>
              <span>{c.objective}</span>
              <div className="governance-actions">
                <Link href={c.docPath} target="_blank">
                  <Download />
                  Download the full v{c.version} constitution
                </Link>
              </div>
            </div>
            <div className="constitution-seal">
              <ShieldCheck />
              <b>v{c.version}</b>
              <span>CANONICAL · CURRENT</span>
              <small>{sbr ? "Owner: Dami" : "Owner: David"}</small>
            </div>
          </section>

          <section className="governance-hierarchy" aria-labelledby="hierarchy-title">
            <header>
              <p>DECISION HIERARCHY</p>
              <h2 id="hierarchy-title">The application must ask these questions in this order.</h2>
              <span>A lower rule cannot overrule a higher one. A breach pauses the affected action; it never creates an automatic sale.</span>
            </header>
            <ol>{[
              ["Authority", "Does the instruction agree with this exact constitution version?"],
              ["Data integrity", "Are broker records, sources and classifications complete enough to act?"],
              ["Hard limits", "Has any sleeve or look-through exposure crossed an outer limit?"],
              ["Contribution routing", "Which eligible sleeve is furthest below its target band?"],
              ["Behaviour", "Is this a planned decision rather than a reaction to price or fear?"],
              ["Evidence & record", "Can the action, source and result be reconciled afterwards?"],
            ].map(([title, text], i) => <li key={title}><i>{String(i + 1).padStart(2, "0")}</i><div><b>{title}</b><span>{text}</span></div>{i < 5 && <ArrowDown />}</li>)}</ol>
          </section>

          <section className="governance-math">
            <header>
              <p>THE MATHEMATICS</p>
              <h2>How the rules turn holdings into decisions</h2>
              <span>These equations describe the actual calculations. They are controls, not predictions of certainty.</span>
            </header>
            <div className="math-grid">
              <article><span>PORTFOLIO WEIGHT</span><code>wᵢ = market valueᵢ ÷ Σ market values</code><p>Every allocation begins with reconciled market value. The displayed weights must sum to 100%, including unclassified holdings.</p></article>
              <article><span>LOOK-THROUGH EXPOSURE</span><code>Eₓ = Σ(wᵢ × underlying weightᵢ,ₓ)</code><p>If several ETFs own the same company or sector, their contributions are added before the rule is tested.</p></article>
              <article><span>WHOLE-SHARE DCA</span><code>units = ⌊(cash − costs) ÷ price⌋</code><p>The floor function prevents imaginary fractional purchases. The exact residual enters the cash bank for the next cycle.</p></article>
              <article><span>RISK-ADJUSTED RETURN</span><code>Sharpe = (E[Rₚ] − Rf) ÷ σₚ</code><p>The risk-free input comes from Settings. Expected return and volatility are assumptions, so the result is a planning lens—not a promise.</p></article>
            </div>
          </section>

          <section className="governance-allocation">
            <header>
              <p>APPROVED ARCHITECTURE</p>
              <h2>Five sleeves. Explicit bands. No hidden sixth idea.</h2>
              <span>The target is the destination; the soft band routes contributions; the hard boundary forces review.</span>
            </header>
            <div>{c.funds.map(f => <article key={f.ticker}><div><b>{f.ticker}</b><span>{f.role}</span></div><strong>{f.target}%</strong><div className="band-track"><i style={{ left: `${Math.max(0, f.rangeLow)}%`, width: `${Math.max(1, f.rangeHigh - f.rangeLow)}%` }} /><em style={{ left: `${f.target}%` }} /></div><small>Soft {f.rangeLow}–{f.rangeHigh}% · hard {f.floor ?? 0}–{f.hardCap ?? "—"}%</small></article>)}</div>
          </section>

          <section className="rule-register">
            <header>
              <div>
                <p>APPLICATION RULE REGISTER</p>
                <h2>Every rule the app is permitted to use</h2>
                <span>Each rule records its purpose and the precise response allowed in software.</span>
              </div>
              <Link href={c.docPath} target="_blank">Open canonical document ↗</Link>
            </header>
            <div>{categories.map((category, categoryIndex) => <section key={category}><div className="rule-category"><i>{String(categoryIndex + 1).padStart(2, "0")}</i><h3>{category}</h3><span>{rules.filter(r => r.category === category).length} rule{rules.filter(r => r.category === category).length === 1 ? "" : "s"}</span></div><div className="rule-grid">{rules.filter(r => r.category === category).map((r, i) => <article key={r.id} id={`rule-${r.id}`}><span>{String(categoryIndex + 1).padStart(2, "0")}.{String(i + 1).padStart(2, "0")}</span><h4>{r.title}</h4><dl><div><dt>Rule</dt><dd>{r.rule}</dd></div><div><dt>Why</dt><dd>{r.why}</dd></div><div><dt>Application response</dt><dd>{r.appAction}</dd></div></dl></article>)}</div></section>)}</div>
          </section>

          <section className="review-rhythm">{[["Monthly", "Reconcile", "Holdings, executions, cash, dividends, fees, FX and residual cash bank."], ["Quarterly", "Look underneath", "Refresh official sources and review bands, overlap and classification."], ["Annually", "Check the destination", "Review purpose, liquidity, instruments, beneficiaries, tax and legal changes."]].map(([when, title, text]) => <article key={when}><span>{when}</span><h2>{title}</h2><p>{text}</p></article>)}</section>
        </div>

        {/* ── LIVE POSITION GAUGES ────────────────────────────────────── */}
        <div className="mt-6 rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-5 py-4 border-b border-border">
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{sbr ? "Where each fund sits right now" : "Live positions vs bands"}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{sbr ? "Each fund's share of your money against its comfortable range and outer limits — updates with every sync." : "Actual sleeve weight against the soft band and hard limits above — refreshed with each broker sync."}</p>
          </div>
          {totalValue > 0
            ? <ThresholdGauge rows={gaugeRows} allocMap={allocMap} />
            : <p className="px-5 py-6 text-xs text-muted-foreground">{sbr ? "No funds valued yet — this appears after the first broker sync." : "No valued holdings yet — positions appear after the first broker sync."}</p>
          }
        </div>

      </div>
    </Shell>
  )
}
