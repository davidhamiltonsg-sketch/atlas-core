import Link from "next/link"
import { Shell } from "@/components/shell"
import { Activity, AlertTriangle, FileBarChart2 } from "lucide-react"
import { db } from "@/lib/db"
import { formatCurrency } from "@/lib/utils"
import { getSession } from "@/lib/session"
import { AllocationDonut } from "@/components/charts/allocation-donut"
import { PortfolioHistoryChart } from "@/components/charts/portfolio-history-chart"
import { computePortfolioHealth } from "@/lib/health"
import { HARD_THRESHOLDS, TICKER_TARGETS } from "@/lib/constants"
import { computeMarketAwareDca, applyEconomicSleeves, BITCOIN_SLEEVE_TARGET_PCT, type PositionInput } from "@/lib/next-best-move"
import { economicSleeveTicker } from "@/lib/instrument-identity"
import { foldDuplicateHoldings } from "@/lib/holding-duplicates"
import { computeLadder } from "@/lib/ladder"
import { getLiveMarketPositions } from "@/lib/finnhub"
import { computeLookThrough, worstLookThroughBreach, worstLookThroughApproach, largestContributor } from "@/lib/look-through"
import { refreshedLookThroughData } from "@/lib/look-through-data"
import { evaluateGovernance } from "@/lib/governance-status"
import { isActuallyUsSited, isInScope } from "@/lib/approved-alternatives"
import { getRecentExecutions } from "@/lib/execution-actions"
import { RefreshPricesButton } from "@/components/portfolio/refresh-prices-button"
import { PortfolioUpdateButton } from "@/components/portfolio-update-button"
import { CORE_DEFAULTS } from "@/lib/core-holdings"
import { SbrDashboard } from "@/components/sbr/sbr-dashboard"
import type { ComplianceBandPosition } from "@/components/cockpit/compliance-board"
import { AnimatedNumber } from "@/components/animated-number"
import { blendedGrowthRates, projectPortfolio } from "@/lib/forecast"
import { getAwardPipeline, vestExtraContributionsForUser } from "@/lib/external-awards"
import { ExternalAwardCard, type AwardCardData } from "@/components/cockpit/external-award-card"
import { activePortfolioContext } from "@/lib/active-portfolio"
import { openPositionValuation } from "@/lib/valuation"
import { redirect } from "next/navigation"
import { getCachedUsdSgdRate, clearFxCache } from "@/lib/fx-cache"
import { BitcoinCycleBadge } from "@/components/bitcoin-cycle-badge"
import { getBitcoinCyclePhase } from "@/lib/bitcoin-cycle"
import { sgtToday, sgtDateOnly, dealingWindowStatus } from "@/lib/sgt-date"
import { money, convert } from "@/lib/money"
import { StatusChip } from "@/components/ui/status-chip"

// This is a personal, auth-gated dashboard whose server render includes live
// date maths (dealing-window and contribution countdowns). Pin it to dynamic so
// a countdown can never be frozen by an accidental static/edge cache.
export const dynamic = "force-dynamic"

// Fallback defaults (overridden by user DB settings)
const DEFAULT_MONTHLY = 3000
const DEFAULT_ANNUAL_LUMP_SUM = 20000
const DEFAULT_GROWTH_RATE = 0.05
const DEFAULT_RISK_FREE_RATE = 0.04

type ActionStatus = "healthy" | "soft" | "hard"

async function getDashboardData(userId: string) {
  const [user, rawHoldings, usdSgdRate, trades, cashBank] = await Promise.all([
    db.user.findUnique({ where: { id: userId } }),
    db.holding.findMany({
      where: { userId },
      include: { snapshots: { orderBy: { date: "desc" }, take: 8 } },
    }),
    getCachedUsdSgdRate(),
    db.trade.findMany({ where: { userId }, orderBy: { date: "asc" } }),
    db.dcaCashBank.findUnique({ where: { userId_constitutionId_currency: { userId, constitutionId: "atlas-core", currency: "SGD" } } }),
  ])

  // Duplicate same-ticker rows fold into one canonical row (units/value summed) so the
  // cockpit can't render colliding rows or double sleeves — see lib/holding-duplicates.ts.
  const holdings = foldDuplicateHoldings(rawHoldings)

  // Weighted-average cost basis per ticker from trades
  const avgCost: Record<string, { units: number; sgd: number; usd: number }> = {}
  for (const t of trades) {
    if (!avgCost[t.ticker]) avgCost[t.ticker] = { units: 0, sgd: 0, usd: 0 }
    const a = avgCost[t.ticker]
    if (t.type === "BUY") { a.units += t.units; a.sgd += t.amount; a.usd += t.units * t.price }
    else { const su = a.units > 0 ? a.sgd / a.units : 0; const uu = a.units > 0 ? a.usd / a.units : 0; const rem = Math.max(0, a.units - t.units); a.units = rem; a.sgd = rem * su; a.usd = rem * uu }
  }

  // Portfolio value history (deduplicated, last 8 complete dates)
  const holdingDateMaps = new Map<string, Map<string, number>>()
  for (const h of holdings) {
    const dm = new Map<string, number>()
    for (const s of h.snapshots) dm.set(s.date.toISOString().split("T")[0], s.value)
    holdingDateMaps.set(h.id, dm)
  }
  const holdingsWithData = holdings.filter(h => holdingDateMaps.get(h.id)!.size > 0)
  const allDates = [...new Set(holdingsWithData.flatMap(h => [...holdingDateMaps.get(h.id)!.keys()]))].sort()
  const completeDates = allDates.filter(date =>
    holdingsWithData.every(h => holdingDateMaps.get(h.id)!.has(date))
  ).slice(-8)
  const historyPoints = completeDates.map(date => ({
    label: new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
    value: holdingsWithData.reduce((sum, h) => sum + holdingDateMaps.get(h.id)!.get(date)!, 0),
  }))

  const totalValue = holdings.reduce((sum, h) => sum + (h.snapshots[0]?.value ?? 0), 0)
  const hasBalance = totalValue > 0
  const valueChange = historyPoints.length >= 2
    ? historyPoints[historyPoints.length - 1].value - historyPoints[historyPoints.length - 2].value
    : null

  // Economic-sleeve view (identity over ticker): alternate exchange lines of a governed
  // instrument (EQQQ→EQAC, SEMI→SMH) hold in place while the governed line accumulates
  // toward the remainder of the sleeve target, and §3 hard thresholds judge the sleeve's
  // COMBINED weight — a second line of the same ISIN can never read as its own drift.
  const preSleeve = holdings.map((h) => ({
    ticker: h.ticker,
    actualPct: totalValue > 0 ? ((h.snapshots[0]?.value ?? 0) / totalValue) * 100 : 0,
    targetPct: h.targetPct,
  }))
  const effTargetMap = new Map(applyEconomicSleeves(preSleeve).map((p) => [p.ticker, p.targetPct]))
  const sleeveActualMap = new Map<string, number>()
  for (const p of preSleeve) {
    const key = economicSleeveTicker(p.ticker)
    sleeveActualMap.set(key, (sleeveActualMap.get(key) ?? 0) + p.actualPct)
  }

  const positions = holdings.map((h) => {
    const value = h.snapshots[0]?.value ?? 0
    const actualPct = totalValue > 0 ? (value / totalValue) * 100 : 0
    const sleeveKey = economicSleeveTicker(h.ticker)
    const effTarget = effTargetMap.get(h.ticker) ?? h.targetPct
    const driftPct = actualPct - effTarget
    const absDrift = Math.abs(driftPct)
    const judged = sleeveActualMap.get(sleeveKey) ?? actualPct
    const overCap = h.hardCapPct !== null && judged > h.hardCapPct
    const ht = h.ticker === sleeveKey ? HARD_THRESHOLDS[h.ticker] : undefined
    const isHardDrift = totalValue > 0 && (overCap ||
      (ht?.low !== undefined && judged < ht.low) ||
      (ht !== undefined && judged > ht.high))
    const isSoftDrift = totalValue > 0 && !isHardDrift && absDrift > h.toleranceBand
    const status: ActionStatus = isHardDrift ? "hard" : isSoftDrift ? "soft" : "healthy"
    const latestPrice = h.snapshots[0]?.price ?? 0
    const prevPrice = h.snapshots[1]?.price ?? 0
    const priceChangePct = prevPrice > 0 ? ((latestPrice - prevPrice) / prevPrice) * 100 : null
    const priceHistory = [...h.snapshots].reverse().map(s => s.price).filter(p => p > 0)
    const latestSnapshot = h.snapshots[0]
    const cb = avgCost[h.ticker]
    // IBKR's open-position report is authoritative for live cost basis and unrealised P/L.
    // Reconstructing from the full trade table can double-count re-imported or partial history,
    // so the trade ledger is used only when the latest IBKR snapshot omitted these fields.
    const valuation = openPositionValuation({value,units:latestSnapshot?.units??0,snapshotCostBasis:latestSnapshot?.costBasis,snapshotUnrealizedPnl:latestSnapshot?.unrealizedPnl,reconstructedCostBasis:cb?.sgd,reconstructedAveragePrice:cb&&cb.units>0?cb.usd/cb.units:null,reportingFxRate:usdSgdRate})
    return { ticker: h.ticker, name: h.name, color: CORE_DEFAULTS[h.ticker]?.color ?? h.color, value, actualPct, targetPct: effTarget, driftPct, status, hardCapPct: h.hardCapPct, toleranceBand: h.toleranceBand, latestPrice, priceChangePct, priceHistory, avgCostUsd:valuation.averagePriceInstrumentCurrency, costBasisSgd:valuation.costBasis??0, unrealisedSgd:valuation.reconciles?valuation.unrealizedPnl:null, unrealisedPct:valuation.reconciles?valuation.unrealizedReturnPct:null, valuationSource:valuation.source, valuationReconciles:valuation.reconciles, units: h.snapshots[0]?.units ?? 0 }
  })

  // Bitcoin sleeve consolidation — BTC in run-off, IBIT is accumulation vehicle
  {
    const btcPos = positions.find(p => p.ticker === "BTC")
    const ibitPos = positions.find(p => p.ticker === "IBIT")
    if (btcPos && ibitPos && totalValue > 0) {
      const sleevePct = btcPos.actualPct + ibitPos.actualPct
      const sleeveCap = HARD_THRESHOLDS["IBIT"]?.high ?? 8
      btcPos.targetPct = btcPos.actualPct; btcPos.driftPct = 0; btcPos.status = "healthy"
      const ibitTarget = Math.max(0, BITCOIN_SLEEVE_TARGET_PCT - btcPos.actualPct)
      const ibitBand = ibitPos.toleranceBand ?? 1
      ibitPos.targetPct = ibitTarget
      ibitPos.driftPct = ibitPos.actualPct - ibitTarget
      ibitPos.status = sleevePct > sleeveCap ? "hard" : Math.abs(ibitPos.driftPct) > ibitBand ? "soft" : "healthy"
    }
  }

  const order: Record<ActionStatus, number> = { hard: 0, soft: 1, healthy: 2 }
  positions.sort((a, b) => order[a.status] - order[b.status])

  const hardBreaches = positions.filter(p => p.status === "hard").length
  const softBreaches = positions.filter(p => p.status === "soft").length
  const driftAlerts  = hardBreaches + softBreaches
  const maxDrift     = hasBalance ? positions.reduce((max, p) => Math.max(max, Math.abs(p.driftPct)), 0) : 0

  const latestSnapshotDate = holdings.reduce<Date | null>((latest, h) => {
    const d = h.snapshots[0]?.date
    if (!d || (h.snapshots[0]?.value??0)<=0) return latest
    return latest === null || d < latest ? d : latest
  }, null)
  const daysSinceUpdate = latestSnapshotDate
    ? Math.floor((Date.now() - new Date(latestSnapshotDate).getTime()) / 86_400_000)
    : null

  const [activeRules, totalRules] = await Promise.all([
    db.governanceRule.count({ where: { active: true } }),
    db.governanceRule.count(),
  ])
  const snapshotAgeDays = daysSinceUpdate ?? 999
  const refreshedLt = await refreshedLookThroughData()
  const lookThrough = computeLookThrough(positions,new Date(),refreshedLt.updatedAt,refreshedLt.weights)
  const companyHardBreaches = lookThrough.companies.filter(c => c.status === "breach").length
  const sectorHardBreaches  = lookThrough.sectors.filter(s => s.status === "breach").length
  const health = computePortfolioHealth({ hardBreaches, softBreaches, maxDrift, companyHardBreaches, sectorHardBreaches, activeRules, totalRules, snapshotAgeDays })

  // Owner plan settings are USD (Art. XIII: US$3,000/month + US$20,000 January; reporting is SGD).
  const monthlyContribution = user?.monthlyContribution ?? DEFAULT_MONTHLY
  const annualLumpSum = user?.annualLumpSum ?? DEFAULT_ANNUAL_LUMP_SUM
  const contributionGrowthRate = user?.contributionGrowthRate ?? DEFAULT_GROWTH_RATE
  const riskFreeRate = user?.riskFreeRate ?? DEFAULT_RISK_FREE_RATE

  // Growth-rate assumption blended from the portfolio's ACTUAL current holdings (post
  // Bitcoin-sleeve merge) — single source shared with the Forecast page, so this tile and
  // that page can never quote a different rate for the same portfolio.
  const allocMap: Record<string, number> = {}
  for (const p of positions) allocMap[p.ticker] = p.actualPct
  const { rates } = blendedGrowthRates(allocMap, riskFreeRate)

  const yearsTo2045 = Math.max(1, 2045 - new Date().getFullYear())
  // Outside-Atlas RSU vests count as planned contributions (sell-on-vest SOP) — plan
  // currency (USD after tax), same units as the monthly plan and January boost. The
  // award itself never enters NAV, targets or look-through.
  const vestExtras = await vestExtraContributionsForUser(userId)
  const base2045 = projectPortfolio(totalValue, monthlyContribution, annualLumpSum, rates.base, yearsTo2045, contributionGrowthRate, vestExtras)

  const startOfYear = new Date(new Date().getFullYear(), 0, 1)
  const dayOfYear = Math.floor((Date.now() - startOfYear.getTime()) / 86_400_000)
  const monthsElapsed = Math.min(12, Math.max(0, Math.round(dayOfYear / 30.44)))
  const soySnaps = await Promise.all(
    holdings.map((h) => db.snapshot.findFirst({ where: { holdingId: h.id, date: { lt: startOfYear } }, orderBy: { date: "desc" } }))
  )
  const startOfYearValue = soySnaps.reduce((s, snap) => s + (snap?.value ?? 0), 0)
  let targetNow: number | null = null
  if (startOfYearValue > 0 && monthsElapsed > 0) {
    let v = startOfYearValue + annualLumpSum
    const mRate = rates.base / 12
    for (let m = 0; m < monthsElapsed; m++) v = v * (1 + mRate) + monthlyContribution
    targetNow = v
  }
  const onTrackPct = targetNow && targetNow > 0 ? (totalValue / targetNow) * 100 : null

  // Contribution countdown — anchored to the Singapore calendar day (see lib/sgt-date).
  const today = sgtToday()
  const todayMidnight = sgtDateOnly(today)
  const day15ThisMonth = new Date(today.y, today.m, 15)
  const nextContribution = todayMidnight < day15ThisMonth
    ? day15ThisMonth
    : new Date(today.y, today.m + 1, 15)
  const daysToContribution = Math.ceil((nextContribution.getTime() - todayMidnight.getTime()) / 86_400_000)
  const nextContributionLabel = nextContribution.toLocaleDateString("en-GB", { day: "numeric", month: "short" })

  const donutData = holdings.filter(h=>["VWRA","EQAC","SMH","BTC","IBIT","GBTC","DBMFE","EQQQ","SEMI"].includes(h.ticker)).map((h) => {
    const value = h.snapshots[0]?.value ?? 0
    const actualPct = totalValue > 0 ? (value / totalValue) * 100 : 0
    return { ticker: h.ticker, name: h.name, actualPct, targetPct: h.targetPct, color: CORE_DEFAULTS[h.ticker]?.color ?? h.color, value }
  }).sort((a, b) => b.actualPct - a.actualPct)

  // Surface ONE slice per economic sleeve (identity over ticker) — Bitcoin (BTC+IBIT+GBTC)
  // and the alternate exchange lines EQQQ→EQAC / SEMI→SMH. Instrument history stays
  // separate in Activity; this is a display grouping only.
  {
    const SLEEVE_SLICES: Record<string, { name: string; target: number }> = {
      BTC:  { name: "Bitcoin sleeve · IBIT target", target: BITCOIN_SLEEVE_TARGET_PCT },
      EQAC: { name: "EQAC sleeve · EQAC + EQQQ",    target: TICKER_TARGETS["EQAC"] ?? 10 },
      SMH:  { name: "SMH sleeve · SMH + SEMI",      target: TICKER_TARGETS["SMH"] ?? 5 },
    }
    for (const [key, meta] of Object.entries(SLEEVE_SLICES)) {
      const members = donutData.filter((d) => economicSleeveTicker(d.ticker) === key)
      if (members.length < 2) continue
      const merged = {
        ticker: key, name: meta.name,
        actualPct: members.reduce((sum, row) => sum + row.actualPct, 0), targetPct: meta.target,
        color: members[0].color, value: members.reduce((sum, row) => sum + row.value, 0),
      }
      const rest = donutData.filter((d) => economicSleeveTicker(d.ticker) !== key)
      rest.push(merged)
      rest.sort((a, b) => b.actualPct - a.actualPct)
      donutData.length = 0
      donutData.push(...rest)
    }
  }

  const moveInputs: PositionInput[] = positions.map(p => ({
    ticker: p.ticker, name: p.name, color: p.color, value: p.value,
    actualPct: p.actualPct, targetPct: p.targetPct,
    hardCapPct: p.hardCapPct ?? null, toleranceBand: p.toleranceBand ?? 2.5,
    latestPrice: p.latestPrice ?? 0,
  }))

  // Determine current Bitcoin cycle phase for UI display
  const btcCyclePhase = getBitcoinCyclePhase(new Date())

  const [marketSnapshot, recentExecutions] = await Promise.all([
    getLiveMarketPositions(),
    getRecentExecutions(userId, 1),
  ])

  const ltBreach = worstLookThroughBreach(lookThrough)
  const lookThroughBreach = ltBreach
    ? {
        label: ltBreach.label, pct: ltBreach.pct, hard: ltBreach.hard,
        trimTicker: largestContributor(ltBreach.key, lookThrough.companies.some(c => c.key === ltBreach.key) ? "company" : "sector", positions),
      }
    : undefined

  let portfolioDrawdownPct: number | undefined
  if (historyPoints.length >= 2) {
    let peakIdx = 0
    for (let i = 1; i < historyPoints.length; i++) if (historyPoints[i].value > historyPoints[peakIdx].value) peakIdx = i
    const peak = historyPoints[peakIdx].value
    const current = historyPoints[historyPoints.length - 1].value
    if (peak > 0 && current < peak) portfolioDrawdownPct = ((current - peak) / peak) * 100
  }

  // A look-through exposure over its soft cap but under its hard cap → Step-4 "review, don't
  // sell" warning (non-terminal). Kept distinct from the hard breach, which is a Step-1 trim.
  const ltApproach = worstLookThroughApproach(lookThrough)
  const lookThroughSoftWarning = ltApproach
    ? { label: ltApproach.label, pct: ltApproach.pct, soft: ltApproach.soft }
    : undefined

  // Art. XIII: Decision Ladder
  const ladder = computeLadder(moveInputs, totalValue, {
    market: marketSnapshot.positions,
    lookThroughHardBreach: lookThroughBreach,
    lookThroughSoftWarning,
    portfolioDrawdownPct,
  })

  // Market-aware DCA for holdings table thisMonth column
  const dcaPlan = computeMarketAwareDca(moveInputs, monthlyContribution, { market: marketSnapshot.positions, lookThroughBreach })
  const dcaByTicker = new Map(dcaPlan.allocations.map((a) => [a.ticker, { amount: a.amount, tag: a.tag, reason: a.reason }]))
  const holdingsRows = positions.map((p) => ({
    ticker: p.ticker, name: p.name, color: p.color, units: p.units, value: p.value,
    latestPrice: p.latestPrice ?? 0, priceChangePct: p.priceChangePct, priceHistory: p.priceHistory,
    avgCostUsd: p.avgCostUsd, unrealisedSgd: p.unrealisedSgd, unrealisedPct: p.unrealisedPct,
    actualPct: p.actualPct, targetPct: p.targetPct, toleranceBand: p.toleranceBand ?? 2.5,
    hardCapPct: p.hardCapPct ?? null, status: p.status,
    thisMonth: dcaByTicker.get(p.ticker) ?? null,
    aggregate: false as boolean,
  }))

  // Collapse Bitcoin instruments into one economic sleeve. Instrument history remains
  // separate in storage; the aggregate is reconciled only when every positive row has basis.
  // not, so the row is flagged `aggregate` and the table renders "—" for those cells.
  {
    const bitcoinRows = holdingsRows.filter((r) => ["BTC", "IBIT", "GBTC"].includes(r.ticker))
    if (bitcoinRows.length > 1) {
      const value = bitcoinRows.reduce((sum,r)=>sum+r.value,0)
      const reconciled = bitcoinRows.filter(r=>r.value>0).every(r=>r.unrealisedSgd!==null)
      const unrealisedSgd = reconciled ? bitcoinRows.reduce((sum,r)=>sum+(r.unrealisedSgd ?? 0),0) : null
      const costBasis = reconciled ? bitcoinRows.reduce((sum,r)=>sum+r.value-(r.unrealisedSgd ?? 0),0) : 0
      const unrealisedPct = unrealisedSgd !== null && costBasis > 0 ? (unrealisedSgd / costBasis) * 100 : null
      const sleevePct = bitcoinRows.reduce((sum,r)=>sum+r.actualPct,0)
      const cap = 8
      const status: ActionStatus = sleevePct > cap ? "hard" : Math.abs(sleevePct - BITCOIN_SLEEVE_TARGET_PCT) > 1 ? "soft" : "healthy"
      const sleeve = {
        ticker: "BTC", name: `Bitcoin sleeve · ${bitcoinRows.map(r=>r.ticker).join(" + ")}`, color: bitcoinRows[0].color,
        units: 0, value, latestPrice: 0, priceChangePct: null, priceHistory: [] as number[],
        avgCostUsd: null as number | null, unrealisedSgd, unrealisedPct,
        actualPct: sleevePct, targetPct: BITCOIN_SLEEVE_TARGET_PCT, toleranceBand: 1,
        hardCapPct: cap, status,
        thisMonth: dcaByTicker.get("IBIT") ?? dcaByTicker.get("BTC") ?? null,
        aggregate: true as boolean,
      }
      const rest = holdingsRows.filter((r) => !["BTC", "IBIT", "GBTC"].includes(r.ticker))
      rest.push(sleeve)
      const ord: Record<ActionStatus, number> = { hard: 0, soft: 1, healthy: 2 }
      rest.sort((a, b) => ord[a.status] - ord[b.status])
      holdingsRows.length = 0
      holdingsRows.push(...rest)
    }
  }

  // Compliance Board — band data per position
  const complianceBands: ComplianceBandPosition[] = positions.map((p) => {
    const ht = HARD_THRESHOLDS[p.ticker]
    return {
      ticker: p.ticker, name: p.name, color: p.color, value: p.value,
      actualPct: p.actualPct, targetPct: p.targetPct,
      softLow: Math.max(0, p.targetPct - (p.toleranceBand ?? 2.5)),
      softHigh: p.targetPct + (p.toleranceBand ?? 2.5),
      hardLow: ht?.low,
      hardHigh: p.hardCapPct ?? ht?.high ?? (p.targetPct + 15),
      status: p.status,
    }
  })

  // Show BTC + IBIT as ONE Bitcoin-sleeve row (they are a single 7% position: BTC in
  // run-off, IBIT the accumulation vehicle). Judged on the COMBINED weight vs the 7% target
  // and the cycle-aware cap — not two rows where BTC reads "OK" and IBIT reads "SOFT ↓".
  {
    const btc = complianceBands.find((b) => b.ticker === "BTC")
    const ibit = complianceBands.find((b) => b.ticker === "IBIT")
    if (btc && ibit) {
      const sleevePct = btc.actualPct + ibit.actualPct
      const band = 1  // Art. VIII healthy range 6–8% (target 7 ± 1)
      const cap = HARD_THRESHOLDS["IBIT"]?.high ?? 8
      const sleeve: ComplianceBandPosition = {
        ticker: "BTC", name: "Bitcoin sleeve · BTC + IBIT", color: btc.color,
        value: btc.value + ibit.value,
        actualPct: sleevePct, targetPct: BITCOIN_SLEEVE_TARGET_PCT,
        softLow: Math.max(0, BITCOIN_SLEEVE_TARGET_PCT - band),
        softHigh: BITCOIN_SLEEVE_TARGET_PCT + band,
        hardLow: undefined,
        hardHigh: cap,
        status: sleevePct > cap ? "hard" : Math.abs(sleevePct - BITCOIN_SLEEVE_TARGET_PCT) > band ? "soft" : "healthy",
      }
      const rest = complianceBands.filter((b) => b.ticker !== "BTC" && b.ticker !== "IBIT")
      rest.push(sleeve)
      const ord: Record<ActionStatus, number> = { hard: 0, soft: 1, healthy: 2 }
      rest.sort((a, b) => ord[a.status] - ord[b.status])
      complianceBands.length = 0
      complianceBands.push(...rest)
    }
  }

  const usSitedValueUsd = usdSgdRate > 0
    ? positions.filter(p => isActuallyUsSited(p.ticker)).reduce((s, p) => s + p.value / usdSgdRate, 0)
    : 0
  const outOfScopeTickers = positions.filter((p) => p.value > 0 && !isInScope(p.ticker)).map((p) => p.ticker.toUpperCase())
  const govAlignment = evaluateGovernance({ positions, bufferPct: 0, lookThrough, usSitedValueUsd })

  const dealingWindow = dealingWindowStatus(today)

  const updateHoldings = holdings.map((h) => ({
    id: h.id, ticker: h.ticker, name: h.name,
    latestUnits: h.snapshots[0]?.units ?? 0, latestPrice: h.snapshots[0]?.price ?? 0,
  }))

  // Outside-Atlas award card rows (display-only; `editable` is decided by the caller
  // from the session). Values in USD with an SGD gross rider at the live rate.
  const awardPipeline = await getAwardPipeline(userId)
  const awardCard: AwardCardData | null = awardPipeline
    ? {
        label: awardPipeline.award.label,
        ticker: awardPipeline.award.ticker,
        priceUsd: awardPipeline.priceUsd,
        priceIsLive: awardPipeline.priceIsLive,
        taxRatePct: awardPipeline.award.taxRatePct,
        vests: awardPipeline.vests.map((v) => ({
          dateLabel: v.date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }),
          units: v.units,
          grossUsd: v.grossUsd,
          afterTaxUsd: v.afterTaxUsd,
          grossSgd: convert(money(v.grossUsd, "USD"), "SGD", usdSgdRate).amount,
        })),
        nextVestDays: awardPipeline.vests.length
          ? Math.max(0, Math.ceil((awardPipeline.vests[0].date.getTime() - Date.now()) / 86_400_000))
          : null,
        tranchesRaw: awardPipeline.award.tranches,
      }
    : null

  return {
    totalValue, hasBalance, positions, holdingsRows, driftAlerts, maxDrift,
    activeRules, totalRules, snapshotAgeDays, health, hardBreaches, softBreaches,
    donutData, daysSinceUpdate, latestSnapshotDate: latestSnapshotDate?.toISOString() ?? null,
    base2045, baseRate: rates.base, yearsTo2045, daysToContribution, nextContributionLabel, historyPoints,
    valueChange, monthlyContribution, annualLumpSum, usdSgdRate, onTrackPct,
    marketStale: marketSnapshot.stale,
    govAlignment, outOfScopeTickers, updateHoldings,
    complianceBands, ladder, dealingWindow,
    lastDone: recentExecutions[0] ?? null,
    cashBankBalance: cashBank?.balance ?? 0,
    btcCyclePhase,
    awardCard,
  }
}

export default async function Dashboard() {
  try {
    const session = await getSession()
    if (!session) redirect("/login?portfolio=atlas-core")

    const active = await activePortfolioContext(session)
    if (active.constitutionId === "silicon-brick-road") {
      return <SbrDashboard userId={active.owner.id} name={session.name} isAdmin={session.role === "admin"} />
    }

    const d = await getDashboardData(active.owner.id)
    const canMutateOwner = session.role === "admin" || session.userId === active.owner.id

    const costedRows = d.holdingsRows.filter((p) => p.unrealisedSgd !== null)
    const totalCostBasis = costedRows.reduce((sum, p) => sum + p.value - (p.unrealisedSgd ?? 0), 0)
    const costedMarketValue = costedRows.reduce((sum,p)=>sum+p.value,0)
    const valuationComplete = d.holdingsRows.filter(p=>p.value>0).every(p=>p.unrealisedSgd!==null)
    const totalUnrealised = totalCostBasis > 0 && valuationComplete ? costedMarketValue - totalCostBasis : null
    const totalReturnPct = totalCostBasis > 0 && totalUnrealised !== null ? (totalUnrealised / totalCostBasis) * 100 : null

    return (
    <Shell title="Cockpit" subtitle="Atlas Core — Constitution v10.6" userName={session.name} isAdmin={session.role === "admin"}>

      {/* Toolbar */}
      <div className="mb-5 flex flex-wrap items-start gap-2">
        <RefreshPricesButton />
        <PortfolioUpdateButton label="Update Holdings" holdings={d.updateHoldings} />
        <BitcoinCycleBadge phase={d.btcCyclePhase} />
        {d.dealingWindow.isOpen && (
          <StatusChip status="good" label={`DEALING WINDOW OPEN · CLOSES ${d.dealingWindow.windowClosesLabel}`} className="px-3 py-1.5 font-bold" />
        )}
        {!d.dealingWindow.isOpen && d.dealingWindow.daysUntilOpen !== null && (
          <span className="inline-flex items-center text-[10px] font-semibold px-3 py-1.5 rounded-full border border-border text-muted-foreground">
            WINDOW OPENS IN {d.dealingWindow.daysUntilOpen}d
          </span>
        )}
      </div>

      {/* Stale data warning — semantic tokens (danger ≥7d, warning 3–6d) so the banner
          re-skins with the theme instead of hardcoding the red/amber palette. */}
      {d.hasBalance && d.daysSinceUpdate !== null && d.daysSinceUpdate >= 3 && (
        <a href="/portfolio" className={`mb-5 flex items-center gap-3 rounded-xl border px-5 py-3 transition-colors group ${
          d.daysSinceUpdate >= 7
            ? "border-danger/30 bg-danger/[0.07] hover:bg-danger/[0.11]"
            : "border-warning/30 bg-warning/[0.07] hover:bg-warning/[0.11]"
        }`}>
          <Activity className={`h-4 w-4 shrink-0 ${d.daysSinceUpdate >= 7 ? "text-danger" : "text-warning"}`} />
          <p className={`text-xs flex-1 ${d.daysSinceUpdate >= 7 ? "text-danger" : "text-warning"}`}>
            <span className="font-bold">Prices last updated {d.daysSinceUpdate} day{d.daysSinceUpdate !== 1 ? "s" : ""} ago</span>
            {d.latestSnapshotDate && ` · ${new Date(d.latestSnapshotDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`}
            {d.daysSinceUpdate >= 7 ? " — portfolio values may be significantly out of date." : ""}
          </p>
          <span className={`shrink-0 text-xs font-semibold transition-colors ${d.daysSinceUpdate >= 7 ? "text-danger/70 group-hover:text-danger" : "text-warning/70 group-hover:text-warning"}`}>
            Update now →
          </span>
        </a>
      )}

      {/* Out-of-scope holding alert — warning tokens */}
      {d.hasBalance && d.outOfScopeTickers.length > 0 && (
        <a href="/portfolio" className="mb-5 flex items-center gap-4 rounded-xl border border-warning/40 bg-warning/10 px-5 py-3.5 hover:bg-warning/[0.14] transition-colors group">
          <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
          <div className="flex-1">
            <p className="text-sm font-bold text-warning">
              {d.outOfScopeTickers.join(", ")} {d.outOfScopeTickers.length > 1 ? "are" : "is"} held but not in your plan
            </p>
            <p className="text-xs text-warning/80 mt-0.5">
              Follow the migration: retain IBIT, keep each legacy row and cost basis intact, and use replacement cash only after IBKR confirms settlement.
            </p>
          </div>
          <span className="shrink-0 text-xs font-semibold text-warning/70 group-hover:text-warning transition-colors">Review →</span>
        </a>
      )}

      {/* ── ATLAS FLIGHT DECK — portfolio first, governance second ─────── */}
      <section className="atlas-flightdeck mb-6 overflow-hidden rounded-[28px] border border-violet-400/20">
        <div className="atlas-flightdeck-head">
          <div>
            <p className="atlas-kicker">ATLAS CORE · LIVE PORTFOLIO POSITION</p>
            <h2>Where we are now.</h2>
            <p>Performance, ownership and the next constitution-permitted action in one view.</p>
          </div>
          <div className="atlas-freshness">
            <span className={d.daysSinceUpdate !== null && d.daysSinceUpdate > 3 ? "warn" : "ok"} />
            {d.daysSinceUpdate === null ? "Awaiting first sync" : `IBKR snapshot · ${d.daysSinceUpdate === 0 ? "today" : `${d.daysSinceUpdate}d old`}`}
          </div>
        </div>

        <div className="atlas-flightdeck-grid">
          <div className="atlas-value-bay">
            <p className="atlas-kicker">TOTAL PORTFOLIO VALUE</p>
            <strong className="atlas-total"><AnimatedNumber value={d.totalValue} currency="SGD" /></strong>
            <div className="atlas-value-stats">
              <div><span>Cost basis</span><b>{valuationComplete && totalCostBasis > 0 ? formatCurrency(totalCostBasis, "SGD") : "Needs reconciliation"}</b></div>
              <div><span>Unrealised P&amp;L</span><b className={totalUnrealised !== null && totalUnrealised < 0 ? "down" : "up"}>{totalUnrealised === null ? "—" : `${totalUnrealised >= 0 ? "+" : "−"}${formatCurrency(Math.abs(totalUnrealised), "SGD")}`}</b></div>
              <div><span>Unrealised return</span><b className={totalReturnPct !== null && totalReturnPct < 0 ? "down" : "up"}>{totalReturnPct === null ? "Needs reconciliation" : `${totalReturnPct >= 0 ? "+" : ""}${totalReturnPct.toFixed(1)}%`}</b></div>
            </div>
            <div className="atlas-command-line">
              <span>CONSTITUTION SAYS</span>
              <b>{d.ladder.headline}</b>
              <p>{d.ladder.instruction}</p>
            </div>
          </div>

          <div className="atlas-chart-bay">
            <div className="atlas-panel-title"><div><span>PERFORMANCE</span><b>Portfolio value history</b></div>{d.valueChange !== null && <strong className={d.valueChange >= 0 ? "up" : "down"}>{d.valueChange >= 0 ? "+" : "−"}{formatCurrency(Math.abs(d.valueChange), "SGD")}</strong>}</div>
            {d.historyPoints.length >= 2 ? <PortfolioHistoryChart data={d.historyPoints} /> : <div className="atlas-empty-chart"><Activity /><span>Performance history will appear after two complete IBKR snapshots.</span></div>}
          </div>

          <Link href="/portfolio" className="atlas-orbit-bay">
            <div className="atlas-panel-title"><div><span>POSITION</span><b>Actual versus target</b></div><em>Open portfolio →</em></div>
            <AllocationDonut data={d.donutData} totalValue={d.totalValue} currency="SGD" />
          </Link>
        </div>

        <div className="atlas-flightdeck-foot">
          {/* Art. XIII plan figures are USD (owner setting is stored in USD); reporting stays SGD,
              so the SGD equivalent at the live rate rides along via the one convert() boundary. */}
          <div><span>Next contribution</span><b>{d.nextContributionLabel} · {formatCurrency(d.monthlyContribution, "USD")} ≈ {formatCurrency(convert(money(d.monthlyContribution, "USD"), "SGD", d.usdSgdRate).amount, "SGD")}</b></div>
          <div><span>DCA cash bank</span><b>{formatCurrency(d.cashBankBalance, "SGD")}</b></div>
          <div><span>Portfolio health</span><b>{d.health.overall}/100 · {d.health.overallLabel}</b></div>
          <div><span>2045 base case</span><b>{d.base2045 >= 1_000_000 ? `S$${(d.base2045 / 1_000_000).toFixed(1)}M` : `S$${(d.base2045 / 1_000).toFixed(0)}K`}</b></div>
        </div>
      </section>

      <div className="grid gap-5">
        <div className="space-y-5 min-w-0 reveal-stack">

          {/* ── COMPLIANCE COCKPIT ────────────────────────────────────── */}
          {/* 1. Decision Ladder — the single instruction (Art. XIII), first on the page */}
          <section className="atlas-command-band"><div><span>WHAT TO DO</span><h2>{d.ladder.headline}</h2><p>{d.ladder.instruction}</p></div><Link href="/mission-control?portfolio=atlas-core">Open Mission Control →</Link></section>

          {/* 2. Governance Seal — constitution health */}
          <section className="atlas-command-band"><div><span>WHY</span><h2>{d.ladder.rationale}</h2><p>Governance {d.health.overall}/100 · oldest portfolio snapshot {d.snapshotAgeDays <= 1 ? "current" : `${d.snapshotAgeDays} days old`}.</p></div><Link href="/governance">Read constitution →</Link></section>

          {/* 3. Compliance Board — position bands */}
          <section className="atlas-command-band"><div><span>WHERE WE ARE GOING</span><h2>2045 disciplined accumulation</h2><p>Target VWRA 70 · EQAC 10 · SMH 5 · IBIT 5 · DBMFE 10. Legacy instruments remain visible until sales settle.</p></div><Link href="/forecast">Open forecast →</Link></section>

          <section className="deck-ledger" aria-labelledby="atlas-ledger-title"><div className="deck-ledger-head"><div><span>TARGET POSITION LEDGER</span><h2 id="atlas-ledger-title">Current target holdings</h2><p>Closed and migrating instruments remain in Activity, not in this target view.</p></div><Link href="/portfolio">Open history and activity →</Link></div><div className="deck-ledger-scroll"><table><thead><tr><th>Asset</th><th>Allocation</th><th>Units</th><th>Current price</th><th>Market value</th><th>Cost basis</th><th>Unrealised P/L</th></tr></thead><tbody>{d.holdingsRows.filter(row=>["VWRA","EQAC","SMH","BTC","IBIT","DBMFE"].includes(row.ticker)).map(row=>{const basis=row.unrealisedSgd===null?null:row.value-row.unrealisedSgd;return <tr key={row.ticker}><td><b>{row.ticker}</b><small>{row.name}</small></td><td>{row.actualPct.toFixed(1)}%</td><td>{row.aggregate?"—":row.units.toLocaleString("en-SG",{maximumFractionDigits:4})}</td><td>{row.aggregate||!(row.units>0&&row.value>0)?"—":formatCurrency(row.value/row.units,"SGD")}</td><td><b>{formatCurrency(row.value,"SGD")}</b></td><td>{basis===null?"Needs reconciliation":formatCurrency(basis,"SGD")}</td><td className={row.unrealisedSgd!==null&&row.unrealisedSgd<0?"down":"up"}>{row.unrealisedSgd===null?"—":`${row.unrealisedSgd>=0?"+":"−"}${formatCurrency(Math.abs(row.unrealisedSgd),"SGD")}`}</td></tr>})}</tbody></table></div></section>

          {/* ── WHAT YOU OWN ─────────────────────────────────────────── */}
          <Link href="/reports" className="group flex items-center gap-3 rounded-2xl border border-border bg-card/75 backdrop-blur-md px-5 py-4 card-elevated hover:bg-accent/40 hover:border-violet-500/30 hover:-translate-y-0.5 transition-all">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10 shrink-0">
              <FileBarChart2 className="h-4 w-4 text-violet-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold">What You Own — Full Report</p>
              <p className="text-xs text-muted-foreground">Look-through · concentration · governance compliance · health scorecard · PDF export</p>
            </div>
            <span className="text-xs font-semibold text-muted-foreground/60 group-hover:text-violet-500 transition-colors shrink-0">Open →</span>
          </Link>

          {/* ── OUTSIDE ATLAS — employer RSU pipeline (never NAV) ─────── */}
          <ExternalAwardCard data={d.awardCard} editable={canMutateOwner} />

        </div>

      </div>
    </Shell>
    )
  } finally {
    clearFxCache()
  }
}
