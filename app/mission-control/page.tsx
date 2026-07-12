import type { Metadata } from "next"
import { getSession } from "@/lib/session"
import { constitutionForEmail } from "@/lib/constitutions"
import { db } from "@/lib/db"
import { MissionControl, type PortfolioContext, type AgentFinding } from "@/components/mission-control/mission-control"
import { computePortfolioHealth } from "@/lib/health"
import { computeLadder } from "@/lib/ladder"
import { BITCOIN_SLEEVE_TARGET_PCT, applyBitcoinSleeve } from "@/lib/next-best-move"
import { evaluateGovernance } from "@/lib/governance-status"
import { computeLookThrough, worstLookThroughBreach, worstLookThroughApproach, largestContributor } from "@/lib/look-through"
import { refreshedLookThroughData } from "@/lib/look-through-data"
import { blendedGrowthRates, projectPortfolio } from "@/lib/forecast"
import { sbrBlendedGrowthRate } from "@/lib/sbr-forecast"
import { SBR_SPEC } from "@/lib/portfolio-spec"
import { buildPortfolioTimeline, annualisedVolatility } from "@/lib/portfolio-metrics"
import { getCombinedTechCeiling } from "@/lib/cycle"
import { HARD_THRESHOLDS } from "@/lib/constants"
import { getLiveMarketPositions } from "@/lib/finnhub"
import { activePortfolioContext } from "@/lib/active-portfolio"
import { redirect } from "next/navigation"
import { Shell } from "@/components/shell"

// Mission Control is a personal, auth-gated console — never statically cached.
export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Mission Control · Atlas",
  description: "Live agent dispatch console for the Atlas governance engines.",
}

// Representative context shown when logged out (or with no snapshots yet) so the
// console still reads as a real command centre. Clearly flagged SAMPLE in the UI.
const SAMPLE_CONTEXT: PortfolioContext = {
  label: "Atlas Core",
  totalValue: 284_500,
  currency: "USD",
  dayChangePct: 0.42,
  cashPct: 3.1,
  driftAlerts: 1,
  live: false,
  variant: "atlas",
  holdings: [
    { ticker: "VWRA", name: "Global equity core", pct: 70, color: "#4A9EFF" },
    { ticker: "EQAC", name: "Nasdaq-100 tilt", pct: 10, color: "#C9A84C" },
    { ticker: "SMH", name: "UCITS semiconductor tilt", pct: 5, color: "#8B7FE8" },
    { ticker: "BTC", name: "Bitcoin sleeve", pct: 5, color: "#E0913A" },
    { ticker: "DBMFE", name: "Managed futures", pct: 10, color: "#2ECC9A" },
  ],
}

// Silicon Brick Road sample — its four funds, plain-English names, SGD.
const SBR_SAMPLE_CONTEXT: PortfolioContext = {
  label: "Silicon Brick Road",
  totalValue: 0,
  currency: "SGD",
  dayChangePct: 0.31,
  cashPct: null,
  driftAlerts: 0,
  live: false,
  variant: "sbr",
  holdings: [],
}

async function loadPortfolioContext(active?: { constitutionId: "atlas-core" | "silicon-brick-road"; userId: string }): Promise<PortfolioContext> {
  const session = await getSession()
  if (!session) throw new Error("Unauthenticated")

  const constitution = active
    ? (active.constitutionId === "silicon-brick-road" ? constitutionForEmail("dutszm@gmail.com") : constitutionForEmail(null))
    : constitutionForEmail(session.email)
  const isSbr = constitution.id === "silicon-brick-road"
  const label = isSbr ? "Silicon Brick Road" : "Atlas Core"
  const empty:PortfolioContext={label,totalValue:0,currency:constitution.currency,dayChangePct:null,cashPct:null,driftAlerts:0,live:false,variant:isSbr?"sbr":"atlas",holdings:[]}

  try {

    const holdings = await db.holding.findMany({
      where: { userId: active?.userId ?? session.userId },
      include: { snapshots: { orderBy: { date: "desc" }, take: 2 } },
    })

    const rows = holdings
      .map(h => ({
        ticker: h.ticker,
        name: h.name,
        color: h.color || "#5A6B8C",
        targetPct: h.targetPct,
        toleranceBand: h.toleranceBand,
        value: h.snapshots[0]?.value ?? 0,
        prevValue: h.snapshots[1]?.value ?? h.snapshots[0]?.value ?? 0,
      }))
      .filter(r => r.value > 0)

    const total = rows.reduce((s, r) => s + r.value, 0)
    if (total <= 0) return empty

    const prevTotal = rows.reduce((s, r) => s + r.prevValue, 0)
    const dayChangePct = prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : null

    const withPct = rows.map(r => ({ ...r, pct: (r.value / total) * 100 }))
    const driftAlerts = withPct.filter(r => r.targetPct > 0 && Math.abs(r.pct - r.targetPct) > r.toleranceBand).length
    const cashPct = withPct.filter(r => ["SGOV", "CASH", "SGD"].includes(r.ticker.toUpperCase())).reduce((s, r) => s + r.pct, 0)

    const holdingsOut = withPct
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 8)
      .map(r => ({ ticker: r.ticker, name: r.name, pct: r.pct, color: r.color }))

    return {
      label,
      totalValue: total,
      currency: constitution.currency,
      dayChangePct,
      cashPct: cashPct > 0 ? cashPct : null,
      driftAlerts,
      live: true,
      holdings: holdingsOut,
      variant: isSbr ? "sbr" : "atlas",
    }
  } catch {
    return empty
  }
}

// ── Real agent findings ────────────────────────────────────────────────────
// Both Atlas and SBR engines run against the live database and produce
// timestamped log messages + a final result that the client animates verbatim.
// When the server can't produce findings (logged out, error), the client
// falls back to the scripted traces.

type Level = "info" | "data" | "ok" | "warn" | "err"

function spacedTimings(count: number): number[] {
  return Array.from({ length: count }, (_, i) => 120 + i * 520)
}

function resultT(steps: number[]): number {
  return (steps[steps.length - 1] ?? 120) + 500
}

async function loadAgentFindings(userId: string): Promise<Record<string, AgentFinding> | null> {
  try {
    const [user, holdings, trades, activeRules, totalRules] = await Promise.all([
      db.user.findUnique({ where: { id: userId } }),
      db.holding.findMany({
        where: { userId },
        include: { snapshots: { orderBy: { date: "desc" }, take: 20 } },
      }),
      db.trade.findMany({ where: { userId }, orderBy: { date: "asc" } }),
      db.governanceRule.count({ where: { active: true } }),
      db.governanceRule.count(),
    ])

    if (holdings.length === 0) return null

    const totalValue = holdings.reduce((s, h) => s + (h.snapshots[0]?.value ?? 0), 0)
    if (totalValue <= 0) return null

    // Build position inputs (same pattern as the dashboard)
    let positions = holdings
      .map(h => {
        const value = h.snapshots[0]?.value ?? 0
        const actualPct = (value / totalValue) * 100
        return {
          ticker: h.ticker,
          name: h.name,
          color: h.color || "#5A6B8C",
          value,
          actualPct,
          targetPct: h.targetPct,
          hardCapPct: h.hardCapPct ?? null,
          toleranceBand: h.toleranceBand ?? 2.5,
          latestPrice: h.snapshots[0]?.price ?? 0,
        }
      })
      .filter(p => p.value > 0)

    positions = applyBitcoinSleeve(positions)

    // Run engines
    const refreshedLt = await refreshedLookThroughData()
    const lookThrough = computeLookThrough(positions,new Date(),refreshedLt.updatedAt,refreshedLt.weights)
    const companyBreaches = lookThrough.companies.filter(c => c.status === "breach").length
    const sectorBreaches = lookThrough.sectors.filter(s => s.status === "breach").length
    const ltBreach = worstLookThroughBreach(lookThrough)
    const ltApproach = worstLookThroughApproach(lookThrough)

    const sgovPct = positions.filter(p => ["SGOV", "CASH", "SGD", "AGG"].includes(p.ticker.toUpperCase())).reduce((s, p) => s + p.actualPct, 0)
    const govAlignment = evaluateGovernance({ positions, bufferPct: sgovPct, lookThrough })

    const hardBreaches = positions.filter(p => {
      const ht = HARD_THRESHOLDS[p.ticker]
      const overCap = p.hardCapPct !== null && p.actualPct > p.hardCapPct
      return overCap ||
        (ht?.low !== undefined && p.actualPct < ht.low) ||
        (ht !== undefined && p.actualPct > ht.high)
    }).length

    const softBreaches = positions.filter(p => {
      const ht = HARD_THRESHOLDS[p.ticker]
      const overCap = p.hardCapPct !== null && p.actualPct > p.hardCapPct
      const isHard = overCap ||
        (ht?.low !== undefined && p.actualPct < ht.low) ||
        (ht !== undefined && p.actualPct > ht.high)
      return !isHard && p.targetPct > 0 && Math.abs(p.actualPct - p.targetPct) > p.toleranceBand
    }).length

    const maxDrift = positions.reduce((max, p) => Math.max(max, Math.abs(p.actualPct - p.targetPct)), 0)
    const latestSnapshotDate = holdings.reduce<Date | null>((latest, h) => {
      const d = h.snapshots[0]?.date
      return d && (!latest || d > latest) ? d : latest
    }, null)
    const snapshotAgeDays = latestSnapshotDate
      ? Math.floor((Date.now() - new Date(latestSnapshotDate).getTime()) / 86_400_000)
      : 999

    const health = computePortfolioHealth({
      hardBreaches, softBreaches, maxDrift,
      companyHardBreaches: companyBreaches,
      sectorHardBreaches: sectorBreaches,
      activeRules, totalRules, snapshotAgeDays,
    })

    // Decision ladder
    const moveInputs = positions.map(p => ({
      ticker: p.ticker, name: p.name, color: p.color, value: p.value,
      actualPct: p.actualPct, targetPct: p.targetPct,
      hardCapPct: p.hardCapPct, toleranceBand: p.toleranceBand,
      latestPrice: p.latestPrice,
    }))

    let marketPositions: Record<string, { price: number; lo52: number; hi52: number }> = {}
    try {
      const ms = await getLiveMarketPositions()
      marketPositions = ms.positions
    } catch { /* market data is a nice-to-have — ladder works without it */ }

    const lookThroughBreach = ltBreach
      ? {
          label: ltBreach.label, pct: ltBreach.pct, hard: ltBreach.hard,
          trimTicker: largestContributor(
            ltBreach.key,
            lookThrough.companies.some(c => c.key === ltBreach.key) ? "company" : "sector",
            positions,
          ),
        }
      : undefined
    const lookThroughSoftWarning = ltApproach
      ? { label: ltApproach.label, pct: ltApproach.pct, soft: ltApproach.soft }
      : undefined

    const ladder = computeLadder(moveInputs, totalValue, {
      market: marketPositions,
      lookThroughHardBreach: lookThroughBreach,
      lookThroughSoftWarning,
    })

    // Forecast
    const monthlyContribution = user?.monthlyContribution ?? 3000
    const riskFreeRate = user?.riskFreeRate ?? 0.04
    const contributionGrowthRate = user?.contributionGrowthRate ?? 0.05
    const annualLumpSum = user?.annualLumpSum ?? 20000
    const allocMap: Record<string, number> = {}
    for (const p of positions) allocMap[p.ticker] = p.actualPct
    const { rates, excludedTickers } = blendedGrowthRates(allocMap, riskFreeRate)
    const yearsTo2045 = Math.max(1, 2045 - new Date().getFullYear())
    const base2045 = projectPortfolio(totalValue, monthlyContribution, annualLumpSum, rates.base, yearsTo2045, contributionGrowthRate)

    // Volatility
    const timeline = buildPortfolioTimeline(
      holdings.map(h => ({ id: h.id, snapshots: h.snapshots.map(s => ({ date: s.date, value: s.value })) })),
    )
    const vol = annualisedVolatility(timeline)

    // Tech ceiling
    const eqacPct = positions.find(p => p.ticker === "EQAC")?.actualPct ?? 0
    const smhPct = positions.find(p => p.ticker === "SMH")?.actualPct ?? 0
    const techCeiling = getCombinedTechCeiling(eqacPct, smhPct)

    // Trade counts
    const buyCount = trades.filter(t => t.type === "BUY").length
    const sellCount = trades.filter(t => t.type === "SELL").length

    const ccySymbol = "$"
    const fmt = (v: number) => v >= 1_000_000 ? `${ccySymbol}${(v / 1_000_000).toFixed(1)}M` : `${ccySymbol}${(v / 1_000).toFixed(0)}K`

    // ── Build findings per agent ───────────────────────────────────────────

    const findings: Record<string, AgentFinding> = {}

    // 1. Constitution Auditor — health score breakdown
    {
      const steps: Array<{ level: Level; msg: string }> = []
      steps.push({ level: "info", msg: `Loading governance framework · ${govAlignment.checks.length} compliance checks` })
      steps.push({ level: "data", msg: `Health score: ${health.overall}/100 (${health.overallLabel})` })
      steps.push({ level: "data", msg: `Structural ${health.structural.score} · Behavioural ${health.behavioural.score} · Concentration ${health.concentration.score} · Freshness ${health.freshness.score}` })

      const breachChecks = govAlignment.checks.filter(c => c.status === "breach")
      const watchChecks = govAlignment.checks.filter(c => c.status === "watch")

      if (breachChecks.length > 0) {
        for (const c of breachChecks.slice(0, 2)) {
          steps.push({ level: "err", msg: `BREACH: ${c.label} — ${c.detail}` })
        }
      }
      if (watchChecks.length > 0) {
        steps.push({ level: "warn", msg: `${watchChecks.length} watch: ${watchChecks.map(c => c.label).join(", ")}` })
      }
      if (breachChecks.length === 0 && watchChecks.length === 0) {
        steps.push({ level: "ok", msg: `All ${govAlignment.checks.length} checks passed` })
      }

      const ts = spacedTimings(steps.length)
      const conBreachSummary = breachChecks.length === 1
        ? `${breachChecks[0].label} breach — health ${health.overall}/100`
        : breachChecks.length > 1
          ? `${breachChecks.length} breaches (${breachChecks.slice(0, 2).map(c => c.label).join(", ")}) — health ${health.overall}/100`
          : null
      findings.constitution = {
        script: steps.map((s, i) => ({ t: ts[i], level: s.level, msg: s.msg })),
        result: {
          status: breachChecks.length > 0 ? "alert" : "done",
          line: {
            t: resultT(ts),
            level: breachChecks.length > 0 ? "warn" : "ok",
            msg: conBreachSummary ?? `Governance clean — health ${health.overall}/100, all checks passed`,
          },
        },
      }
    }

    // 2. Governance Sentinel — specific cap enforcement
    {
      const steps: Array<{ level: Level; msg: string }> = []
      steps.push({ level: "info", msg: `Evaluating caps across ${positions.length} positions` })

      for (const check of govAlignment.checks.slice(0, 4)) {
        const lvl: Level = check.status === "breach" ? "err" : check.status === "watch" ? "warn" : "data"
        steps.push({ level: lvl, msg: `${check.label}: ${check.detail}` })
      }

      steps.push({
        level: snapshotAgeDays <= 1 ? "ok" : snapshotAgeDays >= 7 ? "warn" : "data",
        msg: `Data freshness: ${snapshotAgeDays <= 1 ? "current" : `${snapshotAgeDays} day${snapshotAgeDays !== 1 ? "s" : ""} since last update`}`,
      })

      const ts = spacedTimings(steps.length)
      const isClean = govAlignment.overall === "ok"
      const govBreachChecks = govAlignment.checks.filter(c => c.status === "breach")
      const govWatchChecks = govAlignment.checks.filter(c => c.status === "watch")
      let govResultMsg: string
      if (isClean) {
        govResultMsg = `Governance clean — ${govAlignment.checks.length} checks, 0 breaches`
      } else {
        const parts: string[] = []
        if (govBreachChecks.length > 0) parts.push(`${govBreachChecks.length} breach (${govBreachChecks.slice(0, 2).map(c => c.label).join(", ")})`)
        if (govWatchChecks.length > 0) parts.push(`${govWatchChecks.length} watch (${govWatchChecks.slice(0, 2).map(c => c.label).join(", ")})`)
        govResultMsg = `${parts.join(", ")} — review needed`
      }
      findings.governance = {
        script: steps.map((s, i) => ({ t: ts[i], level: s.level, msg: s.msg })),
        result: {
          status: isClean ? "done" : "alert",
          line: {
            t: resultT(ts),
            level: isClean ? "ok" : "warn",
            msg: govResultMsg,
          },
        },
      }
    }

    // 3. Drift Monitor — position drift analysis
    {
      const steps: Array<{ level: Level; msg: string }> = []
      steps.push({ level: "info", msg: `Sampling live weights vs target model · ${positions.filter(p => p.targetPct > 0).length} tracked positions` })

      const drifted = positions
        .filter(p => p.targetPct > 0 && Math.abs(p.actualPct - p.targetPct) > p.toleranceBand)
        .sort((a, b) => Math.abs(b.actualPct - b.targetPct) - Math.abs(a.actualPct - a.targetPct))

      for (const p of drifted.slice(0, 3)) {
        const drift = p.actualPct - p.targetPct
        const dir = drift > 0 ? "overweight" : "underweight"
        steps.push({
          level: "warn",
          msg: `${p.name} (${p.ticker}) ${p.actualPct.toFixed(1)}% vs target ${p.targetPct.toFixed(1)}% · ${dir} ${Math.abs(drift).toFixed(1)}pp`,
        })
      }

      const inBand = positions.filter(p => p.targetPct > 0).length - drifted.length
      if (inBand > 0) {
        steps.push({ level: "ok", msg: `${inBand} position${inBand > 1 ? "s" : ""} within tolerance band` })
      }

      if (maxDrift > 0) {
        steps.push({ level: "data", msg: `Max drift: ${maxDrift.toFixed(1)}pp` })
      }

      const ts = spacedTimings(steps.length)
      const driftSummary = drifted.length > 0
        ? drifted.slice(0, 3).map(p => {
            const drift = p.actualPct - p.targetPct
            return `${p.ticker} ${drift > 0 ? "+" : ""}${drift.toFixed(1)}pp`
          }).join(", ")
        : null
      findings.drift = {
        script: steps.map((s, i) => ({ t: ts[i], level: s.level, msg: s.msg })),
        result: {
          status: drifted.length > 0 ? "alert" : "done",
          line: {
            t: resultT(ts),
            level: drifted.length > 0 ? "warn" : "ok",
            msg: drifted.length > 0
              ? `${drifted.length} outside band (${driftSummary}) — rebalance queued`
              : "All positions within tolerance — no rebalance needed",
          },
        },
      }
    }

    // 4. Rebalance Engine — decision ladder
    {
      const steps: Array<{ level: Level; msg: string }> = []
      steps.push({ level: "info", msg: `Descending decision ladder · ${ladder.steps.length} rungs` })

      const firedStep = ladder.steps.find(s => s.status === "fired")
      if (firedStep) {
        steps.push({ level: "data", msg: `Rung ${firedStep.step}: ${firedStep.label} — FIRED` })
        if (firedStep.reason) steps.push({ level: "data", msg: firedStep.reason })
      }

      steps.push({
        level: ladder.severity === "critical" || ladder.severity === "high" ? "warn" : "ok",
        msg: ladder.instruction,
      })

      const ts = spacedTimings(steps.length)
      const isUrgent = ladder.severity === "critical" || ladder.severity === "high"
      findings.rebalance = {
        script: steps.map((s, i) => ({ t: ts[i], level: s.level, msg: s.msg })),
        result: {
          status: isUrgent ? "alert" : "done",
          line: {
            t: resultT(ts),
            level: isUrgent ? "warn" : "ok",
            msg: `Ladder: rung ${ladder.firedStep} (${ladder.severity}) — ${ladder.headline}`,
          },
        },
      }
    }

    // 5. Smart Money — no engine available yet
    {
      const ts = spacedTimings(2)
      findings.smartmoney = {
        script: [
          { t: ts[0], level: "info", msg: "13F institutional filing feed not yet connected" },
          { t: ts[1], level: "data", msg: "Requires external data source — feature roadmap" },
        ],
        result: {
          status: "done",
          line: { t: resultT(ts), level: "info", msg: "13F analysis unavailable — no data feed configured" },
        },
      }
    }

    // 6. Forecast Engine — growth projections
    {
      const steps: Array<{ level: Level; msg: string }> = []
      steps.push({ level: "info", msg: `Blending growth assumptions from ${positions.length} holdings` })
      if (excludedTickers.length > 0) {
        steps.push({ level: "warn", msg: `${excludedTickers.length} ticker${excludedTickers.length !== 1 ? "s" : ""} excluded from blend (${excludedTickers.join(", ")}) — add return assumptions` })
      }
      steps.push({ level: "data", msg: `CAGR: conservative ${(rates.conservative * 100).toFixed(1)}% · base ${(rates.base * 100).toFixed(1)}% · aggressive ${(rates.aggressive * 100).toFixed(1)}%` })
      steps.push({ level: "data", msg: `Base-case 2045 (${yearsTo2045}yr): ${fmt(base2045)} at ${(rates.base * 100).toFixed(1)}% p.a.` })
      steps.push({ level: "ok", msg: `Monthly ${ccySymbol}${monthlyContribution.toLocaleString()} + annual lump ${ccySymbol}${annualLumpSum.toLocaleString()} · growth ${(contributionGrowthRate * 100).toFixed(0)}% p.a.` })

      const ts = spacedTimings(steps.length)
      findings.forecast = {
        script: steps.map((s, i) => ({ t: ts[i], level: s.level, msg: s.msg })),
        result: {
          status: excludedTickers.length > 0 ? "alert" : "done",
          line: { t: resultT(ts), level: excludedTickers.length > 0 ? "warn" : "ok", msg: `Forecast refreshed — base case ${fmt(base2045)} by 2045${excludedTickers.length > 0 ? ` (${excludedTickers.length} ticker${excludedTickers.length !== 1 ? "s" : ""} excluded)` : ""}` },
        },
      }
    }

    // 7. Risk Analyzer — concentration and volatility
    {
      const steps: Array<{ level: Level; msg: string }> = []
      steps.push({ level: "info", msg: `Building return timeline · ${timeline.length} data points` })

      if (vol !== null) {
        steps.push({ level: "data", msg: `Annualised volatility: ${(vol * 100).toFixed(1)}%` })
      } else {
        steps.push({ level: "data", msg: "Insufficient snapshot history for volatility estimate" })
      }

      const worstCompany = [...lookThrough.companies].sort((a, b) => b.pct - a.pct)[0]
      if (worstCompany) {
        const lvl: Level = worstCompany.status === "breach" ? "err" : worstCompany.status === "watch" ? "warn" : "data"
        steps.push({ level: lvl, msg: `Top company: ${worstCompany.label} ${worstCompany.pct.toFixed(1)}% (cap ${worstCompany.hard}%)` })
      }

      const worstSector = [...lookThrough.sectors].sort((a, b) => b.pct - a.pct)[0]
      if (worstSector) {
        const lvl: Level = worstSector.status === "breach" ? "err" : worstSector.status === "watch" ? "warn" : "data"
        steps.push({ level: lvl, msg: `Top sector: ${worstSector.label} ${worstSector.pct.toFixed(1)}% (cap ${worstSector.hard}%)` })
      }

      if (techCeiling.status !== "clear") {
        steps.push({ level: techCeiling.status === "hard_breach" ? "err" : "warn", msg: `Combined tech ${techCeiling.combinedPct.toFixed(1)}% — ${techCeiling.label}` })
      }

      const ts = spacedTimings(steps.length)
      const hasConcentration = companyBreaches > 0 || sectorBreaches > 0 || techCeiling.status === "hard_breach"
      let riskResultMsg: string
      if (hasConcentration) {
        const breachLabels: string[] = []
        const companyBreach = lookThrough.companies.find(c => c.status === "breach")
        if (companyBreach) breachLabels.push(`${companyBreach.label} ${companyBreach.pct.toFixed(1)}%`)
        const sectorBreach = lookThrough.sectors.find(s => s.status === "breach")
        if (sectorBreach) breachLabels.push(`${sectorBreach.label} ${sectorBreach.pct.toFixed(1)}%`)
        if (techCeiling.status === "hard_breach") breachLabels.push(`tech ${techCeiling.combinedPct.toFixed(1)}%`)
        riskResultMsg = `Concentration issue — ${breachLabels.join(", ")}`
      } else {
        const volStr = vol !== null ? ` — vol ${(vol * 100).toFixed(1)}%` : ""
        const topRisk = worstCompany ? `, top ${worstCompany.label} ${worstCompany.pct.toFixed(1)}%` : ""
        riskResultMsg = `Risk within bounds${volStr}${topRisk}`
      }
      findings.risk = {
        script: steps.map((s, i) => ({ t: ts[i], level: s.level, msg: s.msg })),
        result: {
          status: hasConcentration ? "alert" : "done",
          line: {
            t: resultT(ts),
            level: hasConcentration ? "warn" : "ok",
            msg: riskResultMsg,
          },
        },
      }
    }

    // 8. Dividend Tracker — trade reconciliation
    {
      const steps: Array<{ level: Level; msg: string }> = []
      steps.push({ level: "info", msg: `Scanning trade ledger · ${trades.length} records` })

      if (trades.length > 0) {
        steps.push({ level: "data", msg: `${buyCount} buy${buyCount !== 1 ? "s" : ""} · ${sellCount} sell${sellCount !== 1 ? "s" : ""} recorded` })
        const lastTrade = trades[trades.length - 1]
        const daysAgo = Math.floor((Date.now() - new Date(lastTrade.date).getTime()) / 86_400_000)
        steps.push({ level: "data", msg: `Last trade: ${lastTrade.type} ${lastTrade.ticker} ${lastTrade.units} units · ${daysAgo}d ago` })
      } else {
        steps.push({ level: "data", msg: "No trades recorded yet" })
      }

      const ts = spacedTimings(steps.length)
      findings.dividends = {
        script: steps.map((s, i) => ({ t: ts[i], level: s.level, msg: s.msg })),
        result: {
          status: "done",
          line: { t: resultT(ts), level: "ok", msg: `Trade ledger scanned — ${trades.length} records reconciled` },
        },
      }
    }

    return findings
  } catch {
    return null
  }
}

// ── Real SBR findings ──────────────────────────────────────────────────────
// SBR helpers check what Dami actually has in the database. If there are no
// holdings or trades, they say so honestly instead of playing scripted traces.

async function loadSbrFindings(userId: string): Promise<Record<string, AgentFinding> | null> {
  try {
    const [holdings, trades, owner] = await Promise.all([
      db.holding.findMany({
        where: { userId },
        include: { snapshots: { orderBy: { date: "desc" }, take: 2 } },
      }),
      db.trade.findMany({ where: { userId }, orderBy: { date: "asc" } }),
      db.user.findUnique({where:{id:userId},select:{monthlyContribution:true,annualLumpSum:true,contributionGrowthRate:true}}),
    ])

    const rows = holdings
      .map(h => ({
        ticker: h.ticker,
        name: h.name,
        value: h.snapshots[0]?.value ?? 0,
        targetPct: h.targetPct,
      }))
      .filter(r => r.value > 0)

    const totalValue = rows.reduce((s, r) => s + r.value, 0)
    const hasHoldings = totalValue > 0
    const hasTrades = trades.length > 0
    const findings: Record<string, AgentFinding> = {}

    // 1. Buys — what shares to buy this month
    {
      const ts = spacedTimings(2)
      if (hasHoldings) {
        const fundCount = rows.length
        findings.buys = {
          script: [
            { t: ts[0], level: "info", msg: `Checking your ${fundCount} fund${fundCount !== 1 ? "s" : ""} for this month's split` },
            { t: ts[1], level: "data", msg: `Total value: S$${Math.round(totalValue).toLocaleString()}` },
          ],
          result: { status: "done", line: { t: resultT(ts), level: "ok", msg: `${fundCount} fund${fundCount !== 1 ? "s" : ""} loaded — ready when you add this month's savings` } },
        }
      } else {
        findings.buys = {
          script: [
            { t: ts[0], level: "info", msg: "Looking for your funds" },
            { t: ts[1], level: "data", msg: hasTrades ? "Trades recorded but no prices yet" : "No holdings recorded yet" },
          ],
          result: { status: "done", line: { t: resultT(ts), level: "info", msg: hasTrades ? "Sync prices to calculate your monthly split" : "No funds yet — add your first holding to get started" } },
        }
      }
    }

    // 2. Balance — are funds near their targets?
    {
      const ts = spacedTimings(2)
      if (hasHoldings) {
        const withPct = rows.map(r => ({ ...r, actualPct: (r.value / totalValue) * 100 }))
        const offTarget = withPct.filter(r => r.targetPct > 0 && Math.abs(r.actualPct - r.targetPct) > 3)
        if (offTarget.length > 0) {
          findings.balance = {
            script: [
              { t: ts[0], level: "info", msg: "Weighing each fund against its guide-rails" },
              { t: ts[1], level: "warn", msg: `${offTarget.length} fund${offTarget.length !== 1 ? "s" : ""} outside target range` },
            ],
            result: { status: "alert", line: { t: resultT(ts), level: "warn", msg: `${offTarget.length} fund${offTarget.length !== 1 ? "s" : ""} a bit off — even out over the next month` } },
          }
        } else {
          findings.balance = {
            script: [
              { t: ts[0], level: "info", msg: "Weighing each fund against its guide-rails" },
              { t: ts[1], level: "ok", msg: "All funds within their target range" },
            ],
            result: { status: "done", line: { t: resultT(ts), level: "ok", msg: "Funds balanced — nothing to even out" } },
          }
        }
      } else {
        findings.balance = {
          script: [
            { t: ts[0], level: "info", msg: "Looking for fund balances to check" },
            { t: ts[1], level: "data", msg: hasTrades ? "Trades recorded but no prices yet" : "No holdings to weigh yet" },
          ],
          result: { status: "done", line: { t: resultT(ts), level: "info", msg: hasTrades ? "Waiting for price sync — tap Update Holdings" : "No funds yet — nothing to balance" } },
        }
      }
    }

    // 3. Road — where are you on the journey?
    {
      const ts = spacedTimings(2)
      if (hasTrades) {
        const firstTradeDate = new Date(trades[0].date)
        const monthsSaved = Math.max(1, Math.round((Date.now() - firstTradeDate.getTime()) / (30.44 * 86_400_000)))
        findings.road = {
          script: [
            { t: ts[0], level: "info", msg: "Counting the months you've been saving" },
            { t: ts[1], level: "data", msg: `${monthsSaved} month${monthsSaved !== 1 ? "s" : ""} since your first trade` },
          ],
          result: { status: "done", line: { t: resultT(ts), level: "ok", msg: `On the road — ${monthsSaved} month${monthsSaved !== 1 ? "s" : ""} in` } },
        }
      } else {
        findings.road = {
          script: [
            { t: ts[0], level: "info", msg: "Looking for your savings history" },
            { t: ts[1], level: "data", msg: "No trades recorded yet" },
          ],
          result: { status: "done", line: { t: resultT(ts), level: "info", msg: "The road starts when you make your first trade" } },
        }
      }
    }

    // 4. Risk limits — allocation and concentration rules, never a value milestone.
    {
      const ts = spacedTimings(2)
      if (hasHoldings) {
        const withPct = rows.map(r => ({ ...r, actualPct: (r.value / totalValue) * 100 }))
        const capBreaches = withPct.filter(r => {
          const fund = SBR_SPEC.funds.find(f => f.ticker === r.ticker)
          return fund?.hardCap != null && r.actualPct > fund.hardCap
        })
        if (capBreaches.length > 0) {
          findings.safety = {
            script: [
              { t: ts[0], level: "info", msg: "Checking fund caps and concentration limits" },
              { t: ts[1], level: "warn", msg: `${capBreaches.map(x => x.ticker).join(", ")} above constitutional cap` },
            ],
            result: { status: "alert", line: { t: resultT(ts), level: "warn", msg: "Pause affected purchases and route new cash to an eligible underweight fund" } },
          }
        } else {
          findings.safety = {
            script: [
              { t: ts[0], level: "info", msg: "Checking fund caps and concentration limits" },
              { t: ts[1], level: "data", msg: "No automatic value-based de-risking rule exists" },
            ],
            result: { status: "done", line: { t: resultT(ts), level: "ok", msg: "Current fund weights remain within their hard caps" } },
          }
        }
      } else {
        findings.safety = {
          script: [
            { t: ts[0], level: "info", msg: "Looking for your fund value" },
            { t: ts[1], level: "data", msg: hasTrades ? "Trades recorded but no price data yet" : "No holdings yet — can't check milestones" },
          ],
          result: { status: "done", line: { t: resultT(ts), level: "info", msg: "No holdings yet — current concentration is zero" } },
        }
      }
    }

    // 5. Flexible-horizon scenarios — no invented target, ETA or probability.
    {
      if (hasHoldings) {
        const allocMap: Record<string, number> = {}
        for (const r of rows) allocMap[r.ticker] = (r.value / totalValue) * 100
        const sbrRates = sbrBlendedGrowthRate(allocMap)
        const monthly = owner?.monthlyContribution??SBR_SPEC.monthlyContribution
        const annual = owner?.annualLumpSum??0
        const growth = owner?.contributionGrowthRate??0
        const project = (years:number,rate:number)=>projectPortfolio(totalValue,monthly,annual,rate,years,growth)
        const steps: Array<{ level: Level; msg: string }> = [
          { level: "info", msg: `Projecting flexible 5- and 10-year illustrations from S$${Math.round(totalValue).toLocaleString()}` },
          { level: "data", msg: `Blended assumptions: ${(sbrRates.conservative * 100).toFixed(1)}% conservative · ${(sbrRates.base * 100).toFixed(1)}% base` },
          { level: "data", msg: `Settings: S$${monthly.toLocaleString()}/mo · S$${annual.toLocaleString()}/yr · growth ${(growth*100).toFixed(1)}% p.a.` },
          { level: "data", msg: `Base illustration: S$${Math.round(project(5, sbrRates.base)).toLocaleString()} in 5y · S$${Math.round(project(10, sbrRates.base)).toLocaleString()} in 10y` },
        ]
        const ts = spacedTimings(steps.length)
        findings.goal = {
          script: steps.map((s, i) => ({ t: ts[i], level: s.level, msg: s.msg })),
          result: { status: "done", line: { t: resultT(ts), level: "ok", msg: "Scenario range refreshed — no deadline or trade signal created" } },
        }
      } else {
        const ts = spacedTimings(2)
        findings.goal = {
          script: [
            { t: ts[0], level: "info", msg: "Looking for your savings to project" },
            { t: ts[1], level: "data", msg: hasTrades ? "Trades recorded but no price data yet" : "No holdings yet" },
          ],
          result: { status: "done", line: { t: resultT(ts), level: "info", msg: hasTrades ? "Sync prices to project your timeline" : "Add your first holding to see a projection" } },
        }
      }
    }

    // 6. Savings — tally of deposits
    {
      const ts = spacedTimings(2)
      if (hasTrades) {
        const totalBought = trades.filter(t => t.type === "BUY").reduce((s, t) => s + t.amount, 0)
        findings.savings = {
          script: [
            { t: ts[0], level: "info", msg: "Adding up every deposit you've made" },
            { t: ts[1], level: "data", msg: `${trades.length} trade${trades.length !== 1 ? "s" : ""} · S$${Math.round(totalBought).toLocaleString()} invested` },
          ],
          result: { status: "done", line: { t: resultT(ts), level: "ok", msg: `${trades.length} trade${trades.length !== 1 ? "s" : ""} recorded — S$${Math.round(totalBought).toLocaleString()} total` } },
        }
      } else {
        findings.savings = {
          script: [
            { t: ts[0], level: "info", msg: "Looking for your trade history" },
            { t: ts[1], level: "data", msg: "No trades recorded yet" },
          ],
          result: { status: "done", line: { t: resultT(ts), level: "info", msg: "No deposits yet — your first trade starts the counter" } },
        }
      }
    }

    return findings
  } catch {
    return null
  }
}

export default async function MissionControlPage() {
  const session = await getSession()
  if(!session) redirect("/login?portfolio=atlas-core")
  const active = await activePortfolioContext(session)
  const constitutionId = active.constitutionId
  const context = await loadPortfolioContext(active ? { constitutionId: active.constitutionId, userId: active.owner.id } : undefined)

  let findings: Record<string, AgentFinding> | null = null
  {
    const isSbr = active.constitutionId === "silicon-brick-road"
    findings = isSbr
      ? await loadSbrFindings(active.owner.id)
      : await loadAgentFindings(active.owner.id)
  }

  const requiredTickers = ["VWRA", "EQAC", "SMH", "BTC", "DBMFE"]
  const requiredLookThrough = await db.etfLookThrough.findMany({
        where: { ticker: { in: requiredTickers } },
        select: { ticker: true, updatedAt: true },
      })
  // The portfolio is only as fresh as its oldest required building block.
  // Missing funds deliberately show as "never refreshed" rather than borrowing
  // a newer timestamp from another fund.
  const lookThroughUpdatedAt = requiredLookThrough.length === requiredTickers.length
    ? new Date(Math.min(...requiredLookThrough.map(row => row.updatedAt.getTime())))
    : null

  if(!findings) return <Shell title="Mission Control" subtitle={context.label} userName={session.name} isAdmin={session.role==="admin"} constitutionId={constitutionId}><div className="deck-ledger p-6"><h1>Mission Control could not reconcile live data</h1><p>No sample figures are shown. Refresh the IBKR data or check the production logs, then try again.</p></div></Shell>
  return (
    <Shell title="Mission Control" subtitle={`${context.label} · live governance`} userName={session.name} isAdmin={session.role==="admin"} constitutionId={constitutionId}>
      <MissionControl key={context.variant} context={context} findings={findings} lookThroughUpdatedAt={lookThroughUpdatedAt} />
    </Shell>
  )
}
