import Link from "next/link"
import { Shell } from "@/components/shell"
import { db } from "@/lib/db"
import { getExternalLiquidityVerified } from "@/lib/external-liquidity"
import { formatCurrency } from "@/lib/utils"
import { Activity, ChevronRight, TrendingUp } from "lucide-react"
import { getSbrMarketData } from "@/lib/sbr-market"
import { buildPortfolioTimeline } from "@/lib/portfolio-metrics"
import { SILICON_BRICK_ROAD as SBR } from "@/lib/constitutions"
import { computeSbrNextMove, computeSbrDca, computeSbrHealth, type SbrPosition } from "@/lib/sbr-engine"
import { sbrBlendedGrowthRate } from "@/lib/sbr-forecast"
import { evaluateSbrGovernance } from "@/lib/sbr-governance"
import { DownloadReportCard } from "@/components/reports/download-report-card"
import { HoldingsTable, type HoldingRow } from "@/components/dashboard/holdings-table"
import { getRecentExecutions } from "@/lib/execution-actions"
import type { GovAlignment } from "@/lib/governance-status"
import { GovernanceSeal, type SealDimension } from "@/components/cockpit/governance-seal"
import type { ComplianceBandPosition } from "@/components/cockpit/compliance-board"
import { PortfolioHistoryChart } from "@/components/charts/portfolio-history-chart"
import { AllocationDonut } from "@/components/charts/allocation-donut"
import { AnimatedNumber } from "@/components/animated-number"
import { getCachedUsdSgdRate } from "@/lib/fx-cache"
import { getDealingWindow, isInDealingWindow } from "@/lib/constitution"
import { CommitteeMinuteForm } from "@/components/sbr/committee-minute-form"
import { computeSbrLookThrough } from "@/lib/sbr-look-through"
import { refreshedLookThroughData } from "@/lib/look-through-data"
import { openPositionValuation } from "@/lib/valuation"
import { foldDuplicateHoldings } from "@/lib/holding-duplicates"
import { PortfolioUpdateButton } from "@/components/portfolio-update-button"
import { ensureSbrPresentation } from "@/lib/holdings-sync"

const SBR_FUND_TICKERS = SBR.funds.map(f => f.ticker)

function dimStatus(score: number): SealDimension["status"] {
  return score >= 90 ? "excellent" : score >= 75 ? "good" : score >= 55 ? "caution" : "critical"
}

// Annual SGD/USD reference rate used to detect currency drift (Art. VI FX policy).
// Refresh this value annually from MAS or your brokerage's reference data.
const FX_REFERENCE_USDSGD = 1.35
const FX_BAND_PCT = 5 // ±5% from reference triggers a note

async function getSbrData(userId: string) {
  // Self-heal the governed rows first (creates any fund added by amendment, e.g. A35,
  // at zero units with its constitutional target) so the first IBKR sync matches by
  // ticker instead of minting a zero-target holding. Idempotent, SBR-gated inside.
  await ensureSbrPresentation(userId)
  const [rawHoldings, market, recentExec, usdSgdRate, cashBank, recentMinute, owner, lookThroughSources] = await Promise.all([
    // Dami's owner ledger is SBR. Load every open instrument so an out-of-plan brokerage
    // holding remains visible and stays inside NAV/concentration denominators.
    db.holding.findMany({ where: { userId }, include: { snapshots: { orderBy: { date: "desc" }, take: 8 } } }),
    getSbrMarketData(),
    getRecentExecutions(userId, 1),
    getCachedUsdSgdRate(),
    db.dcaCashBank.findUnique({ where: { userId_constitutionId_currency: { userId, constitutionId: "silicon-brick-road", currency: "SGD" } } }),
    db.behaviourLog.findFirst({
      where: { userId, type: "committee-minute", date: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) } },
      orderBy: { date: "desc" },
    }),
    db.user.findUnique({ where: { id: userId }, select: { monthlyContribution: true } }),
    db.etfLookThrough.findMany({ where: { ticker: { in: SBR_FUND_TICKERS } }, select: { ticker: true, updatedAt: true } }),
  ])
  // Duplicate same-ticker rows fold into one row (units/value summed) — see lib/holding-duplicates.ts.
  const holdings = foldDuplicateHoldings(rawHoldings)
  const fundOrder = SBR.funds.map((f) => f.ticker)
  const orderOf=(ticker:string)=>{const i=fundOrder.indexOf(ticker);return i<0?Number.MAX_SAFE_INTEGER:i}
  const holdingsSorted = [...holdings].sort((a, b) => orderOf(a.ticker) - orderOf(b.ticker))
  const totalValue = holdings.reduce((s, h) => s + (h.snapshots[0]?.value ?? 0), 0)

  const priceMap = market.positions
  const positions: SbrPosition[] = holdingsSorted.filter(h=>SBR_FUND_TICKERS.includes(h.ticker)).map((h) => {
    const fund = SBR.funds.find((f) => f.ticker === h.ticker)
    const value = h.snapshots[0]?.value ?? 0
    const actualPct = totalValue > 0 ? (value / totalValue) * 100 : 0
    const live = priceMap[h.ticker]
    return {
      // Registry colour wins over the DB row so a palette rebrand applies without a reseed.
      ticker: h.ticker, name: h.name, color: fund?.color ?? h.color, value, actualPct,
      targetPct: h.targetPct, rangeLow: fund?.rangeLow ?? h.targetPct - h.toleranceBand,
      rangeHigh: fund?.rangeHigh ?? h.targetPct + h.toleranceBand, hardCap: h.hardCapPct,
      floor: fund?.floor, latestPrice: live?.price || h.snapshots[0]?.price || 0, hi52: live?.hi52 || 0,
    }
  })

  const timeline = buildPortfolioTimeline(holdings)
  let drawdownPct: number | undefined
  if (timeline.length >= 2) {
    const peak = Math.max(...timeline.map((t) => t.value))
    const current = timeline[timeline.length - 1].value
    if (peak > 0 && current < peak) drawdownPct = ((current - peak) / peak) * 100
  }
  const historyPoints = timeline.map(t => ({
    label: new Date(t.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
    value: t.value,
  }))
  const valueChange = timeline.length >= 2 ? timeline[timeline.length - 1].value - timeline[timeline.length - 2].value : null

  const nextMove = computeSbrNextMove(positions, totalValue, { drawdownPct })
  const monthlyContribution = owner?.monthlyContribution ?? SBR.monthlyContribution
  const dca = computeSbrDca(positions, monthlyContribution, { drawdownPct })
  const dcaByTicker = new Map(dca.allocations.map((a) => [a.ticker, a]))

  // Time to goal — blended from the ACTUAL current fund mix (not target weights), so a
  // drifted portfolio's projection reflects what's really held, same as everywhere else.
  const allocMap: Record<string, number> = {}
  for (const p of positions) allocMap[p.ticker] = p.actualPct
  const growthRates = sbrBlendedGrowthRate(allocMap)

  // Governance status — shared with the PDF report so both surfaces agree.
  const lookThroughAsOf=lookThroughSources.length===SBR_FUND_TICKERS.length?new Date(Math.min(...lookThroughSources.map(x=>x.updatedAt.getTime()))):new Date(0)
  const refreshedLt = await refreshedLookThroughData()
  const lookThrough = computeSbrLookThrough(positions,new Date(),lookThroughAsOf,refreshedLt.weights)
  const excludedPct=totalValue>0?Math.max(0,100-positions.reduce((s,p)=>s+p.actualPct,0)):0
  if(excludedPct>0.005){lookThrough.unclassifiedPct+=excludedPct;lookThrough.warnings.unshift(`${excludedPct.toFixed(1)}% of NAV is outside the target universe and is included as unclassified.`)}
  const govAlignment: GovAlignment = evaluateSbrGovernance(positions, totalValue, lookThroughAsOf,new Date(),lookThrough)

  // Holdings rows
  const statusOf = (p: SbrPosition): HoldingRow["status"] => {
    const hard = (p.hardCap !== null && p.actualPct > p.hardCap) || (p.floor !== undefined && p.actualPct < p.floor)
    const soft = !hard && (p.actualPct < p.rangeLow || p.actualPct > p.rangeHigh)
    return hard ? "hard" : soft ? "soft" : "healthy"
  }
  const holdingsRows: HoldingRow[] = holdingsSorted.filter(h=>SBR_FUND_TICKERS.includes(h.ticker)).map((h) => {
    const p = positions.find((x) => x.ticker === h.ticker)
    const cb = h.snapshots[0]
    const a = dcaByTicker.get(h.ticker)
    const valuation = openPositionValuation({
      value: cb?.value ?? 0,
      units: cb?.units ?? 0,
      snapshotCostBasis: cb?.costBasis,
      snapshotUnrealizedPnl: cb?.unrealizedPnl,
      reconstructedCostBasis: null,
      reconstructedAveragePrice: null,
      reportingFxRate: cb?.currency === "SGD" ? 1 : usdSgdRate,
    })
    return {
      ticker: h.ticker, name: h.name, color: p?.color ?? h.color, units: cb?.units ?? 0, value: cb?.value ?? 0,
      // Real trend data for the Trend sparkline — the 8 fetched snapshots, oldest first.
      latestPrice: cb?.price ?? 0, priceChangePct: null,
      priceHistory: [...h.snapshots].reverse().map((s) => s.price).filter((p) => p > 0),
      avgCostUsd: valuation.averagePriceInstrumentCurrency,
      unrealisedSgd: valuation.reconciles ? valuation.unrealizedPnl : null,
      unrealisedPct: valuation.reconciles ? valuation.unrealizedReturnPct : null,
      actualPct: totalValue>0?((cb?.value??0)/totalValue)*100:0, targetPct: p?.targetPct ?? 0, toleranceBand: p ? h.toleranceBand : 0,
      hardCapPct: p ? h.hardCapPct : 0, status: p ? statusOf(p) : "hard",
      thisMonth: a ? { amount: a.amount, tag: a.tag, reason: a.reason } : null,
    }
  })

  // Compliance Board bands
  const complianceBands: ComplianceBandPosition[] = positions.map((p) => ({
    ticker: p.ticker, name: p.name, color: p.color, value: p.value,
    actualPct: p.actualPct, targetPct: p.targetPct,
    softLow: p.rangeLow, softHigh: p.rangeHigh,
    hardHigh: p.hardCap ?? p.rangeHigh + 5,
    status: statusOf(p),
  }))

  // Donut data
  const donutData = holdingsSorted.filter(h=>SBR_FUND_TICKERS.includes(h.ticker)).map((h) => {
    const value = h.snapshots[0]?.value ?? 0
    const actualPct = totalValue > 0 ? (value / totalValue) * 100 : 0
    const fundColor = SBR.funds.find((f) => f.ticker === h.ticker)?.color ?? h.color
    return { ticker: h.ticker, name: h.name, actualPct, targetPct: h.targetPct, color: fundColor, value }
  })

  const latest = holdings.reduce<Date | null>((d, h) => { const s = h.snapshots[0]?.date; return s && (h.snapshots[0]?.value??0)>0 && (!d || s < d) ? s : d }, null)
  const snapshotAgeDays = latest ? Math.floor((Date.now() - new Date(latest).getTime()) / 86_400_000) : 999
  // Liquidity pillar: the owner's Settings confirmation that an emergency fund exists OUTSIDE
  // this portfolio — the portfolio itself must never score as emergency liquidity.
  const health = computeSbrHealth(positions, totalValue, snapshotAgeDays, SBR, await getExternalLiquidityVerified(userId))

  // FX strip — live rate vs annual reference
  const fxDeviation = ((usdSgdRate - FX_REFERENCE_USDSGD) / FX_REFERENCE_USDSGD) * 100
  const fxOutOfBand = Math.abs(fxDeviation) > FX_BAND_PCT

  // Dealing window — tells Dami when she needs to act and when she's done
  const now = new Date()
  const dealingWindow = getDealingWindow(now)
  const windowOpen = isInDealingWindow(now)
  const nextWindowOpens = windowOpen ? null : getDealingWindow(new Date(now.getFullYear(), now.getMonth() + 1, 1)).opens

  // Exceptional Market Event detection — portfolio down past the constitutional trigger from
  // peak. Sourced from SBR.drawdownTriggerPct (asserted against SBR_SPEC by check-spec.ts)
  // rather than a second hardcoded copy, so an amendment to the trigger can't silently
  // desync this banner + the 72h committee-minute gate from the constitution.
  const EME_THRESHOLD = -(SBR.drawdownTriggerPct ?? 30)
  const emeActive = drawdownPct !== undefined && drawdownPct <= EME_THRESHOLD
  const emeMinuteFiled = recentMinute !== null

  // Accrual carry-forward map (SGD banked toward next whole share/lot)
  const accrualMap: Record<string, number> = {}
  for (const h of holdings) accrualMap[h.ticker] = h.accrualBalanceSgd ?? 0

  return {
    totalValue, valueChange, nextMove, dca, holdingsRows, govAlignment, health,
    marketStale: market.stale, marketAsOf: market.asOf, lastDone: recentExec[0] ?? null,
    historyPoints, complianceBands, donutData, growthRates,
    usdSgdRate, fxDeviation, fxOutOfBand,
    dealingWindow, windowOpen, nextWindowOpens,
    emeActive, emeMinuteFiled, drawdownPct,
    accrualMap, cashBankBalance: cashBank?.balance ?? 0, lookThrough, monthlyContribution,
    // For the Update Values modal — lets the owner sync from her own IBKR account
    // (the sync routes pick the SBR Flex credentials from the active portfolio) or
    // seed the portfolio the first time: the confirm step creates missing holdings.
    updateHoldings: holdingsSorted.map((h) => ({
      id: h.id, ticker: h.ticker, name: h.name,
      latestUnits: h.snapshots[0]?.units ?? 0, latestPrice: h.snapshots[0]?.price ?? 0,
    })),
  }
}

export async function SbrDashboard({ userId, name, isAdmin }: { userId: string; name: string; isAdmin: boolean }) {
  const d = await getSbrData(userId)
  const hasBalance = d.totalValue > 0
  const positiveRows=d.holdingsRows.filter(row=>row.value>0)
  const valuationComplete=positiveRows.every(row=>row.unrealisedSgd!==null)
  const totalUnrealised=valuationComplete?positiveRows.reduce((sum,row)=>sum+(row.unrealisedSgd??0),0):null
  const totalCostBasis=valuationComplete?positiveRows.reduce((sum,row)=>sum+row.value-(row.unrealisedSgd??0),0):null
  const totalReturnPct=totalUnrealised!==null&&totalCostBasis!==null&&totalCostBasis>0?(totalUnrealised/totalCostBasis)*100:null

  // Convert SBR health dimensions to SealDimension format (weighted points). Weights mirror
  // computeSbrHealth's actual overall formula exactly (lib/sbr-engine.ts) — governance .25,
  // risk .20, allocation .15, contribution/freshness .20, behavioural .10, liquidity .10.
  // "documentation" is not a separately-weighted term (it's a duplicate of freshness), so it
  // isn't shown as its own dimension here.
  const sealDimensions: SealDimension[] = [
    { label: "Governance",   score: Math.round(d.health.governance    * 0.25), maxScore: 25, status: dimStatus(d.health.governance) },
    { label: "Risk",         score: Math.round(d.health.risk          * 0.20), maxScore: 20, status: dimStatus(d.health.risk) },
    { label: "Allocation",   score: Math.round(d.health.allocation    * 0.15), maxScore: 15, status: dimStatus(d.health.allocation) },
    { label: "Contribution", score: Math.round(d.health.contribution  * 0.20), maxScore: 20, status: dimStatus(d.health.contribution) },
    { label: "Behaviour",    score: Math.round(d.health.behavioural   * 0.10), maxScore: 10, status: dimStatus(d.health.behavioural) },
    { label: "Liquidity",    score: Math.round(d.health.liquidity     * 0.10), maxScore: 10, status: dimStatus(d.health.liquidity) },
  ]

  return (
    <Shell title="Your Plan" subtitle="Silicon Brick Road — flexible medium-term growth" userName={name} isAdmin={isAdmin}>
      <section className="atlas-flightdeck mb-5 overflow-hidden border" aria-labelledby="sbr-position-heading">
        <div className="atlas-flightdeck-head">
          <div>
            <p className="atlas-kicker">SILICON BRICK ROAD · LIVE PORTFOLIO POSITION</p>
            <h2 id="sbr-position-heading">Where we are now.</h2>
            <p>Value, performance, ownership and the next rule-permitted action in one view.</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="atlas-freshness" aria-label={d.marketStale ? "Market data needs refreshing" : "Market data is current"}>
              <span className={d.marketStale ? "warn" : "ok"} />
              {d.marketStale ? "IBKR snapshot · refresh due" : "IBKR snapshot · current"}
            </div>
            {/* Update path for SBR — sync from the SBR IBKR account, type values in, or
                upload a screenshot/PDF. First sync SEEDS the portfolio: the confirm step
                creates any holding that doesn't exist yet. */}
            <PortfolioUpdateButton label="Closing Refresh" defaultMode="ibkr" holdings={d.updateHoldings} />
          </div>
        </div>

        <div className="atlas-flightdeck-grid">
          <div className="atlas-value-bay">
            <p className="atlas-kicker">TOTAL PORTFOLIO VALUE</p>
            <strong className="atlas-total"><AnimatedNumber value={d.totalValue} currency="SGD" /></strong>
            <div className="atlas-value-stats">
              <div><span>Cost basis</span><b>{totalCostBasis!==null?formatCurrency(totalCostBasis,"SGD"):<Link href="/portfolio" className="underline decoration-dotted underline-offset-2">Needs reconciliation</Link>}</b></div>
              <div><span>Unrealised P&amp;L</span><b className={totalUnrealised!==null&&totalUnrealised<0?"down":"up"}>{totalUnrealised===null?"—":`${totalUnrealised>=0?"+":"−"}${formatCurrency(Math.abs(totalUnrealised),"SGD")}`}</b></div>
              <div><span>Unrealised return</span><b className={totalReturnPct!==null&&totalReturnPct<0?"down":"up"}>{totalReturnPct===null?<Link href="/portfolio" className="underline decoration-dotted underline-offset-2">Needs reconciliation</Link>:`${totalReturnPct>=0?"+":""}${totalReturnPct.toFixed(1)}%`}</b></div>
            </div>
            <div className="atlas-command-line">
              <span>CONSTITUTION SAYS</span>
              <b>{d.nextMove.action}</b>
              <p>{d.nextMove.what}</p>
            </div>
          </div>

          <div className="atlas-chart-bay">
            <div className="atlas-panel-title"><div><span>PERFORMANCE</span><b>Portfolio value history</b></div>{d.valueChange!==null&&<strong className={d.valueChange>=0?"up":"down"}>{d.valueChange>=0?"+":"−"}{formatCurrency(Math.abs(d.valueChange),"SGD")}</strong>}</div>
            {d.historyPoints.length>=2?<PortfolioHistoryChart data={d.historyPoints}/>:<div className="atlas-empty-chart"><Activity aria-hidden="true"/><span>Performance history will appear after two complete IBKR snapshots.</span></div>}
          </div>

          <Link href="/portfolio" className="atlas-orbit-bay" aria-label="Open SBR holdings and activity">
            <div className="atlas-panel-title"><div><span>POSITION</span><b>Actual versus target</b></div><em>Open portfolio →</em></div>
            <AllocationDonut data={d.donutData} totalValue={d.totalValue} currency="SGD"/>
          </Link>
        </div>

        <div className="atlas-flightdeck-foot">
          <div><span>Next contribution</span><b>{formatCurrency(d.monthlyContribution,"SGD")}</b></div>
          <div><span>DCA cash bank</span><b>{formatCurrency(d.cashBankBalance,"SGD")}</b></div>
          <div><span>Portfolio health</span><b>{d.health.overall}/100</b></div>
          <div><span>Horizon</span><b>Flexible · no end date</b></div>
        </div>
      </section>

      <section className="mb-5 grid gap-3 lg:grid-cols-3" aria-label="What to do, why, and where SBR is going">
        <article className="atlas-command-band"><div><span>WHAT TO DO</span><h2>{d.nextMove.action}</h2><p>{d.nextMove.what}</p></div><Link href="/portfolio">Review activity →</Link></article>
        <article className="atlas-command-band"><div><span>WHY</span><h2>{d.nextMove.why}</h2><p>{d.nextMove.when??"At the next permitted contribution window."}</p></div><Link href="/mission-control?portfolio=silicon-brick-road">Review & Adjust →</Link></article>
        <article className="atlas-command-band"><div><span>WHERE WE ARE GOING</span><h2>Flexible medium-term compounding</h2><p>VWRA 65 · EQAC 10 · SMH 5 · BTC 5 · DBMFE 10 · A35 5. A real SGD use must be documented before risk changes.</p></div><a href="/downloads/silicon-brick-road-constitution-v10.5.html" target="_blank" rel="noopener noreferrer">Read constitution ↗</a></article>
      </section>

      {/* Governance seal: ring score + per-dimension breakdown, click-through to full compliance page */}
      <div className="mb-5">
        <GovernanceSeal
          overall={d.health.overall}
          overallLabel={d.health.overallLabel}
          constitutionLabel="SILICON BRICK ROAD"
          dimensions={sealDimensions}
          href="/compliance"
          hrefLabel="View full status →"
        />
      </div>


      {/* Exceptional Market Event — EME detected (portfolio down ≥30% from peak) */}
      {hasBalance && d.emeActive && (
        <div className="mb-5 rounded-xl border border-red-500/40 bg-red-500/[0.06] px-5 py-4 space-y-3">
          <div>
            <p className="text-sm font-bold text-red-400">
              Exceptional Market Event — portfolio down {d.drawdownPct !== undefined ? Math.abs(d.drawdownPct).toFixed(0) : "30"}% from peak
            </p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              The EME circuit breaker is active. The monthly contribution still follows the Decision Engine.
              But no discretionary sell is permitted until a committee minute is filed (both parties must agree in writing).
            </p>
          </div>
          {d.emeMinuteFiled
            ? <p className="text-xs text-green-400 font-semibold">✓ Committee minute on file — circuit breaker satisfied for this period.</p>
            : <CommitteeMinuteForm defaultArticle="EME protocol — panic circuit breaker" />
          }
        </div>
      )}

      {/* Terminal state — shown when the dealing window is closed (Dami is done for this month) */}
      {hasBalance && !d.windowOpen && d.nextWindowOpens && (
        <div className="mb-5 rounded-xl border border-sky-500/30 bg-sky-500/[0.06] px-5 py-4">
          <p className="text-sm font-bold text-sky-400">
            You&apos;re done for {d.dealingWindow.contributionDay.toLocaleDateString("en-SG", { month: "long" })}.
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            The road doesn&apos;t need you until{" "}
            <span className="font-semibold text-foreground">
              {d.nextWindowOpens.toLocaleDateString("en-SG", { day: "numeric", month: "long" })}
            </span>
            . Your next buying window opens then — come back and run the Decision Engine.
          </p>
        </div>
      )}

      {/* Dealing window open — remind Dami to act before the window closes */}
      {hasBalance && d.windowOpen && (
        <div className="mb-5 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-5 py-4">
          <p className="text-sm font-bold text-amber-400">
            Buying window is open — act before{" "}
            {d.dealingWindow.closes.toLocaleDateString("en-SG", { day: "numeric", month: "long" })}.
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Follow &ldquo;This month&rdquo; below. Once you&apos;ve bought, you&apos;re done until next month.
          </p>
        </div>
      )}

      <div className="grid gap-5">
        <div className="space-y-5 min-w-0 reveal-stack">

          {/* Position ledger follows the command hierarchy without repeating the hero KPIs. */}
          {hasBalance && <HoldingsTable positions={d.holdingsRows} totalValue={d.totalValue} priceStale={d.marketStale} contributionCurrency="SGD" plainEnglish />}

          {isAdmin && !d.emeActive && <section className="atlas-command-band"><div><span>DECISION JOURNAL</span><h2>Record a governed exception</h2><p>Use this only after a rule has triggered a decision. The minute records the authority and audit trail.</p></div><CommitteeMinuteForm /></section>}

          {/* Portfolio-level look-through — actual holdings only, never target weights. */}
          <div className="rounded-2xl card-lux p-5">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div><p className="text-[10px] font-bold uppercase tracking-widest text-sky-400">Risk look-through</p><h3 className="text-base font-semibold mt-1">What SBR owns underneath</h3></div>
              <span className={`text-[10px] rounded-full border px-2.5 py-1 ${d.lookThrough.stale ? "border-red-500/40 text-red-400" : "border-green-500/40 text-green-400"}`}>{d.lookThrough.stale ? "STALE" : `${d.lookThrough.ageDays}D OLD`}</span>
            </div>
            {!hasBalance ? <p className="text-xs text-muted-foreground">No securities are held, so company, country and industry exposure is not applicable. Targets are not substituted for actual holdings.</p> : <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ["Largest company", `${d.lookThrough.topCompany.name} ${d.lookThrough.topCompany.pct.toFixed(1)}%`],
                  ["Largest country", `${d.lookThrough.topCountry.name} ${d.lookThrough.topCountry.pct.toFixed(1)}%`],
                  ["Largest industry", `${d.lookThrough.topIndustry.name} ${d.lookThrough.topIndustry.pct.toFixed(1)}%`],
                  ["Equity assets", `${(d.lookThrough.assets.find(x => x.name === "Equity")?.pct ?? 0).toFixed(1)}%`],
                ].map(([label, value]) => <div key={label} className="rounded-xl border border-border bg-muted/20 p-3"><p className="text-[10px] text-muted-foreground">{label}</p><p className="text-sm font-bold mt-1">{value}</p></div>)}
              </div>
              {d.lookThrough.warnings.length > 0 && <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-3"><p className="text-[10px] font-bold uppercase tracking-widest text-amber-400 mb-1">Review queue</p>{d.lookThrough.warnings.map(w => <p key={w} className="text-xs text-muted-foreground">• {w}</p>)}</div>}
            </>}
          </div>

          {/* 7. Flexible-horizon mode */}
          <div className="rounded-xl border border-sky-500/30 bg-sky-500/[0.04] p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-sky-400">Flexible growth mode — active</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">There is no automatic value phase or spending deadline. De-risk only after Dami records a real SGD use, amount and date. Stale look-through data blocks concentration-led trades until refreshed.</p>
              </div>
              <a href="/compliance" className="flex items-center gap-1 text-[11px] font-semibold text-sky-400 hover:text-sky-300 shrink-0">
                Read rules <ChevronRight className="h-3 w-3" />
              </a>
            </div>
          </div>

          {/* 8. Road Report — full analysis page */}
          <Link href="/reports" className="group flex items-center gap-3 rounded-2xl border border-border bg-card/75 backdrop-blur-md px-5 py-4 card-elevated hover:bg-accent/40 hover:border-sky-500/30 hover:-translate-y-0.5 transition-all">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/10 shrink-0">
              <TrendingUp className="h-4 w-4 text-sky-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold">Road Report</p>
              <p className="text-xs text-muted-foreground">Flexible-horizon scenarios · constitution checks · health scorecard</p>
            </div>
            <span className="text-xs font-semibold text-muted-foreground/60 group-hover:text-sky-500 transition-colors shrink-0">Open →</span>
          </Link>

          {/* 9. Download report */}
          {hasBalance && <DownloadReportCard endpoint="/api/reports/sbr" accent="sky" title="Download Your Plan Report" subtitle="A premium PDF — what's happening, what's changed, what's owned, and what to do next." />}

        </div>

        {/* Detailed allocation/history/FX instrumentation has moved out of the cockpit hierarchy. */}
        <div className="hidden" aria-hidden="true">
          {/* Allocation donut */}
          <Link href="/portfolio" className="group block rounded-2xl card-lux p-5 relative overflow-hidden">
            <div className="flex items-start justify-between gap-2 mb-1">
              <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Allocation</h3>
              <span className="text-[11px] font-semibold text-primary opacity-0 group-hover:opacity-100 transition-opacity shrink-0">View →</span>
            </div>
            <p className="text-[11px] text-muted-foreground mb-3">Outer = actual · Inner = target</p>
            <AllocationDonut data={d.donutData} totalValue={d.totalValue} currency="SGD" />
          </Link>

          {/* Value history */}
          {d.historyPoints.length >= 2 && (
            <div className="rounded-2xl card-lux p-4">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Value History</h3>
                {d.valueChange !== null && (
                  <span className={`text-[11px] font-bold tabular-nums ${d.valueChange >= 0 ? "text-green-500" : "text-red-500"}`}>
                    {d.valueChange >= 0 ? "+" : ""}{formatCurrency(d.valueChange, "SGD")}
                  </span>
                )}
              </div>
              <PortfolioHistoryChart data={d.historyPoints} />
            </div>
          )}

          {/* FX strip — SGD/USD vs annual reference rate */}
          <div className="rounded-2xl card-lux p-4">
            <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">SGD / USD Rate</h3>
            <div className="flex items-end justify-between mb-2">
              <div>
                <p className="text-xl font-black tabular-nums">{d.usdSgdRate.toFixed(4)}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">1 USD = {d.usdSgdRate.toFixed(4)} SGD</p>
              </div>
              <div className="text-right">
                <p className={`text-sm font-bold tabular-nums ${d.fxOutOfBand ? "text-amber-500" : "text-green-500"}`}>
                  {d.fxDeviation >= 0 ? "+" : ""}{d.fxDeviation.toFixed(1)}%
                </p>
                <p className="text-[10px] text-muted-foreground">vs {FX_REFERENCE_USDSGD} ref</p>
              </div>
            </div>
            {/* ±5% band bar */}
            <div className="relative h-1.5 rounded-full bg-muted overflow-visible mb-1">
              <div className="absolute inset-y-0 left-[calc(50%-1px)] w-0.5 bg-muted-foreground/30 rounded-full" />
              <div className={`absolute top-0 h-full rounded-full transition-all ${d.fxOutOfBand ? "bg-amber-500" : "bg-green-500"}`}
                style={{
                  left: d.fxDeviation < 0 ? `${Math.max(0, 50 + d.fxDeviation * 5)}%` : "50%",
                  width: `${Math.min(50, Math.abs(d.fxDeviation) * 5)}%`,
                }} />
            </div>
            <div className="flex justify-between text-[9px] text-muted-foreground/40">
              <span>−5%</span><span>ref {FX_REFERENCE_USDSGD}</span><span>+5%</span>
            </div>
            {d.fxOutOfBand && (
              <p className="mt-2 text-[10px] text-amber-500 leading-relaxed">
                Rate is outside the ±5% band. De-risk sale proceeds should still convert to SGD promptly per the FX policy — do not wait for a &quot;better rate&quot;.
              </p>
            )}
          </div>

          {/* Health score breakdown */}
          {hasBalance && (
            <div className="rounded-2xl card-lux p-5 space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Score breakdown</h3>
              {[
                { label: "Governance",    value: d.health.governance,    weight: "25%" },
                { label: "Risk",          value: d.health.risk,          weight: "20%" },
                { label: "Allocation",    value: d.health.allocation,    weight: "15%" },
                { label: "Contribution",  value: d.health.contribution,  weight: "15%" },
                { label: "Behaviour",     value: d.health.behavioural,   weight: "10%" },
                { label: "Liquidity",     value: d.health.liquidity,     weight: "10%" },
                { label: "Documentation", value: d.health.documentation, weight: "5%"  },
              ].map(({ label, value, weight }) => (
                <div key={label}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] text-muted-foreground">{label}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground/50">{weight}</span>
                      <span className={`text-[11px] font-bold tabular-nums ${value >= 80 ? "text-green-500" : value >= 60 ? "text-amber-500" : "text-red-500"}`}>{value}</span>
                    </div>
                  </div>
                  <div className="h-1 rounded-full bg-muted overflow-hidden">
                    <div className={`h-full rounded-full bar-fill transition-all ${value >= 80 ? "bg-green-500" : value >= 60 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${value}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Shell>
  )
}
