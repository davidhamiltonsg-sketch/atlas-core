import Link from "next/link"
import { Shell } from "@/components/shell"
import { TrendingUp, Activity, AlertTriangle, FileBarChart2 } from "lucide-react"
import { db } from "@/lib/db"
import { formatCurrency } from "@/lib/utils"
import { getSession } from "@/lib/session"
import { AllocationDonut } from "@/components/charts/allocation-donut"
import { PortfolioHistoryChart } from "@/components/charts/portfolio-history-chart"
import { computePortfolioHealth } from "@/lib/health"
import { HealthMethodology } from "@/components/health-methodology"
import { HARD_THRESHOLDS } from "@/lib/constants"
import { computeMarketAwareDca, BITCOIN_SLEEVE_TARGET_PCT, type PositionInput } from "@/lib/next-best-move"
import { computeLadder } from "@/lib/ladder"
import { getLiveMarketPositions } from "@/lib/finnhub"
import { computeLookThrough, worstLookThroughBreach, worstLookThroughApproach, largestContributor } from "@/lib/look-through"
import { evaluateGovernance } from "@/lib/governance-status"
import { GovernanceAlignment } from "@/components/dashboard/governance-alignment"
import { isActuallyUsSited, isInScope } from "@/lib/approved-alternatives"
import { getRecentExecutions } from "@/lib/execution-actions"
import { HoldingsTable } from "@/components/dashboard/holdings-table"
import { RefreshPricesButton } from "@/components/portfolio/refresh-prices-button"
import { PortfolioUpdateButton } from "@/components/portfolio-update-button"
import { CORE_DEFAULTS } from "@/lib/core-holdings"
import { SbrDashboard } from "@/components/sbr/sbr-dashboard"
import { GovernanceSeal, type SealDimension } from "@/components/cockpit/governance-seal"
import { DecisionLadderCard } from "@/components/cockpit/decision-ladder-card"
import { ComplianceBoard, type ComplianceBandPosition } from "@/components/cockpit/compliance-board"
import { AnimatedNumber } from "@/components/animated-number"
import { blendedGrowthRates, projectPortfolio } from "@/lib/forecast"
import { activePortfolioContext } from "@/lib/active-portfolio"
import { openPositionValuation } from "@/lib/valuation"
import { redirect } from "next/navigation"

// This is a personal, auth-gated dashboard whose server render includes live
// date maths (dealing-window and contribution countdowns). Pin it to dynamic so
// a countdown can never be frozen by an accidental static/edge cache.
export const dynamic = "force-dynamic"

// Calendar "today" in the portfolio's home timezone (Singapore — the app trades
// in SGD against an SGD goal). The infra clock is UTC, so a plain `new Date()`
// keeps reading the previous calendar day until 08:00 SGT — which made the
// dealing-window countdown appear stuck a day behind. Anchor every day-count to
// the Singapore wall-clock date instead.
const APP_TZ = "Asia/Singapore"
function sgtToday(): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date())
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  return { y: get("year"), m: get("month") - 1, d: get("day") }
}

// Fallback defaults (overridden by user DB settings)
const DEFAULT_MONTHLY = 3000
const DEFAULT_ANNUAL_LUMP_SUM = 20000
const DEFAULT_GROWTH_RATE = 0.05
const DEFAULT_RISK_FREE_RATE = 0.04

type ActionStatus = "healthy" | "soft" | "hard"

async function getUsdSgdRate(): Promise<number> {
  try {
    const res = await fetch(
      "https://query1.finance.yahoo.com/v8/finance/chart/USDSGD=X?interval=1d&range=1d",
      { headers: { "User-Agent": "Mozilla/5.0" }, next: { revalidate: 3600 } }
    )
    if (res.ok) {
      const d = await res.json()
      const rate = d?.chart?.result?.[0]?.meta?.regularMarketPrice
      if (rate && rate > 0) return rate
    }
  } catch {}
  return 1.35
}

/** Dealing window: opens 3rd business day after the 15th, closes last business day of month. */
function getDealingWindow(today: { y: number; m: number; d: number }): {
  daysUntilOpen: number | null
  windowClosesLabel: string | null
  isOpen: boolean
} {
  const { y, m, d } = today

  // 3rd business day after the 15th
  let count = 0
  let open = new Date(y, m, 15)
  while (count < 3) {
    open = new Date(open.getTime() + 86_400_000)
    if (open.getDay() !== 0 && open.getDay() !== 6) count++
  }

  // Last business day of month
  const last = new Date(y, m + 1, 0)
  while (last.getDay() === 0 || last.getDay() === 6) last.setDate(last.getDate() - 1)

  const todayMs  = new Date(y, m, d).getTime()
  const openMs   = new Date(open.getFullYear(), open.getMonth(), open.getDate()).getTime()
  const closeMs  = new Date(last.getFullYear(), last.getMonth(), last.getDate()).getTime()

  if (todayMs >= openMs && todayMs <= closeMs) {
    return {
      daysUntilOpen: null,
      windowClosesLabel: last.toLocaleDateString("en-GB", { day: "numeric", month: "short" }).toUpperCase(),
      isOpen: true,
    }
  } else if (todayMs < openMs) {
    return {
      daysUntilOpen: Math.round((openMs - todayMs) / 86_400_000),
      windowClosesLabel: null,
      isOpen: false,
    }
  }
  return { daysUntilOpen: null, windowClosesLabel: null, isOpen: false }
}

async function getDashboardData(userId: string) {
  const [user, holdings, usdSgdRate, trades, cashBank] = await Promise.all([
    db.user.findUnique({ where: { id: userId } }),
    db.holding.findMany({
      where: { userId },
      include: { snapshots: { orderBy: { date: "desc" }, take: 8 } },
    }),
    getUsdSgdRate(),
    db.trade.findMany({ where: { userId }, orderBy: { date: "asc" } }),
    db.dcaCashBank.findUnique({ where: { userId_constitutionId_currency: { userId, constitutionId: "atlas-core", currency: "SGD" } } }),
  ])

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

  const positions = holdings.map((h) => {
    const value = h.snapshots[0]?.value ?? 0
    const actualPct = totalValue > 0 ? (value / totalValue) * 100 : 0
    const driftPct = actualPct - h.targetPct
    const absDrift = Math.abs(driftPct)
    const overCap = h.hardCapPct !== null && actualPct > h.hardCapPct
    const ht = HARD_THRESHOLDS[h.ticker]
    const isHardDrift = totalValue > 0 && (overCap ||
      (ht?.low !== undefined && actualPct < ht.low) ||
      (ht !== undefined && actualPct > ht.high))
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
    return { ticker: h.ticker, name: h.name, color: CORE_DEFAULTS[h.ticker]?.color ?? h.color, value, actualPct, targetPct: h.targetPct, driftPct, status, hardCapPct: h.hardCapPct, toleranceBand: h.toleranceBand, latestPrice, priceChangePct, priceHistory, avgCostUsd:valuation.averagePriceInstrumentCurrency, costBasisSgd:valuation.costBasis??0, unrealisedSgd:valuation.reconciles?valuation.unrealizedPnl:null, unrealisedPct:valuation.reconciles?valuation.unrealizedReturnPct:null, valuationSource:valuation.source, valuationReconciles:valuation.reconciles, units: h.snapshots[0]?.units ?? 0 }
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
    if (!d) return latest
    return latest === null || d > latest ? d : latest
  }, null)
  const daysSinceUpdate = latestSnapshotDate
    ? Math.floor((Date.now() - new Date(latestSnapshotDate).getTime()) / 86_400_000)
    : null

  const [activeRules, totalRules] = await Promise.all([
    db.governanceRule.count({ where: { active: true } }),
    db.governanceRule.count(),
  ])
  const snapshotAgeDays = daysSinceUpdate ?? 999
  const lookThrough = computeLookThrough(positions)
  const companyHardBreaches = lookThrough.companies.filter(c => c.status === "breach").length
  const sectorHardBreaches  = lookThrough.sectors.filter(s => s.status === "breach").length
  const health = computePortfolioHealth({ hardBreaches, softBreaches, maxDrift, companyHardBreaches, sectorHardBreaches, activeRules, totalRules, snapshotAgeDays })

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
  const base2045 = projectPortfolio(totalValue, monthlyContribution, annualLumpSum, rates.base, yearsTo2045, contributionGrowthRate)

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

  // Contribution countdown — anchored to the Singapore calendar day (see sgtToday).
  const today = sgtToday()
  const todayMidnight = new Date(today.y, today.m, today.d)
  const day15ThisMonth = new Date(today.y, today.m, 15)
  const nextContribution = todayMidnight < day15ThisMonth
    ? day15ThisMonth
    : new Date(today.y, today.m + 1, 15)
  const daysToContribution = Math.ceil((nextContribution.getTime() - todayMidnight.getTime()) / 86_400_000)
  const nextContributionLabel = nextContribution.toLocaleDateString("en-GB", { day: "numeric", month: "short" })

  const donutData = holdings.map((h) => {
    const value = h.snapshots[0]?.value ?? 0
    const actualPct = totalValue > 0 ? (value / totalValue) * 100 : 0
    return { ticker: h.ticker, name: h.name, actualPct, targetPct: h.targetPct, color: CORE_DEFAULTS[h.ticker]?.color ?? h.color, value }
  }).sort((a, b) => b.actualPct - a.actualPct)

  // Collapse BTC + IBIT into one Bitcoin-sleeve slice (one 7% position).
  {
    const btc = donutData.find((d) => d.ticker === "BTC")
    const ibit = donutData.find((d) => d.ticker === "IBIT")
    if (btc && ibit) {
      const merged = {
        ticker: "BTC", name: "Bitcoin sleeve (BTC + IBIT)",
        actualPct: btc.actualPct + ibit.actualPct, targetPct: BITCOIN_SLEEVE_TARGET_PCT,
        color: btc.color, value: btc.value + ibit.value,
      }
      const rest = donutData.filter((d) => d.ticker !== "BTC" && d.ticker !== "IBIT")
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

  // Collapse BTC + IBIT into a single Bitcoin-sleeve row. Value, cost basis and
  // unrealised P/L are additive across the two vehicles; per-instrument shares/price are
  // not, so the row is flagged `aggregate` and the table renders "—" for those cells.
  {
    const btc = holdingsRows.find((r) => r.ticker === "BTC")
    const ibit = holdingsRows.find((r) => r.ticker === "IBIT")
    if (btc && ibit) {
      const value = btc.value + ibit.value
      const anyCost = btc.unrealisedSgd !== null || ibit.unrealisedSgd !== null
      const unrealisedSgd = anyCost ? (btc.unrealisedSgd ?? 0) + (ibit.unrealisedSgd ?? 0) : null
      const costBasis = (btc.value - (btc.unrealisedSgd ?? 0)) + (ibit.value - (ibit.unrealisedSgd ?? 0))
      const unrealisedPct = anyCost && costBasis > 0 ? (unrealisedSgd! / costBasis) * 100 : null
      const sleevePct = btc.actualPct + ibit.actualPct
      const cap = HARD_THRESHOLDS["IBIT"]?.high ?? 8
      const status: ActionStatus = sleevePct > cap ? "hard" : Math.abs(sleevePct - BITCOIN_SLEEVE_TARGET_PCT) > 1 ? "soft" : "healthy"
      const sleeve = {
        ticker: "BTC", name: "Bitcoin sleeve · BTC + IBIT", color: btc.color,
        units: 0, value, latestPrice: 0, priceChangePct: null, priceHistory: [] as number[],
        avgCostUsd: null as number | null, unrealisedSgd, unrealisedPct,
        actualPct: sleevePct, targetPct: BITCOIN_SLEEVE_TARGET_PCT, toleranceBand: 1,
        hardCapPct: cap, status,
        thisMonth: dcaByTicker.get("IBIT") ?? dcaByTicker.get("BTC") ?? null,
        aggregate: true as boolean,
      }
      const rest = holdingsRows.filter((r) => r.ticker !== "BTC" && r.ticker !== "IBIT")
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

  const dealingWindow = getDealingWindow(today)

  const updateHoldings = holdings.map((h) => ({
    id: h.id, ticker: h.ticker, name: h.name,
    latestUnits: h.snapshots[0]?.units ?? 0, latestPrice: h.snapshots[0]?.price ?? 0,
  }))

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
  }
}

export default async function Dashboard() {
  const session = await getSession()
  if (!session) redirect("/login?portfolio=atlas-core")

  const active = await activePortfolioContext(session)
  if (active.constitutionId === "silicon-brick-road") {
    return <SbrDashboard userId={active.owner.id} name={session.name} isAdmin={session.role === "admin"} />
  }

  const d = await getDashboardData(active.owner.id)

  // Build SealDimension array for GovernanceSeal. Each dimension's raw score is 0–100;
  // the badge shows its WEIGHTED contribution (rawScore/100 × weight) out of that weight,
  // so the four badges sum to the overall score (Art. XXII weights: 40/25/25/10) instead
  // of printing a 0–100 value against a smaller weight cap (e.g. "78/40").
  const weighted = (score: number, weight: number) => Math.round((score / 100) * weight)
  const sealDimensions: SealDimension[] = [
    { label: "Structural",    score: weighted(d.health.structural.score, 40),    maxScore: 40, status: d.health.structural.status,    citation: d.health.structural.citation },
    { label: "Behavioural",   score: weighted(d.health.behavioural.score, 25),   maxScore: 25, status: d.health.behavioural.status,   citation: d.health.behavioural.citation },
    { label: "Concentration", score: weighted(d.health.concentration.score, 25), maxScore: 25, status: d.health.concentration.status, citation: d.health.concentration.citation },
    { label: "Freshness",     score: weighted(d.health.freshness.score, 10),     maxScore: 10, status: d.health.freshness.status,     citation: d.health.freshness.citation },
  ]
  const costedRows = d.holdingsRows.filter((p) => p.unrealisedSgd !== null)
  const totalCostBasis = costedRows.reduce((sum, p) => sum + p.value - (p.unrealisedSgd ?? 0), 0)
  const costedMarketValue = costedRows.reduce((sum,p)=>sum+p.value,0)
  const valuationComplete = d.holdingsRows.filter(p=>p.value>0).every(p=>p.unrealisedSgd!==null)
  const totalUnrealised = totalCostBasis > 0 && valuationComplete ? costedMarketValue - totalCostBasis : null
  const totalReturnPct = totalCostBasis > 0 && totalUnrealised !== null ? (totalUnrealised / totalCostBasis) * 100 : null

  return (
    <Shell title="Cockpit" subtitle="Atlas Core — Constitution v3.1" userName={session.name} isAdmin={session.role === "admin"}>

      {/* Toolbar */}
      <div className="mb-5 flex flex-wrap items-start gap-2">
        <RefreshPricesButton />
        <PortfolioUpdateButton label="Update Holdings" holdings={d.updateHoldings} />
        {d.dealingWindow.isOpen && (
          <span className="inline-flex items-center text-[10px] font-bold px-3 py-1.5 rounded-full border border-green-500/40 bg-green-500/10 text-green-600 dark:text-green-400">
            DEALING WINDOW OPEN · CLOSES {d.dealingWindow.windowClosesLabel}
          </span>
        )}
        {!d.dealingWindow.isOpen && d.dealingWindow.daysUntilOpen !== null && (
          <span className="inline-flex items-center text-[10px] font-semibold px-3 py-1.5 rounded-full border border-border text-muted-foreground">
            WINDOW OPENS IN {d.dealingWindow.daysUntilOpen}d
          </span>
        )}
      </div>

      {/* Stale data warning */}
      {d.hasBalance && d.daysSinceUpdate !== null && d.daysSinceUpdate >= 3 && (
        <a href="/portfolio" className={`mb-5 flex items-center gap-3 rounded-xl border px-5 py-3 transition-colors group ${
          d.daysSinceUpdate >= 7
            ? "border-red-500/30 bg-red-500/[0.07] hover:bg-red-500/[0.11]"
            : "border-amber-400/30 bg-amber-400/[0.07] hover:bg-amber-400/[0.11]"
        }`}>
          <Activity className={`h-4 w-4 shrink-0 ${d.daysSinceUpdate >= 7 ? "text-red-500" : "text-amber-500"}`} />
          <p className={`text-xs flex-1 ${d.daysSinceUpdate >= 7 ? "text-red-600 dark:text-red-400" : "text-amber-700 dark:text-amber-400"}`}>
            <span className="font-bold">Prices last updated {d.daysSinceUpdate} day{d.daysSinceUpdate !== 1 ? "s" : ""} ago</span>
            {d.latestSnapshotDate && ` · ${new Date(d.latestSnapshotDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`}
            {d.daysSinceUpdate >= 7 ? " — portfolio values may be significantly out of date." : ""}
          </p>
          <span className={`shrink-0 text-xs font-semibold transition-colors ${d.daysSinceUpdate >= 7 ? "text-red-500/70 group-hover:text-red-500" : "text-amber-500/70 group-hover:text-amber-500"}`}>
            Update now →
          </span>
        </a>
      )}

      {/* Out-of-scope holding alert */}
      {d.hasBalance && d.outOfScopeTickers.length > 0 && (
        <a href="/portfolio" className="mb-5 flex items-center gap-4 rounded-xl border border-amber-400/40 bg-amber-400/10 dark:bg-amber-400/[0.08] px-5 py-3.5 hover:bg-amber-400/[0.14] transition-colors group">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
          <div className="flex-1">
            <p className="text-sm font-bold text-amber-700 dark:text-amber-400">
              {d.outOfScopeTickers.join(", ")} {d.outOfScopeTickers.length > 1 ? "are" : "is"} held but not in your plan
            </p>
            <p className="text-xs text-amber-700/80 dark:text-amber-400/80 mt-0.5">
              Decide what to do: keep it and set a target, switch to an approved alternative, or sell it.
            </p>
          </div>
          <span className="shrink-0 text-xs font-semibold text-amber-500/70 group-hover:text-amber-500 transition-colors">Review →</span>
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
              <div><span>Cost basis</span><b>{totalCostBasis > 0 ? formatCurrency(totalCostBasis, "SGD") : "Awaiting ledger"}</b></div>
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
          <div><span>Next contribution</span><b>{d.nextContributionLabel} · {formatCurrency(d.monthlyContribution, "SGD")}</b></div>
          <div><span>DCA cash bank</span><b>{formatCurrency(d.cashBankBalance, "SGD")}</b></div>
          <div><span>Portfolio health</span><b>{d.health.overall}/100 · {d.health.overallLabel}</b></div>
          <div><span>2045 base case</span><b>{d.base2045 >= 1_000_000 ? `S$${(d.base2045 / 1_000_000).toFixed(1)}M` : `S$${(d.base2045 / 1_000).toFixed(0)}K`}</b></div>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
        <div className="space-y-5 min-w-0 reveal-stack">

          {/* ── COMPLIANCE COCKPIT ────────────────────────────────────── */}
          {/* 1. Decision Ladder — the single instruction (Art. XIII), first on the page */}
          <DecisionLadderCard
            ladder={d.ladder}
            monthlyContribution={d.monthlyContribution}
            daysToWindow={d.dealingWindow.daysUntilOpen}
            windowClosesLabel={d.dealingWindow.windowClosesLabel}
          />

          {/* 2. Governance Seal — constitution health */}
          <GovernanceSeal
            overall={d.health.overall}
            overallLabel={d.health.overallLabel}
            dimensions={sealDimensions}
            constitutionLabel="Art. XXII · Governance Score"
            narrative={
              d.hasBalance
                ? `${d.hardBreaches > 0 ? d.hardBreaches + " hard breach" + (d.hardBreaches > 1 ? "es" : "") + " require immediate action. " : ""}${d.softBreaches > 0 ? d.softBreaches + " position" + (d.softBreaches > 1 ? "s" : "") + " outside tolerance. " : ""}${d.hardBreaches === 0 && d.softBreaches === 0 ? "All positions within bands. " : ""}Snapshot age: ${d.snapshotAgeDays <= 1 ? "current" : d.snapshotAgeDays + " days old"}.`
                : "No portfolio balance yet. Enter your holdings to begin tracking."
            }
            href="/governance"
          />

          {/* 3. Compliance Board — position bands */}
          {d.hasBalance && (
            <ComplianceBoard positions={d.complianceBands} totalValue={d.totalValue} />
          )}

          {/* ── WHAT IS HELD ─────────────────────────────────────────── */}
          {d.hasBalance && (
            <HoldingsTable positions={d.holdingsRows} totalValue={d.totalValue} priceStale={d.marketStale} />
          )}

          {/* ── GOVERNANCE & COMPLIANCE ──────────────────────────────── */}
          {d.hasBalance && d.govAlignment && (
            <GovernanceAlignment data={d.govAlignment} />
          )}

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

        </div>

        {/* Right sidebar */}
        <div className="space-y-4 lg:sticky lg:top-4 lg:self-start reveal-stack">

          {/* 2045 goal + contribution countdown */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl card-lux p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">2045 Base Case</p>
              <p className="text-lg font-black tabular-nums gradient-text leading-tight">
                {d.base2045 >= 1_000_000
                  ? `S$${(d.base2045 / 1_000_000).toFixed(1)}M`
                  : `S$${(d.base2045 / 1_000).toFixed(0)}K`}
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">{(d.baseRate * 100).toFixed(1)}% p.a. · {d.yearsTo2045} yr</p>
              <div className="mt-2 h-1 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full bar-brand bar-fill opacity-90" style={{ width: `${d.base2045 > 0 ? Math.min(100, (d.totalValue / d.base2045) * 100) : 0}%` }} />
              </div>
            </div>
            <div className="rounded-2xl card-lux p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Next Contribution</p>
              <p className="text-lg font-black tabular-nums leading-tight">
                {d.daysToContribution === 0 ? "Today" : `${d.daysToContribution}d`}
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">{d.nextContributionLabel} · {formatCurrency(d.monthlyContribution, "SGD")}</p>
              <div className="mt-2 h-1 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full bar-brand bar-fill opacity-90" style={{ width: `${Math.max(5, 100 - (d.daysToContribution / 31) * 100)}%` }} />
              </div>
            </div>
          </div>


          {/* Health methodology */}
          {d.hasBalance && (
            <HealthMethodology
              structural={d.health.structural.score}
              behavioural={d.health.behavioural.score}
              concentration={d.health.concentration.score}
              execution={d.health.freshness.score}
              hardBreaches={d.hardBreaches}
              softBreaches={d.softBreaches}
              maxDrift={d.maxDrift}
              activeRules={d.activeRules}
              totalRules={d.totalRules}
              snapshotAgeDays={d.snapshotAgeDays}
            />
          )}
        </div>
      </div>
    </Shell>
  )
}
