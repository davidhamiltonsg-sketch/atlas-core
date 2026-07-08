import type { Metadata } from "next"
import { Space_Grotesk, Inter, JetBrains_Mono } from "next/font/google"
import { getSession } from "@/lib/session"
import { constitutionIdForEmail } from "@/lib/constitutions"
import { db } from "@/lib/db"
import { MissionControl, type PortfolioContext, type AgentFinding } from "@/components/mission-control/mission-control"
import { computePortfolioHealth } from "@/lib/health"
import { computeLadder } from "@/lib/ladder"
import { BITCOIN_SLEEVE_TARGET_PCT } from "@/lib/next-best-move"
import { evaluateGovernance } from "@/lib/governance-status"
import { computeLookThrough, worstLookThroughBreach, worstLookThroughApproach, largestContributor } from "@/lib/look-through"
import { blendedGrowthRates, projectPortfolio } from "@/lib/forecast"
import { buildPortfolioTimeline, annualisedVolatility } from "@/lib/portfolio-metrics"
import { getCombinedTechCeiling } from "@/lib/cycle"
import { HARD_THRESHOLDS } from "@/lib/constants"
import { getLiveMarketPositions } from "@/lib/finnhub"

// Mission Control is a personal, auth-gated console — never statically cached.
export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Mission Control · Atlas",
  description: "Live agent dispatch console for the Atlas governance engines.",
}

// The three brand fonts from the mission-control brief, exposed as CSS variables
// the client component reads: Space Grotesk (display) · Inter (body) · JetBrains Mono (data).
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk", display: "swap" })
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" })
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono", display: "swap" })

// Representative context shown when logged out (or with no snapshots yet) so the
// console still reads as a real command centre. Clearly flagged SAMPLE in the UI.
const SAMPLE_CONTEXT: PortfolioContext = {
  label: "Atlas Core",
  totalValue: 284_500,
  currency: "SGD",
  dayChangePct: 0.42,
  cashPct: 3.1,
  driftAlerts: 1,
  live: false,
  variant: "atlas",
  holdings: [
    { ticker: "VT",   name: "World Equity Core",   pct: 34.0, color: "#4A9EFF" },
    { ticker: "QQQM", name: "Growth Sleeve",       pct: 23.0, color: "#C9A84C" },
    { ticker: "VOO",  name: "US Large Cap",         pct: 18.0, color: "#2ECC9A" },
    { ticker: "VWO",  name: "Emerging Markets",     pct: 9.0,  color: "#8B7FE8" },
    { ticker: "BTC",  name: "Bitcoin Sleeve",       pct: 7.0,  color: "#E0913A" },
    { ticker: "SGOV", name: "Cash / T-Bills",       pct: 3.1,  color: "#5A6B8C" },
    { ticker: "A35",  name: "SG Bonds",             pct: 5.9,  color: "#3EC9C0" },
  ],
}

// Silicon Brick Road sample — its four funds, plain-English names, SGD.
const SBR_SAMPLE_CONTEXT: PortfolioContext = {
  label: "Silicon Brick Road",
  totalValue: 18_400,
  currency: "SGD",
  dayChangePct: 0.31,
  cashPct: null,
  driftAlerts: 1,
  live: false,
  variant: "sbr",
  holdings: [
    { ticker: "VWRA", name: "Global fund",          pct: 60.0, color: "#4A9EFF" },
    { ticker: "A35",  name: "Singapore bond fund",   pct: 20.0, color: "#2ECC9A" },
    { ticker: "EQQQ", name: "Nasdaq fund",           pct: 10.0, color: "#C9A84C" },
    { ticker: "SMH",  name: "Chip-maker fund",       pct: 10.0, color: "#E0913A" },
  ],
}

async function loadPortfolioContext(): Promise<PortfolioContext> {
  const session = await getSession()
  if (!session) return SAMPLE_CONTEXT

  const isSbr = constitutionIdForEmail(session.email) === "silicon-brick-road"
  const label = isSbr ? "Silicon Brick Road" : "Atlas Core"
  const fallback = isSbr ? SBR_SAMPLE_CONTEXT : SAMPLE_CONTEXT

  try {

    const holdings = await db.holding.findMany({
      where: { userId: session.userId },
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
    if (total <= 0) return fallback

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
      currency: "SGD",
      dayChangePct,
      cashPct: cashPct > 0 ? cashPct : null,
      driftAlerts,
      live: true,
      holdings: holdingsOut,
      variant: isSbr ? "sbr" : "atlas",
    }
  } catch {
    // A console should never crash the app — degrade to the sample context
    // for whichever portfolio the signed-in user owns.
    return fallback
  }
}

// ── Real agent findings (Atlas only) ────────────────────────────────────────
// Each engine runs against the live portfolio and produces timestamped log
// messages + a final result that the client component animates verbatim.
// When the server can't produce findings (logged out, no holdings, SBR user),
// the client falls back to the scripted traces.

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
    const positions = holdings
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

    // Bitcoin sleeve consolidation — BTC in run-off, IBIT is accumulation
    const btcPos = positions.find(p => p.ticker === "BTC")
    const ibitPos = positions.find(p => p.ticker === "IBIT")
    if (btcPos && ibitPos) {
      btcPos.targetPct = btcPos.actualPct
      const ibitTarget = Math.max(0, BITCOIN_SLEEVE_TARGET_PCT - btcPos.actualPct)
      ibitPos.targetPct = ibitTarget
    }

    // Run engines
    const lookThrough = computeLookThrough(positions)
    const companyBreaches = lookThrough.companies.filter(c => c.status === "breach").length
    const sectorBreaches = lookThrough.sectors.filter(s => s.status === "breach").length
    const ltBreach = worstLookThroughBreach(lookThrough)
    const ltApproach = worstLookThroughApproach(lookThrough)

    const sgovPct = positions.find(p => ["SGOV", "CASH", "SGD", "AGG"].includes(p.ticker.toUpperCase()))?.actualPct ?? 0
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
    const rates = blendedGrowthRates(allocMap, riskFreeRate)
    const yearsTo2045 = Math.max(1, 2045 - new Date().getFullYear())
    const base2045 = projectPortfolio(totalValue, monthlyContribution, annualLumpSum, rates.base, yearsTo2045, contributionGrowthRate)

    // Volatility
    const timeline = buildPortfolioTimeline(
      holdings.map(h => ({ id: h.id, snapshots: h.snapshots.map(s => ({ date: s.date, value: s.value })) })),
    )
    const vol = annualisedVolatility(timeline)

    // Tech ceiling
    const qqqmPct = positions.find(p => p.ticker === "QQQM")?.actualPct ?? 0
    const smhPct = positions.find(p => p.ticker === "SMH")?.actualPct ?? 0
    const techCeiling = getCombinedTechCeiling(qqqmPct, smhPct)

    // Trade counts
    const buyCount = trades.filter(t => t.type === "BUY").length
    const sellCount = trades.filter(t => t.type === "SELL").length

    const fmt = (v: number) => v >= 1_000_000 ? `S$${(v / 1_000_000).toFixed(1)}M` : `S$${(v / 1_000).toFixed(0)}K`

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
      findings.constitution = {
        script: steps.map((s, i) => ({ t: ts[i], level: s.level, msg: s.msg })),
        result: {
          status: breachChecks.length > 0 ? "alert" : "done",
          line: {
            t: resultT(ts),
            level: breachChecks.length > 0 ? "warn" : "ok",
            msg: breachChecks.length > 0
              ? `${breachChecks.length} breach${breachChecks.length > 1 ? "es" : ""} flagged — health ${health.overall}/100`
              : `Governance clean — health ${health.overall}/100, all checks passed`,
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
      findings.governance = {
        script: steps.map((s, i) => ({ t: ts[i], level: s.level, msg: s.msg })),
        result: {
          status: isClean ? "done" : "alert",
          line: {
            t: resultT(ts),
            level: isClean ? "ok" : "warn",
            msg: isClean
              ? `Governance clean — ${govAlignment.checks.length} checks, 0 breaches`
              : `${govAlignment.breaches} breach${govAlignment.breaches > 1 ? "es" : ""}, ${govAlignment.watches} watch — review needed`,
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
      findings.drift = {
        script: steps.map((s, i) => ({ t: ts[i], level: s.level, msg: s.msg })),
        result: {
          status: drifted.length > 0 ? "alert" : "done",
          line: {
            t: resultT(ts),
            level: drifted.length > 0 ? "warn" : "ok",
            msg: drifted.length > 0
              ? `${drifted.length} position${drifted.length > 1 ? "s" : ""} outside band — rebalance candidate${drifted.length > 1 ? "s" : ""} queued`
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
      steps.push({ level: "data", msg: `CAGR: conservative ${(rates.conservative * 100).toFixed(1)}% · base ${(rates.base * 100).toFixed(1)}% · aggressive ${(rates.aggressive * 100).toFixed(1)}%` })
      steps.push({ level: "data", msg: `Base-case 2045 (${yearsTo2045}yr): ${fmt(base2045)} at ${(rates.base * 100).toFixed(1)}% p.a.` })
      steps.push({ level: "ok", msg: `Monthly S$${monthlyContribution.toLocaleString()} + annual lump S$${annualLumpSum.toLocaleString()} · growth ${(contributionGrowthRate * 100).toFixed(0)}% p.a.` })

      const ts = spacedTimings(steps.length)
      findings.forecast = {
        script: steps.map((s, i) => ({ t: ts[i], level: s.level, msg: s.msg })),
        result: {
          status: "done",
          line: { t: resultT(ts), level: "ok", msg: `Forecast refreshed — base case ${fmt(base2045)} by 2045` },
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
      findings.risk = {
        script: steps.map((s, i) => ({ t: ts[i], level: s.level, msg: s.msg })),
        result: {
          status: hasConcentration ? "alert" : "done",
          line: {
            t: resultT(ts),
            level: hasConcentration ? "warn" : "ok",
            msg: hasConcentration
              ? `Concentration issue — ${companyBreaches + sectorBreaches} look-through breach${(companyBreaches + sectorBreaches) > 1 ? "es" : ""}`
              : `Risk within bounds${vol !== null ? ` — vol ${(vol * 100).toFixed(1)}%` : ""}, no concentration breach`,
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

    // 9. SBR Engine — cross-portfolio reference
    {
      const ts = spacedTimings(2)
      findings.sbr = {
        script: [
          { t: ts[0], level: "info", msg: "SBR phase gate — separate portfolio, tracked independently" },
          { t: ts[1], level: "data", msg: "Full SBR status available on the Silicon Brick Road dashboard" },
        ],
        result: {
          status: "done",
          line: { t: resultT(ts), level: "info", msg: "SBR monitoring available via the Silicon Brick Road dashboard" },
        },
      }
    }

    return findings
  } catch {
    return null
  }
}

export default async function MissionControlPage() {
  const [context, session] = await Promise.all([
    loadPortfolioContext(),
    getSession(),
  ])

  const isAtlas = session && constitutionIdForEmail(session.email) !== "silicon-brick-road"
  const findings = isAtlas ? await loadAgentFindings(session.userId) : null

  return (
    <div className={`${spaceGrotesk.variable} ${inter.variable} ${jetbrainsMono.variable}`}>
      <MissionControl context={context} findings={findings} />
    </div>
  )
}
