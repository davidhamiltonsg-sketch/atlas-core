import Link from "next/link"
import { redirect } from "next/navigation"
import { ArrowDown, Download, ShieldCheck } from "lucide-react"
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
import { vestExtraContributionsForUser } from "@/lib/external-awards"
import { formatCurrency } from "@/lib/utils"
import { buildPortfolioTimeline, annualisedVolatility, maxDrawdown } from "@/lib/portfolio-metrics"
import { SBR_SPEC } from "@/lib/portfolio-spec"
import { applyEconomicSleeves } from "@/lib/next-best-move"
import { computeLookThrough } from "@/lib/look-through"
import { refreshedLookThroughData } from "@/lib/look-through-data"
import { evaluateGovernance, type Align } from "@/lib/governance-status"
import { computeSbrLookThrough } from "@/lib/sbr-look-through"
import { evaluateSbrGovernance } from "@/lib/sbr-governance"
import type { SbrPosition } from "@/lib/sbr-engine"
import { recordConstitutionVersionIfNew, detectUnversionedDrift, getConstitutionVersionHistory } from "@/lib/constitution-version"

const CONE_DRAWDOWN_DEFAULT = 0.20
const alignToIndicator: Record<Align, "compliant" | "caution" | "critical"> = { ok: "compliant", watch: "caution", breach: "critical" }

// Compliance dashboard is always fresh — real-time governance status
export const dynamic = "force-dynamic"

const CONE_VOL_DEFAULT = 0.15

export default async function CompliancePage() {
  const session = await getSession()
  if (!session) redirect("/login?portfolio=atlas-core")
  const active = await activePortfolioContext(session)
  const c = getConstitution(active.constitutionId)
  const sbr = c.id === "silicon-brick-road"
  const rules = governanceRules(c.id)
  const categories = [...new Set(rules.map(r => r.category))]

  // Article VI requires "a version increment" for any material change — record this version
  // as a durable, queryable fact the first time this page runs with it, and surface the one
  // integrity failure the record exists to catch: the same version number now governing
  // different content than what was first recorded (a rule changed without the increment).
  await recordConstitutionVersionIfNew(c.id)
  const [versionDrift, versionHistory] = await Promise.all([
    detectUnversionedDrift(c.id),
    getConstitutionVersionHistory(c.id),
  ])

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
  const drawdown = maxDrawdown(timeline)

  // Real governance alignment — was previously hardcoded to "compliant"/"pass" everywhere on
  // this page regardless of actual drift/look-through state, so the top banner could read
  // "✓ Compliant · All rules satisfied" during a real hard breach. Mirrors the same
  // evaluateGovernance/evaluateSbrGovernance call the dashboard and mission-control use.
  let govAlignment: { checks: { id: string; label: string; status: Align; detail: string }[]; breaches: number; watches: number; overall: Align }
  let concentrationPct = 0
  if (sbr) {
    const sbrPositions: SbrPosition[] = c.funds.map(f => {
      const h = holdings.find(x => x.ticker === f.ticker)
      const value = h?.snapshots[0]?.value ?? 0
      return {
        ticker: f.ticker, name: h?.name ?? f.ticker, color: f.color, value,
        actualPct: totalValue > 0 ? (value / totalValue) * 100 : 0,
        targetPct: f.target, rangeLow: f.rangeLow, rangeHigh: f.rangeHigh,
        hardCap: f.hardCap, floor: f.floor, latestPrice: h?.snapshots[0]?.price ?? 0, hi52: 0,
      }
    })
    const sbrLt = computeSbrLookThrough(sbrPositions, new Date())
    govAlignment = evaluateSbrGovernance(sbrPositions, totalValue, undefined, new Date(), sbrLt)
    concentrationPct = Math.max(sbrLt.topCompany.pct, sbrLt.topCountry.pct) / 100
  } else {
    const positions = applyEconomicSleeves(holdings.map(h => {
      const value = h.snapshots[0]?.value ?? 0
      return {
        ticker: h.ticker, actualPct: totalValue > 0 ? (value / totalValue) * 100 : 0,
        targetPct: h.targetPct, toleranceBand: h.toleranceBand ?? 2.5,
      }
    }))
    const refreshedLt = await refreshedLookThroughData()
    const lookThrough = computeLookThrough(positions, new Date(), refreshedLt.updatedAt, refreshedLt.weights)
    govAlignment = evaluateGovernance({ positions, bufferPct: 0, lookThrough })
    concentrationPct = Math.max(lookThrough.companies[0]?.pct ?? 0, lookThrough.sectors[0]?.pct ?? 0) / 100
  }
  const overallAlign = govAlignment.overall
  const govDetail = govAlignment.breaches
    ? `${govAlignment.breaches} check${govAlignment.breaches !== 1 ? "s" : ""} outside a hard limit — see checks below`
    : govAlignment.watches
    ? `${govAlignment.watches} check${govAlignment.watches !== 1 ? "s" : ""} approaching a soft band`
    : "All governance rules satisfied"

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

        {versionDrift && (
          <div className="rounded-xl border border-danger/40 bg-danger/10 px-5 py-4 text-xs text-danger">
            <b className="block text-sm mb-1">Constitution integrity check failed</b>
            Version v{c.version} first recorded on {versionDrift.recordedAt.toISOString().slice(0, 10)} with different governing content than what is now live under the same version number. Article VI requires a version increment for any material change — resolve by either reverting the unintended edit or bumping the version.
          </div>
        )}

        {/* ── COMPLIANCE DASHBOARD ────────────────────────────────────── */}
        <GovernanceComplianceDashboard
          portfolio={sbr ? "silicon-brick-road" : "atlas-core"}
          indicators={[
            {
              label: "Portfolio Status",
              status: alignToIndicator[overallAlign],
              value: totalValue > 0 ? "On Track" : "No holdings",
              detail: totalValue > 0 ? govDetail : "No holdings yet",
            },
            {
              label: "Contribution Growth",
              status: CONTRIBUTION_GROWTH_RATE > 0 ? "compliant" : "caution",
              value: `${(CONTRIBUTION_GROWTH_RATE * 100).toFixed(0)}% p.a.`,
              detail: CONTRIBUTION_GROWTH_RATE > 0 ? "Contribution amount grows each year" : "Contribution amount is flat — review in Settings",
            },
            {
              label: "Growth Volatility",
              status: realVol !== null ? "compliant" : "caution",
              value: `${(coneVol * 100).toFixed(0)}%`,
              detail: `${realVol !== null ? "Portfolio actual" : "Default estimate — not enough snapshot history yet"}`,
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
              status: totalValue > 0 ? "pass" : "warning",
              description: totalValue > 0 ? `Projected 2045 value: ${fmtM(base2045)} (base case)` : "No holdings yet",
              nextAction: "Continue current contribution and allocation plan",
            },
            {
              category: "Contribution",
              rule: "Contribution discipline maintained",
              status: MONTHLY_CONTRIBUTION > 0 ? "pass" : "warning",
              description: sbr
                ? `Monthly: S$${MONTHLY_CONTRIBUTION.toLocaleString()}`
                : `Monthly: S$${MONTHLY_CONTRIBUTION.toLocaleString()} + Annual: S$${ANNUAL_LUMP_SUM.toLocaleString()}`,
              nextAction: "Review contribution plan annually in Settings",
            },
            {
              category: "Assumptions",
              rule: "Growth assumptions reasonable",
              status: rates.base > 0.12 ? "warning" : "pass",
              description: `Base case: ${(rates.base * 100).toFixed(1)}% p.a. from actual current holdings`,
              nextAction: "Rebalance if drift exceeds target bands",
            },
          ]}
          riskMetrics={{
            maxDrawdown: drawdown ?? CONE_DRAWDOWN_DEFAULT,
            volatility: coneVol,
            concentration: concentrationPct,
          }}
          nextActions={[
            {
              priority: "medium",
              action: "Review monthly contributions",
              trigger: "Ensure contributions are being made according to plan",
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

          <section className="rule-register">
            <header>
              <div>
                <p>AMENDMENT HISTORY</p>
                <h2>Every version this constitution has run under</h2>
                <span>Recorded automatically the first time the app runs with a given version — a durable answer to Article VI&apos;s &quot;version increment&quot; requirement.</span>
              </div>
            </header>
            <div className="rule-grid">
              {versionHistory.length === 0
                ? <p className="text-xs text-muted-foreground">No version recorded yet — this appears after the page&apos;s first load.</p>
                : versionHistory.map((v) => (
                  <article key={v.id}>
                    <span>v{v.version}</span>
                    <h4>{v.updated}</h4>
                    <dl><div><dt>First recorded</dt><dd>{v.recordedAt.toISOString().slice(0, 10)}</dd></div></dl>
                  </article>
                ))}
            </div>
          </section>
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
