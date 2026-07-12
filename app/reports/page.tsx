import { Shell } from "@/components/shell"
import { db } from "@/lib/db"
import { formatCurrency, formatPercent } from "@/lib/utils"
import {
  AlertTriangle, CheckCircle2, TrendingUp, Activity, XCircle,
  ShieldCheck, Globe, Layers, BarChart3, FileText, Zap, Info,
} from "lucide-react"
import { getSession } from "@/lib/session"
import { redirect } from "next/navigation"
import { computePortfolioHealth } from "@/lib/health"
import { ExposureBarChart, type ExposureBar } from "@/components/charts/exposure-bar-chart"
import { AllocationDonut } from "@/components/charts/allocation-donut"
import { ExportPdfButton } from "@/components/reports/export-pdf-button"
import { RefreshLookThroughButton } from "@/components/reports/refresh-look-through-button"
import { DownloadReportCard } from "@/components/reports/download-report-card"
import { SbrReportPage } from "@/components/reports/sbr-report-page"
import {
  ETF_COMPANY_WEIGHTS, ETF_SECTOR_WEIGHTS, ETF_GEO_WEIGHTS,
  LOOKTHROUGH_COMPANY_CAPS, LOOKTHROUGH_SECTOR_CAPS, ETF_WEIGHTS_AS_OF,
} from "@/lib/look-through"
import { HARD_THRESHOLDS, applyBitcoinSleeve } from "@/lib/constants"
import { ATLAS_SPEC } from "@/lib/portfolio-spec"
import {
  ATLAS_TARGET_HHI_PCT, ATLAS_TARGET_EFF_N,
  ATLAS_HHI_THRESHOLDS, ATLAS_EFF_N_THRESHOLDS,
  atlasConcentrationLabelPct,
} from "@/lib/spec-derived"
import { constitutionIdForEmail } from "@/lib/constitutions"

// ─── Single source of truth ──────────────────────────────────────────────────
// Weights and caps live in lib/look-through.ts (which matches the Governance Doc §4
// and feeds the engine). Reports reads from there — no separate, contradictory copy.
const COMPANY_WEIGHTS = ETF_COMPANY_WEIGHTS
const SECTOR_WEIGHTS  = ETF_SECTOR_WEIGHTS
const GEO_WEIGHTS     = ETF_GEO_WEIGHTS
const COMPANY_CAPS    = LOOKTHROUGH_COMPANY_CAPS

// Adapter: Reports refers to caps as elevated/excessive; map them to the shared soft/hard.
const SECTOR_CAPS = Object.fromEntries(
  Object.entries(LOOKTHROUGH_SECTOR_CAPS).map(([k, v]) => [k, { label: v.label, elevated: v.soft, excessive: v.hard }])
) as Record<"semiconductor" | "digital" | "us" | "ai", { label: string; elevated: number; excessive: number }>

// Date the hardcoded ETF look-through weights were last reviewed — sourced from the single
// as-of constant in lib/look-through.ts so the fallback weights and their staleness signal
// can't drift apart. (Live DB look-through records, when present, override this per-record.)
const LOOK_THROUGH_LAST_REVIEWED = new Date(ETF_WEIGHTS_AS_OF)
const LOOK_THROUGH_STALE_DAYS = 90

// Pairwise overlap data (approximate % of ETF-A that is shared with ETF-B, weighted)
const OVERLAP_MATRIX: Record<string, Record<string, number>> = {
  IMID: { IMID: 100, IWQU: 70, EQAC: 28, SMH: 7, BTC: 0 },
  IWQU: { IMID: 70, IWQU: 100, EQAC: 30, SMH: 6, BTC: 0 },
  EQAC: { IMID: 28, IWQU: 30, EQAC: 100, SMH: 22, BTC: 0 },
  SMH:  { IMID: 7, IWQU: 6, EQAC: 22, SMH: 100, BTC: 0 },
  BTC:  { IMID: 0, IWQU: 0, EQAC: 0, SMH: 0, BTC: 100 },
}

// ─── Data Fetching ─────────────────────────────────────────────────────────────

async function getReportData(userId: string) {
  const [holdings, lookThroughRecords] = await Promise.all([
    db.holding.findMany({
      where: { userId },
      include: {
        snapshots: { orderBy: { date: "desc" }, take: 5 }, // last 5 for drift history
      },
    }),
    db.etfLookThrough.findMany(),
  ])

  // Build live look-through maps — DB data wins over hardcoded fallbacks
  const liveCompanyWeights = { ...COMPANY_WEIGHTS }
  const liveSectorWeights  = { ...SECTOR_WEIGHTS }
  const liveGeoWeights     = { ...GEO_WEIGHTS }
  let   lookThroughUpdatedAt: Date | null = null

  for (const lt of lookThroughRecords) {
    try {
      const dbCw = JSON.parse(lt.companyWeights) as Record<string, number>
      const dbSw = JSON.parse(lt.sectorWeights)  as { semiconductor: number; digital: number; us: number; ai: number }
      const dbGw = JSON.parse(lt.geoWeights)     as { us: number; intlDev: number; emerging: number; crypto: number }

      const fallbackSw = SECTOR_WEIGHTS[lt.ticker]
      const fallbackGw = GEO_WEIGHTS[lt.ticker]

      // Quality-check sector weights: if a significant hardcoded weight is zero in the DB,
      // the Yahoo fetch returned empty sectorWeightings — keep the hardcoded fallback instead.
      const sectorLooksBad = fallbackSw && (
        (fallbackSw.semiconductor > 5  && (dbSw.semiconductor ?? 0) === 0) ||
        (fallbackSw.digital       > 20 && (dbSw.digital       ?? 0) === 0)
      )
      if (!sectorLooksBad) liveSectorWeights[lt.ticker] = dbSw

      // Quality-check geo weights: if hardcoded US% is significant but DB shows 0,
      // Yahoo returned no countryWeightings (e.g. VWRA treated like EM-only).
      const geoLooksBad = fallbackGw &&
        fallbackGw.us > 10 && (dbGw.us ?? 0) === 0
      if (!geoLooksBad) liveGeoWeights[lt.ticker] = dbGw

      // Quality-check company weights: if all weights are 0 for a non-BTC ETF,
      // Yahoo returned no holdings — keep hardcoded fallback.
      const cwSum = Object.values(dbCw).reduce((s, v) => s + v, 0)
      if (lt.ticker === "BTC" || cwSum > 0) liveCompanyWeights[lt.ticker] = dbCw

      if (!lookThroughUpdatedAt || lt.updatedAt > lookThroughUpdatedAt) {
        lookThroughUpdatedAt = lt.updatedAt
      }
    } catch {
      // malformed record — skip, keep fallback
    }
  }

  const totalValue = holdings.reduce((sum, h) => sum + (h.snapshots[0]?.value ?? 0), 0)
  const hasBalance = totalValue > 0

  // Treat BTC + IBIT as ONE Bitcoin sleeve (run-off vs accumulation) so drift and the
  // action plan match the engine — otherwise BTC reads "underweight vs 7%" while IBIT
  // reads "overweight vs 0%", two contradictory actions for a single 7% position.
  const actualByTicker = new Map(
    holdings.map((h) => [h.ticker, totalValue > 0 ? ((h.snapshots[0]?.value ?? 0) / totalValue) * 100 : 0])
  )
  const sleeveTargets = new Map(
    applyBitcoinSleeve(
      holdings.map((h) => ({ ticker: h.ticker, actualPct: actualByTicker.get(h.ticker) ?? 0, targetPct: h.targetPct }))
    ).map((p) => [p.ticker, p.targetPct])
  )

  const positions = holdings.map((h) => {
    const latest = h.snapshots[0]
    const value = latest?.value ?? 0
    const actualPct = totalValue > 0 ? (value / totalValue) * 100 : 0
    const targetPct = sleeveTargets.get(h.ticker) ?? h.targetPct
    const drift = Math.abs(actualPct - targetPct)
    const driftPct = actualPct - targetPct
    // Suppress drift/cap alerts when portfolio has no balance (prevents false alarms)
    const outsideBand = hasBalance && drift > h.toleranceBand
    const overCap = hasBalance && h.hardCapPct !== null && actualPct > h.hardCapPct

    // Snapshot history for drift trend
    const history = h.snapshots.map((s) => ({
      date: s.date,
      value: s.value,
    }))

    return {
      ticker: h.ticker,
      name: h.name,
      color: h.color,
      value,
      actualPct,
      targetPct,
      hardCapPct: h.hardCapPct,
      toleranceBand: h.toleranceBand,
      drift,
      driftPct,
      outsideBand,
      overCap,
      history,
      units: latest?.units ?? 0,
      price: latest?.price ?? 0,
      currency: latest?.currency ?? "USD",
      snapshotDate: latest?.date ?? null,
    }
  })

  // Company look-through — uses live DB data where available, else hardcoded fallback
  const companies = Object.keys(COMPANY_CAPS)
  const companyExposure: Record<string, number> = {}
  for (const company of companies) {
    companyExposure[company] = positions.reduce((sum, p) => {
      const etfWeight = liveCompanyWeights[p.ticker]?.[company] ?? 0
      return sum + (p.actualPct / 100) * etfWeight
    }, 0)
  }

  // Sector exposure
  const sectorExposure: Record<string, number> = { semiconductor: 0, digital: 0, us: 0, ai: 0 }
  for (const p of positions) {
    const sw = liveSectorWeights[p.ticker]
    if (sw) {
      sectorExposure.semiconductor += (p.actualPct / 100) * sw.semiconductor
      sectorExposure.digital       += (p.actualPct / 100) * sw.digital
      sectorExposure.us            += (p.actualPct / 100) * sw.us
      sectorExposure.ai            += (p.actualPct / 100) * sw.ai
    }
  }

  // Geographic exposure
  const geoExposure = { us: 0, intlDev: 0, emerging: 0, crypto: 0 }
  for (const p of positions) {
    const gw = liveGeoWeights[p.ticker]
    if (gw) {
      geoExposure.us       += (p.actualPct / 100) * gw.us
      geoExposure.intlDev  += (p.actualPct / 100) * gw.intlDev
      geoExposure.emerging += (p.actualPct / 100) * gw.emerging
      geoExposure.crypto   += (p.actualPct / 100) * gw.crypto
    }
  }

  // Concentration should treat BTC + IBIT as one economic position — same sleeve principle
  // used for the target above, but for measuring combined exposure/dominance rather than the
  // buy target. Splitting one ~7% bet into two rows understates HHI (looks more diversified
  // than reality) and can misidentify the largest/dominant position.
  const btcSleeveActualPct = positions
    .filter((p) => p.ticker === "BTC" || p.ticker === "IBIT")
    .reduce((s, p) => s + p.actualPct, 0)
  const btcSleeveBase = positions.find((p) => p.ticker === "BTC") ?? positions.find((p) => p.ticker === "IBIT")
  const concentrationRows = [
    ...positions.filter((p) => p.ticker !== "BTC" && p.ticker !== "IBIT"),
    ...(btcSleeveBase && btcSleeveActualPct > 0
      ? [{ ...btcSleeveBase, ticker: "BTC + IBIT", name: "Bitcoin Sleeve", actualPct: btcSleeveActualPct }]
      : []),
  ]

  // HHI Concentration Index — thresholds calibrated to the constitutional target allocation,
  // not generic portfolio benchmarks (a 52% VWRA anchor makes generic HHI thresholds impossible to satisfy).
  const hhi = concentrationRows.reduce((sum, p) => sum + Math.pow(p.actualPct / 100, 2), 0)
  const effectiveN = hhi > 0 ? 1 / hhi : 0
  const hhiPct = hhi * 100
  const targetHhi = ATLAS_TARGET_HHI_PCT
  const targetEffN = ATLAS_TARGET_EFF_N
  const concentrationRating = atlasConcentrationLabelPct(hhiPct)

  // Largest position dominance — uses the constitution's rangeHigh, not a hardcoded number
  const topPosition = [...concentrationRows].sort((a, b) => b.actualPct - a.actualPct)[0]
  const topSpec = topPosition ? ATLAS_SPEC.funds.find(f => f.ticker === topPosition.ticker) : undefined
  const topRangeHigh = topSpec ? topSpec.target + topSpec.band : 58
  const topHardCap = topSpec?.hardCap ?? 60

  // Metrics — drift uses the canonical §3 hard-drift triggers from lib/constants
  // (single source of truth; do not redefine a local copy — it drifts out of date).
  const driftAlerts    = positions.filter((p) => p.outsideBand || p.overCap).length
  const maxDrift       = positions.reduce((max, p) => Math.max(max, p.drift), 0)
  const companyBreaches = companies.filter((c) => companyExposure[c] > COMPANY_CAPS[c].soft).length
  const sectorBreaches  = (Object.keys(SECTOR_CAPS) as (keyof typeof SECTOR_CAPS)[]).filter(
    (k) => sectorExposure[k] > SECTOR_CAPS[k].elevated
  ).length
  const hardBreaches   = !hasBalance ? 0 : positions.filter(p => {
    const ht = HARD_THRESHOLDS[p.ticker]
    return p.overCap ||
      (ht?.low !== undefined && p.actualPct < ht.low) ||
      (ht !== undefined && p.actualPct > ht.high)
  }).length
  const softBreaches   = positions.filter(p => {
    const ht = HARD_THRESHOLDS[p.ticker]
    const isHard = p.overCap ||
      (ht?.low !== undefined && p.actualPct < ht.low) ||
      (ht !== undefined && p.actualPct > ht.high)
    return !isHard && p.outsideBand
  }).length
  // Hard cap breaches only — governed concentration within caps is intentional
  const companyHardBreaches = companies.filter((c) => companyExposure[c] >= COMPANY_CAPS[c].hard).length
  const sectorHardBreaches  = (Object.keys(SECTOR_CAPS) as (keyof typeof SECTOR_CAPS)[]).filter(
    (k) => sectorExposure[k] >= SECTOR_CAPS[k].excessive
  ).length

  // Snapshot age
  const latestDate = positions.reduce<Date | null>((latest, p) => {
    const d = p.snapshotDate
    if (!d) return latest
    const dd = new Date(d)
    return latest === null || dd > latest ? dd : latest
  }, null)
  const snapshotAgeDays = latestDate
    ? Math.floor((Date.now() - latestDate.getTime()) / 86_400_000)
    : 999

  const [activeRules, totalRules] = await Promise.all([
    db.governanceRule.count({ where: { active: true } }),
    db.governanceRule.count(),
  ])
  const health = computePortfolioHealth({
    hardBreaches, softBreaches, maxDrift,
    companyHardBreaches, sectorHardBreaches,
    activeRules, totalRules, snapshotAgeDays,
  })
  const healthScore = health.overall

  // Look-through staleness — computed here (server data function) so the current-time read
  // stays out of the component render body.
  const lookThroughRef = lookThroughUpdatedAt ?? LOOK_THROUGH_LAST_REVIEWED
  const lookThroughAgeDays = Math.floor((Date.now() - lookThroughRef.getTime()) / 86_400_000)
  const lookThroughStale = lookThroughAgeDays > LOOK_THROUGH_STALE_DAYS

  return {
    totalValue, hasBalance, positions, companyExposure, sectorExposure, geoExposure,
    health, healthScore, driftAlerts, maxDrift, companyBreaches, sectorBreaches,
    hardBreaches, softBreaches, hhi, hhiPct, effectiveN, concentrationRating, topPosition,
    targetHhi, targetEffN, topRangeHigh, topHardCap,
    lookThroughUpdatedAt, lookThroughAgeDays, lookThroughStale,
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusFor(value: number, soft: number, hard: number): "healthy" | "elevated" | "excessive" {
  if (value >= hard) return "excessive"
  if (value >= soft) return "elevated"
  return "healthy"
}

// Recommend non-overweight tickers with lowest combined exposure to the given sector keys
function bestAlternatives(
  sectors: string[],
  positions: Array<{ ticker: string; driftPct: number }>,
): string {
  type SectorKey = "semiconductor" | "digital" | "us" | "ai"
  const ranked = positions
    .filter(p => p.driftPct <= 0)
    .map(p => ({
      ticker: p.ticker,
      exp: sectors.reduce((s, k) => s + (SECTOR_WEIGHTS[p.ticker]?.[k as SectorKey] ?? 0), 0),
    }))
    .sort((a, b) => a.exp - b.exp)
    .slice(0, 2)
    .map(p => p.ticker)
  if (ranked.length === 0) return "your other holdings"
  if (ranked.length === 1) return ranked[0]
  return `${ranked[0]} or ${ranked[1]}`
}

function StatusBadge({ status, size = "sm", tip }: { status: string; size?: "sm" | "xs"; tip?: string }) {
  const base = size === "xs"
    ? "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold cursor-help"
    : "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold cursor-help"
  if (status === "excessive") return (
    <span className={`${base} bg-red-500/15 text-red-600 dark:text-red-400 ring-1 ring-red-500/25`} title={tip ?? "Over the hard limit — stop adding to ETFs that hold this company or sector until the level drops."}>
      <XCircle className="h-2.5 w-2.5" /> Excessive
    </span>
  )
  if (status === "elevated") return (
    <span className={`${base} bg-amber-500/15 text-amber-700 dark:text-amber-400 ring-1 ring-amber-400/25`} title={tip ?? `Approaching the warning limit — keep an eye on this. Redirect next contributions to VWRA or VFEA.`}>
      <AlertTriangle className="h-2.5 w-2.5" /> Elevated
    </span>
  )
  return (
    <span className={`${base} bg-green-500/10 text-green-600 dark:text-green-400 ring-1 ring-green-500/20`} title={tip ?? `Within normal limits — no action needed.`}>
      <CheckCircle2 className="h-2.5 w-2.5" /> Healthy
    </span>
  )
}

function SectionHeader({ icon: Icon, title, sub, badge }: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  sub: string
  badge?: React.ReactNode
}) {
  return (
    <div className="px-5 py-4 border-b border-border flex items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        <div className="shrink-0 flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10">
          <Icon className="h-4 w-4 text-violet-500" />
        </div>
        <div>
          <h2 className="text-sm font-bold">{title}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
        </div>
      </div>
      {badge}
    </div>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default async function Reports() {
  const session = await getSession()
  if (!session) redirect("/login")
  // SBR users get their own dedicated report surface — look-through is Atlas-specific.
  if (constitutionIdForEmail(session.email) === "silicon-brick-road") {
    return <SbrReportPage userId={session.userId} userName={session.name ?? ""} isAdmin={session.role === "admin"} />
  }

  const {
    totalValue, hasBalance, positions, companyExposure, sectorExposure, geoExposure,
    health, healthScore, driftAlerts, maxDrift, companyBreaches, sectorBreaches,
    hardBreaches, hhi, hhiPct, effectiveN, concentrationRating, topPosition,
    targetHhi, targetEffN, topRangeHigh, topHardCap,
    lookThroughUpdatedAt, lookThroughAgeDays, lookThroughStale,
  } = await getReportData(session.userId)

  if (!hasBalance) {
    return (
      <Shell title="Reports" subtitle="Portfolio analysis and concentration" userName={session.name} isAdmin={session.role === "admin"}>
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card px-8 py-16 text-center">
          <TrendingUp className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-semibold">No portfolio data yet</p>
          <p className="text-xs text-muted-foreground max-w-sm">
            Enter your holdings on the <a href="/portfolio" className="underline font-semibold">Portfolio</a> page to see the look-through analysis, concentration report, and health score.
          </p>
        </div>
      </Shell>
    )
  }

  const reportDate = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
  // Staleness (lookThroughAgeDays / lookThroughStale) is computed in getReportData.
  const snapshotDate = positions[0]?.snapshotDate
    ? new Date(positions[0].snapshotDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : "—"

  const healthColor  = healthScore >= 80 ? "text-green-500" : healthScore >= 65 ? "text-amber-500" : "text-red-500"
  const healthLabel  = health.overallLabel

  const companies   = Object.keys(COMPANY_CAPS) as (keyof typeof COMPANY_CAPS)[]
  const sectorKeys  = Object.keys(SECTOR_CAPS) as (keyof typeof SECTOR_CAPS)[]
  const tickers     = positions.map(p => p.ticker)

  const companyAlerts = companyBreaches
  const sectorAlerts  = sectorBreaches

  // Bar chart data
  const companyBarData: ExposureBar[] = companies.map((c) => ({
    name: c,
    value: companyExposure[c],
    soft: COMPANY_CAPS[c].soft,
    hard: COMPANY_CAPS[c].hard,
    status: statusFor(companyExposure[c], COMPANY_CAPS[c].soft, COMPANY_CAPS[c].hard),
  }))

  const sectorBarData: ExposureBar[] = sectorKeys.map((k) => ({
    name: SECTOR_CAPS[k].label,
    value: sectorExposure[k],
    soft: SECTOR_CAPS[k].elevated,
    hard: SECTOR_CAPS[k].excessive,
    status: statusFor(sectorExposure[k], SECTOR_CAPS[k].elevated, SECTOR_CAPS[k].excessive),
  }))

  // Donut data
  const donutData = positions.map((p) => ({
    ticker: p.ticker, name: p.name, actualPct: p.actualPct,
    targetPct: p.targetPct, color: p.color, value: p.value,
  }))

  // Geographic donut data
  const geoColors = { us: "#6366f1", intlDev: "#8b5cf6", emerging: "#c4b5fd", crypto: "#f59e0b" }
  const geoDonut = [
    { ticker: "US", name: "United States", actualPct: geoExposure.us, targetPct: geoExposure.us, color: geoColors.us, value: totalValue * geoExposure.us / 100 },
    { ticker: "Intl", name: "Intl Developed", actualPct: geoExposure.intlDev, targetPct: geoExposure.intlDev, color: geoColors.intlDev, value: totalValue * geoExposure.intlDev / 100 },
    { ticker: "EM", name: "Emerging Markets", actualPct: geoExposure.emerging, targetPct: geoExposure.emerging, color: geoColors.emerging, value: totalValue * geoExposure.emerging / 100 },
    { ticker: "BTC", name: "Crypto", actualPct: geoExposure.crypto, targetPct: geoExposure.crypto, color: geoColors.crypto, value: totalValue * geoExposure.crypto / 100 },
  ].filter(d => d.actualPct > 0)

  // Breach banners
  const excessiveCompanies = companies.filter((c) => companyExposure[c] >= COMPANY_CAPS[c].hard)
  const excessiveSectors   = sectorKeys.filter((k) => sectorExposure[k] >= SECTOR_CAPS[k].excessive)
  const elevatedSectors    = sectorKeys.filter((k) => sectorExposure[k] >= SECTOR_CAPS[k].elevated)

  // Executive summary — auto-generated, plain English
  const summaryPoints: { text: string; severity: "ok" | "warn" | "critical" }[] = []
  if (hardBreaches > 0) summaryPoints.push({ text: `${hardBreaches} holding${hardBreaches > 1 ? "s have" : " has"} drifted far outside its target range — you need to act before your next investment date. See the action plan below.`, severity: "critical" })
  if (companyAlerts > 0) summaryPoints.push({ text: `You own too much of ${companyAlerts} individual compan${companyAlerts > 1 ? "ies" : "y"} (through your ETFs combined). Stop adding to EQQQ and SEMI until this resolves.`, severity: "warn" })
  if (sectorAlerts > 0) summaryPoints.push({ text: `Your portfolio is overexposed to ${sectorAlerts} theme${sectorAlerts > 1 ? "s" : ""} (e.g. semiconductors or tech). Put your next contributions into ${bestAlternatives(elevatedSectors, positions)} instead.`, severity: "warn" })
  if (geoExposure.us > LOOKTHROUGH_SECTOR_CAPS.us.soft) summaryPoints.push({ text: `${geoExposure.us.toFixed(0)}% of your money is tied to the US market — that's more than your plan allows. Shift upcoming purchases toward VWRA and VFEA to re-balance.`, severity: "warn" })
  if (hhiPct > targetHhi + 10) summaryPoints.push({ text: `Your portfolio is more concentrated than it looks — it behaves like you own only ${effectiveN.toFixed(1)} equally-sized positions. Consider spreading contributions more evenly.`, severity: "warn" })
  if (summaryPoints.length === 0) summaryPoints.push({ text: "Everything looks good — all holdings are within their target ranges and no limits have been breached. Keep following your standard monthly plan.", severity: "ok" })
  summaryPoints.push({ text: `Overall health score: ${healthScore}/100 (${healthLabel}). Last prices recorded: ${snapshotDate}.`, severity: healthScore >= 80 ? "ok" : healthScore >= 60 ? "warn" : "critical" })

  return (
    <Shell title="Reports" subtitle="Portfolio and look-through risk · Constitution v3.1" userName={session.name} isAdmin={session.role === "admin"}>

      {/* ── Print-only cover page ── hidden on screen, rendered in PDF ── */}
      <div className="print-header hidden">

        {/* Eyebrow + title */}
        <p className="ph-eyebrow">Atlas Core · Diversified Growth Architecture · v3.1</p>
        <h1>Annual Portfolio Report</h1>
        <p className="ph-sub">{reportDate} &nbsp;·&nbsp; Personal &amp; Confidential</p>

        <hr className="ph-divider" />

        {/* Key metrics strip */}
        <div className="ph-metrics">
          <div className="ph-metric">
            <p className="ph-metric-label">Total Value</p>
            <p className="ph-metric-value">{formatCurrency(totalValue, "SGD")}</p>
            <p className="ph-metric-sub">Snapshot {snapshotDate}</p>
          </div>
          <div className="ph-metric">
            <p className="ph-metric-label">Health Score</p>
            <p className={`ph-metric-value ${healthScore >= 80 ? "good" : healthScore >= 65 ? "warn" : "crit"}`}>
              {healthScore}/100
            </p>
            <p className="ph-metric-sub">{health.overallLabel}</p>
          </div>
          <div className="ph-metric">
            <p className="ph-metric-label">Drift Alerts</p>
            <p className={`ph-metric-value ${driftAlerts > 0 ? "crit" : "good"}`}>{driftAlerts}</p>
            <p className="ph-metric-sub">{hardBreaches} hard breach{hardBreaches !== 1 ? "es" : ""}</p>
          </div>
          <div className="ph-metric">
            <p className="ph-metric-label">Concentration</p>
            <p className={`ph-metric-value ${concentrationRating === "Concentrated" ? "crit" : concentrationRating === "Drifting" ? "warn" : "good"}`}>{concentrationRating}</p>
            <p className="ph-metric-sub">HHI {hhiPct.toFixed(1)}% · {effectiveN.toFixed(1)} eff. positions</p>
          </div>
          <div className="ph-metric">
            <p className="ph-metric-label">US Exposure</p>
            <p className={`ph-metric-value ${geoExposure.us > LOOKTHROUGH_SECTOR_CAPS.us.hard ? "crit" : geoExposure.us > LOOKTHROUGH_SECTOR_CAPS.us.soft ? "warn" : "good"}`}>
              {geoExposure.us.toFixed(0)}%
            </p>
            <p className="ph-metric-sub">hard limit {LOOKTHROUGH_SECTOR_CAPS.us.hard}%</p>
          </div>
          <div className="ph-metric">
            <p className="ph-metric-label">Company Alerts</p>
            <p className={`ph-metric-value ${companyBreaches > 0 ? "warn" : "good"}`}>{companyBreaches}</p>
            <p className="ph-metric-sub">{sectorBreaches} sector alert{sectorBreaches !== 1 ? "s" : ""}</p>
          </div>
        </div>

        {/* Compact holdings table */}
        <table className="ph-table">
          <thead>
            <tr>
              <th style={{ width: "15%" }}>Ticker</th>
              <th style={{ width: "30%", textAlign: "left" }}>Name</th>
              <th>Actual</th>
              <th>Target</th>
              <th>Drift</th>
              <th>Value (SGD)</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {positions.map(p => (
              <tr key={p.ticker}>
                <td style={{ fontWeight: 700 }}>{p.ticker}</td>
                <td style={{ textAlign: "left", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</td>
                <td>{p.actualPct.toFixed(1)}%</td>
                <td>{p.targetPct.toFixed(1)}%</td>
                <td className={p.driftPct > 3 ? "warn" : p.driftPct < -3 ? "warn" : ""}>
                  {p.driftPct >= 0 ? "+" : ""}{p.driftPct.toFixed(1)}%
                </td>
                <td>{formatCurrency(p.value, "SGD")}</td>
                <td className={p.overCap ? "breach" : p.outsideBand ? "warn" : "healthy"}>
                  {p.overCap ? "Hard breach" : p.outsideBand ? "Outside band" : "Healthy"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="ph-footer">
          Generated by Atlas Core · {reportDate} · For personal investment reference only · Not financial advice
        </p>
      </div>

      {/* Screen page header */}
      <div className="no-print flex items-center justify-between mb-5">
        <div>
          <p className="text-xs text-muted-foreground">Generated {reportDate} · Snapshot {snapshotDate}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Holdings data: {lookThroughUpdatedAt
              ? `refreshed ${lookThroughUpdatedAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" })} from Yahoo Finance`
              : "using hardcoded estimates — click Refresh Holdings Data"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <RefreshLookThroughButton lastUpdated={lookThroughUpdatedAt} />
          <ExportPdfButton />
        </div>
      </div>

      {/* Look-through staleness warning */}
      {lookThroughStale && (
        <div className="mb-4 no-print flex items-start gap-3 rounded-xl border border-amber-400/40 bg-amber-400/5 px-4 py-3">
          <Info className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">
              ETF look-through data is {lookThroughAgeDays} days old
            </p>
            <p className="text-[11px] text-amber-700/80 dark:text-amber-400/80 mt-0.5">
              Company and sector exposure weights (COMPANY_WEIGHTS, SECTOR_WEIGHTS) were last reviewed on{" "}
              {LOOK_THROUGH_LAST_REVIEWED.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}.
              ETF compositions drift as funds rebalance. Update the weights in{" "}
              <code className="font-mono text-[10px]">lib/look-through.ts</code> and refresh{" "}
              <code className="font-mono text-[10px]">LOOK_THROUGH_LAST_REVIEWED</code> after reviewing the current fund fact sheets.
            </p>
          </div>
        </div>
      )}

      {/* Alert banners */}
      {excessiveCompanies.length > 0 && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border-2 border-red-500/50 bg-red-500/10 px-5 py-4 glow-red flash-red print-break-avoid">
          <div className="shrink-0 flex h-10 w-10 items-center justify-center rounded-full bg-red-500/20 pulse-red">
            <XCircle className="h-5 w-5 text-red-500" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-extrabold text-red-600 dark:text-red-400 uppercase tracking-wide">
              Over the limit — {excessiveCompanies.join(", ")}
            </p>
            <p className="text-xs text-red-600/80 dark:text-red-400/80 mt-0.5">
              Your combined exposure to {excessiveCompanies.join(" and ")} has crossed the hard limit. Stop buying the ETFs that hold these companies until the levels drop.
            </p>
          </div>
        </div>
      )}
      {excessiveSectors.length > 0 && excessiveCompanies.length === 0 && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-amber-400/50 bg-amber-400/10 px-5 py-4 glow-amber print-break-avoid">
          <div className="shrink-0 flex h-9 w-9 items-center justify-center rounded-full bg-amber-500/20 pulse-amber">
            <AlertTriangle className="h-4.5 w-4.5 text-amber-500" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-amber-700 dark:text-amber-400">
              Theme limit reached — {excessiveSectors.map((k) => SECTOR_CAPS[k].label).join(", ")}
            </p>
            <p className="text-xs text-amber-700/80 dark:text-amber-400/80 mt-0.5">
              Too much of your money is tied to one theme. Redirect your next contributions to {bestAlternatives(excessiveSectors, positions)} to spread the risk.
            </p>
          </div>
        </div>
      )}

      {/* ── BRANDED PDF REPORTS ──────────────────────────────────────────────── */}
      <div className="no-print mb-6">
        <DownloadReportCard endpoint="/api/reports/atlas" accent="violet" />
      </div>

      {/* ── 1. KPI STRIP ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 mb-6 lg:grid-cols-4">
        {[
          { label: "Total Portfolio Value",  value: formatCurrency(totalValue, "SGD"), sub: "SGD · IBKR",           icon: TrendingUp, cls: "" },
          { label: "Portfolio Health",      value: `${healthScore}/100`,              sub: healthLabel,             icon: Activity,  cls: healthColor },
          { label: "Off-Target Holdings",  value: `${driftAlerts}`,                  sub: driftAlerts === 0 ? "All holdings on track" : `${driftAlerts} outside their target range`, icon: AlertTriangle, cls: driftAlerts > 0 ? "text-amber-500" : "text-green-500" },
          { label: "Limit Breaches",       value: `${companyAlerts + sectorAlerts}`, sub: companyAlerts + sectorAlerts === 0 ? "No limits breached" : `${companyAlerts} company · ${sectorAlerts} sector`, icon: ShieldCheck, cls: companyAlerts + sectorAlerts > 0 ? "text-red-500" : "text-green-500" },
        ].map(({ label, value, sub, icon: Icon, cls }) => (
          <div key={label} className="rounded-xl border border-border bg-card p-4 card-elevated flex flex-col gap-3 print-break-avoid">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">{label}</span>
              <Icon className={`h-3.5 w-3.5 ${cls || "text-muted-foreground"}`} />
            </div>
            <div>
              <p className={`text-2xl font-black tracking-tight tabular-nums ${cls}`}>{value}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── 2. EXECUTIVE SUMMARY ─────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card overflow-hidden mb-6 print-break-before print-break-avoid">
        <SectionHeader
          icon={FileText}
          title="What's Happening — Portfolio Summary"
          sub="Art. XXII — Plain-English overview; health score, drift status, and any active alerts"
        />
        <div className="px-5 py-4 space-y-2.5">
          {summaryPoints.map((pt, i) => (
            <div key={i} className={`flex items-start gap-3 rounded-lg px-4 py-3 ${
              pt.severity === "critical" ? "bg-red-500/8 border border-red-500/20" :
              pt.severity === "warn"     ? "bg-amber-500/8 border border-amber-400/20" :
                                          "bg-green-500/5 border border-green-500/15"
            }`}>
              {pt.severity === "critical"
                ? <XCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                : pt.severity === "warn"
                ? <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                : <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
              }
              <p className={`text-xs leading-relaxed ${
                pt.severity === "critical" ? "text-red-700 dark:text-red-300" :
                pt.severity === "warn"     ? "text-amber-700 dark:text-amber-300" :
                                            "text-foreground/80"
              }`}>{pt.text}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Action plan removed — lives on the Dashboard (Decision Ladder) */}

      {/* ── 4. ALLOCATION + DONUT ─────────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-[1fr_300px] mb-6 print-break-before">
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <SectionHeader
            icon={BarChart3}
            title="Where Your Money Is — Allocation vs Target"
            sub={`Art. IV / VII — drift tolerances and hard caps · biggest gap: ${formatPercent(maxDrift, 1, false)}`}
          />
          <div className="divide-y divide-border">
            {positions.map((p) => {
              const status = p.overCap ? "excessive" : p.outsideBand ? "elevated" : "healthy"
              const rowAccent = p.overCap
                ? "border-l-4 border-red-500 bg-red-500/[0.02]"
                : p.outsideBand
                ? "border-l-[3px] border-amber-400 bg-amber-500/[0.02]"
                : "border-l-4 border-transparent"
              return (
                <div key={p.ticker} className={`px-5 py-3.5 flex items-center gap-4 ${rowAccent} print-break-avoid`}>
                  <div className="flex items-center gap-2 w-20 shrink-0">
                    <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: p.color, boxShadow: `0 0 6px ${p.color}60` }} />
                    <span className="text-xs font-extrabold">{p.ticker}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] text-muted-foreground truncate max-w-[160px]">{p.name}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs font-bold tabular-nums">{formatPercent(p.actualPct, 1, false)}</span>
                        <span className="text-[11px] text-muted-foreground">/ {formatPercent(p.targetPct, 1, false)}</span>
                        <span className={`text-xs font-bold tabular-nums ${p.driftPct > 0 ? "text-amber-500" : p.driftPct < 0 ? "text-blue-400" : "text-muted-foreground"}`}>
                          {p.driftPct > 0 ? "+" : ""}{p.driftPct.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="relative h-2 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full bar-fill" style={{ width: `${Math.min(100, p.actualPct / 0.7)}%`, backgroundColor: p.color }} />
                      </div>
                      <div className="relative h-1 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full opacity-35" style={{ width: `${Math.min(100, p.targetPct / 0.7)}%`, backgroundColor: p.color }} />
                      </div>
                    </div>
                  </div>
                  <div className="shrink-0 text-right w-24">
                    <p className="text-xs font-bold">{formatCurrency(p.value, "SGD")}</p>
                    <p className="text-[10px] text-muted-foreground">{p.units.toFixed(2)} @ ${p.price.toFixed(2)}</p>
                  </div>
                  <div className="shrink-0">
                    <StatusBadge status={status} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5 card-elevated self-start print-break-avoid">
          <h2 className="text-sm font-bold mb-0.5">Allocation Chart</h2>
          <p className="text-[11px] text-muted-foreground mb-3">Outer = actual · Inner = target</p>
          <AllocationDonut data={donutData} totalValue={totalValue} />
        </div>
      </div>

      {/* ── 5. CONCENTRATION ANALYSIS ────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card overflow-hidden mb-6 print-break-before print-break-avoid">
        <SectionHeader
          icon={Layers}
          title="How Spread Out Is Your Portfolio?"
          sub="Art. IX — concentration index (HHI); hard limit: single company 13%, single sector 40%"
          badge={
            <span className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-bold ${
              concentrationRating === "Concentrated" ? "bg-red-500/10 text-red-500" :
              concentrationRating === "Drifting"     ? "bg-amber-500/10 text-amber-500" :
              "bg-green-500/10 text-green-500"
            }`}>{concentrationRating}</span>
          }
        />
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-border border-b border-border">
          {[
            {
              label: "Spread Score",
              value: hhiPct.toFixed(1),
              unit: "",
              sub: `Target: ${targetHhi.toFixed(1)} — lower = more spread`,
              note: hhiPct < targetHhi + 4 ? "Near target spread" : hhiPct < targetHhi + 10 ? "Drifting from plan" : "Well above target",
              cls: hhiPct < targetHhi + 4 ? "text-green-500" : hhiPct < targetHhi + 10 ? "text-amber-500" : "text-red-500",
            },
            {
              label: "Concentration Density",
              value: effectiveN.toFixed(1),
              unit: "",
              sub: `Target: ${targetEffN.toFixed(1)} effective positions`,
              note: effectiveN >= targetEffN - 0.3 ? "Near target" : effectiveN >= targetEffN - 0.8 ? "More concentrated than plan" : "Well below target",
              cls: effectiveN >= targetEffN - 0.3 ? "text-green-500" : effectiveN >= targetEffN - 0.8 ? "text-amber-500" : "text-red-500",
            },
            {
              label: "Biggest Holding",
              value: topPosition ? topPosition.actualPct.toFixed(1) : "—",
              unit: "%",
              sub: topPosition ? `${topPosition.ticker} — ${topPosition.name}` : "",
              note: topPosition && topPosition.actualPct > topHardCap ? "Above hard cap" : topPosition && topPosition.actualPct > topRangeHigh ? "Above comfortable range" : "Within range",
              cls: topPosition && topPosition.actualPct > topHardCap ? "text-red-500" : topPosition && topPosition.actualPct > topRangeHigh ? "text-amber-500" : "text-green-500",
            },
            {
              label: "Hard Drift Positions",
              value: String(positions.filter(p => { const ht = HARD_THRESHOLDS[p.ticker]; return p.overCap || (ht && (p.actualPct > ht.high || (ht.low !== undefined && p.actualPct < ht.low))) }).length),
              unit: `/ ${positions.length}`,
              sub: "Positions in hard drift territory",
              note: positions.filter(p => { const ht = HARD_THRESHOLDS[p.ticker]; return p.overCap || (ht && (p.actualPct > ht.high || (ht.low !== undefined && p.actualPct < ht.low))) }).length === 0 ? "None — good" : "Review required",
              cls: positions.filter(p => { const ht = HARD_THRESHOLDS[p.ticker]; return p.overCap || (ht && (p.actualPct > ht.high || (ht.low !== undefined && p.actualPct < ht.low))) }).length > 0 ? "text-red-500" : "text-green-500",
            },
          ].map(({ label, value, unit, sub, note, cls }) => (
            <div key={label} className="px-5 py-4">
              <p className="text-xs text-muted-foreground mb-1">{label}</p>
              <p className={`text-2xl font-black tabular-nums ${cls}`}>{value}<span className="text-base font-medium ml-1">{unit}</span></p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>
              <p className={`text-[10px] font-semibold mt-1 ${cls}`}>{note}</p>
            </div>
          ))}
        </div>

        {/* HHI explanation + position breakdown */}
        <div className="px-5 py-4">
          <div className="mb-4 rounded-lg bg-muted/40 border border-border px-4 py-3">
            <p className="text-sm text-muted-foreground leading-relaxed">
              <span className="font-semibold text-foreground">How the spread score works:</span>{" "}
              This score measures how evenly your money is spread across holdings. A score below 10 means you&apos;re well diversified.
              A score above 18 means you&apos;re quite concentrated — your portfolio behaves more like a few big bets than a true spread.
              The Concentration Density tells you how many truly independent positions your portfolio behaves like — even if you own 5 ETFs, they might overlap so much they act like 2–3 positions.
            </p>
          </div>

          {/* Per-position concentration contribution */}
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Concentration Contribution per Position</h3>
          <div className="space-y-2">
            {[...positions].sort((a, b) => b.actualPct - a.actualPct).map((p) => {
              const posHhi = Math.pow(p.actualPct / 100, 2) * 100
              const share  = hhi > 0 ? (posHhi / hhiPct) * 100 : 0
              return (
                <div key={p.ticker} className="flex items-center gap-3">
                  <div className="flex items-center gap-2 w-20 shrink-0">
                    <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: p.color }} />
                    <span className="text-[11px] font-bold">{p.ticker}</span>
                  </div>
                  <div className="flex-1">
                    <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                      <span>{p.actualPct.toFixed(1)}% position weight</span>
                      <span>{posHhi.toFixed(2)} HHI points ({share.toFixed(1)}% of total)</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bar-fill"
                        style={{ width: `${share}%`, backgroundColor: p.color, opacity: 0.8 }}
                      />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* ── 6. GEOGRAPHIC DISTRIBUTION ───────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card overflow-hidden mb-6 print-break-before">
        <SectionHeader
          icon={Globe}
          title="Where in the World Is Your Money?"
          sub="Art. IX — geographic concentration look-through; US soft 70%, hard 80%"
          badge={
            geoExposure.us > LOOKTHROUGH_SECTOR_CAPS.us.soft
              ? <span className="shrink-0 flex items-center gap-1 rounded-lg bg-amber-500/10 border border-amber-400/30 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-3 w-3" /> US elevated
                </span>
              : <span className="shrink-0 flex items-center gap-1 rounded-lg bg-green-500/10 border border-green-500/20 px-2.5 py-1 text-xs font-semibold text-green-600 dark:text-green-400">
                  <CheckCircle2 className="h-3 w-3" /> Within limits
                </span>
          }
        />
        <div className="grid lg:grid-cols-[1fr_280px] divide-y lg:divide-y-0 lg:divide-x divide-border">
          <div className="p-5 space-y-4">
            {[
              { key: "us",       label: "United States",     color: geoColors.us,       cap: LOOKTHROUGH_SECTOR_CAPS.us.soft, capLabel: `soft ${LOOKTHROUGH_SECTOR_CAPS.us.soft}% · hard ${LOOKTHROUGH_SECTOR_CAPS.us.hard}%`, value: geoExposure.us },
              { key: "intlDev",  label: "Intl Developed",    color: geoColors.intlDev,  cap: null, capLabel: "no cap", value: geoExposure.intlDev },
              { key: "emerging", label: "Emerging Markets",  color: geoColors.emerging, cap: null, capLabel: "no cap", value: geoExposure.emerging },
              { key: "crypto",   label: "Crypto (BTC)",      color: geoColors.crypto,   cap: 8,  capLabel: "hard 8% (via BTC cap)", value: geoExposure.crypto },
            ].map(({ label, color, cap, capLabel, value }) => {
              const isElevated = cap !== null && value > cap
              return (
                <div key={label}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                      <span className="text-xs font-semibold">{label}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold tabular-nums ${isElevated ? "text-amber-500" : ""}`}>{value.toFixed(1)}%</span>
                      <span className="text-[10px] text-muted-foreground">{capLabel}</span>
                    </div>
                  </div>
                  <div className="relative h-3 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bar-fill transition-all"
                      style={{ width: `${Math.min(100, value)}%`, backgroundColor: color, opacity: isElevated ? 1 : 0.75 }}
                    />
                    {cap !== null && (
                      <div
                        className="absolute inset-y-0 w-0.5 bg-amber-500/60"
                        style={{ left: `${cap}%` }}
                      />
                    )}
                  </div>
                  {isElevated && (
                    <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5 font-medium">
                      {(value - (cap ?? 0)).toFixed(1)}% above governance limit — redirect contributions to international positions
                    </p>
                  )}
                </div>
              )
            })}

            {/* Source breakdown table */}
            <div className="mt-2">
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Contribution by ETF</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-1.5 pr-3 font-semibold text-muted-foreground">ETF</th>
                      <th className="text-right py-1.5 px-2 font-semibold text-muted-foreground">Weight</th>
                      <th className="text-right py-1.5 px-2 font-semibold text-muted-foreground" style={{ color: geoColors.us }}>US</th>
                      <th className="text-right py-1.5 px-2 font-semibold text-muted-foreground" style={{ color: geoColors.intlDev }}>Intl Dev</th>
                      <th className="text-right py-1.5 px-2 font-semibold text-muted-foreground" style={{ color: geoColors.emerging }}>EM</th>
                      <th className="text-right py-1.5 px-2 font-semibold text-muted-foreground" style={{ color: geoColors.crypto }}>Crypto</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {positions.map((p) => {
                      const gw = GEO_WEIGHTS[p.ticker]
                      if (!gw) return null
                      return (
                        <tr key={p.ticker} className="hover:bg-muted/30 transition-colors">
                          <td className="py-1.5 pr-3 font-extrabold">{p.ticker}</td>
                          <td className="py-1.5 px-2 text-right text-muted-foreground tabular-nums">{p.actualPct.toFixed(1)}%</td>
                          <td className="py-1.5 px-2 text-right tabular-nums">{((p.actualPct / 100) * gw.us).toFixed(1)}%</td>
                          <td className="py-1.5 px-2 text-right tabular-nums">{((p.actualPct / 100) * gw.intlDev).toFixed(1)}%</td>
                          <td className="py-1.5 px-2 text-right tabular-nums">{((p.actualPct / 100) * gw.emerging).toFixed(1)}%</td>
                          <td className="py-1.5 px-2 text-right tabular-nums">{((p.actualPct / 100) * gw.crypto).toFixed(1)}%</td>
                        </tr>
                      )
                    })}
                    <tr className="border-t-2 border-border font-bold bg-muted/20">
                      <td className="py-1.5 pr-3 text-muted-foreground">Total</td>
                      <td className="py-1.5 px-2 text-right text-muted-foreground tabular-nums">100%</td>
                      <td className="py-1.5 px-2 text-right tabular-nums">{geoExposure.us.toFixed(1)}%</td>
                      <td className="py-1.5 px-2 text-right tabular-nums">{geoExposure.intlDev.toFixed(1)}%</td>
                      <td className="py-1.5 px-2 text-right tabular-nums">{geoExposure.emerging.toFixed(1)}%</td>
                      <td className="py-1.5 px-2 text-right tabular-nums">{geoExposure.crypto.toFixed(1)}%</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="p-5 flex flex-col items-center justify-start">
            <p className="text-xs font-bold mb-3 self-start">Geographic Donut</p>
            <AllocationDonut data={geoDonut} totalValue={totalValue} />
          </div>
        </div>
      </div>

      {/* ── 7. ETF OVERLAP MATRIX ────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card overflow-hidden mb-6 print-break-before print-break-avoid">
        <SectionHeader
          icon={Layers}
          title="Do Your ETFs Own the Same Things?"
          sub="Art. IX — pairwise ETF overlap; high overlap inflates concentration beyond the headline weights"
        />
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-5 py-3 text-left font-semibold text-muted-foreground">ETF</th>
                {tickers.map((t) => (
                  <th key={t} className="px-5 py-3 text-center font-semibold text-muted-foreground">{t}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {positions.map((row) => (
                <tr key={row.ticker} className="hover:bg-accent/20 transition-colors">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: row.color }} />
                      <span className="font-extrabold">{row.ticker}</span>
                    </div>
                  </td>
                  {positions.map((col) => {
                    const overlap = OVERLAP_MATRIX[row.ticker]?.[col.ticker] ?? 0
                    const isSelf  = row.ticker === col.ticker
                    const bg = isSelf
                      ? "bg-muted/60"
                      : overlap >= 20 ? "bg-red-500/15" : overlap >= 10 ? "bg-amber-500/10" : "bg-transparent"
                    return (
                      <td key={col.ticker} className={`px-5 py-3 text-center tabular-nums font-semibold ${bg}`}>
                        <span className={
                          isSelf       ? "text-muted-foreground/60" :
                          overlap >= 20 ? "text-red-600 dark:text-red-400" :
                          overlap >= 10 ? "text-amber-600 dark:text-amber-400" :
                          overlap > 0   ? "text-foreground/70" : "text-muted-foreground/40"
                        }>
                          {isSelf ? "—" : `${overlap}%`}
                        </span>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-3 border-t border-border bg-muted/20">
          <div className="flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
            <div className="flex items-center gap-1.5"><div className="h-3 w-5 rounded bg-red-500/15" /><span>High overlap ≥20%</span></div>
            <div className="flex items-center gap-1.5"><div className="h-3 w-5 rounded bg-amber-500/10" /><span>Moderate 10–19%</span></div>
            <div className="flex items-center gap-1.5"><div className="h-3 w-5 rounded bg-muted/60" /><span>Self (100%)</span></div>
            <p className="ml-auto">Estimates based on mandate and published holdings · verify quarterly</p>
          </div>
        </div>
      </div>

      {/* ── 8. COMPANY EXPOSURE ──────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card overflow-hidden mb-6 print-break-before">
        <SectionHeader
          icon={BarChart3}
          title="How Much of Each Company Do You Own?"
          sub="Art. IX — look-through to individual companies; single-company hard limit 13%; soft warning 10%"
          badge={
            companyAlerts > 0
              ? <span className="shrink-0 flex items-center gap-1 rounded-lg bg-amber-500/10 border border-amber-400/30 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-3 w-3" /> {companyAlerts} alert{companyAlerts > 1 ? "s" : ""}
                </span>
              : undefined
          }
        />
        <div className="px-4 py-4 print-chart-wrap">
          <ExposureBarChart data={companyBarData} />
        </div>
        {/* Detail table */}
        <div className="overflow-x-auto border-t border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {["Company", "Exposure", "Soft Cap", "Hard Cap", "Headroom", "Status", "Primary Source"].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {companies.map((company) => {
                const exposure = companyExposure[company]
                const { soft, hard } = COMPANY_CAPS[company]
                const status = statusFor(exposure, soft, hard)
                const headroom = soft - exposure
                // Find primary ETF contributor
                const primaryETF = positions.reduce((best, p) => {
                  const contrib = (p.actualPct / 100) * (COMPANY_WEIGHTS[p.ticker]?.[company] ?? 0)
                  return contrib > best.contrib ? { ticker: p.ticker, contrib } : best
                }, { ticker: "—", contrib: 0 })
                return (
                  <tr key={company} className={`hover:bg-accent/20 transition-colors ${status === "excessive" ? "bg-red-500/[0.02]" : status === "elevated" ? "bg-amber-500/[0.02]" : ""}`}>
                    <td className="px-4 py-2.5 font-bold">{company}</td>
                    <td className={`px-4 py-2.5 font-black tabular-nums ${status === "excessive" ? "text-red-500" : status === "elevated" ? "text-amber-500" : ""}`}>{formatPercent(exposure, 2, false)}</td>
                    <td className="px-4 py-2.5 text-amber-500 tabular-nums">{formatPercent(soft, 0, false)}</td>
                    <td className="px-4 py-2.5 text-red-500 tabular-nums">{formatPercent(hard, 0, false)}</td>
                    <td className={`px-4 py-2.5 tabular-nums font-semibold ${headroom < 0 ? "text-red-500" : headroom < 2 ? "text-amber-500" : "text-green-500"}`}>
                      {headroom >= 0 ? "+" : ""}{headroom.toFixed(1)}%
                    </td>
                    <td className="px-4 py-2.5"><StatusBadge status={status} /></td>
                    <td className="px-4 py-2.5 text-muted-foreground">{primaryETF.contrib > 0 ? primaryETF.ticker : "—"}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 9. SECTOR DEPENDENCY ─────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card overflow-hidden mb-6 print-break-before">
        <SectionHeader
          icon={Activity}
          title="Are You Overexposed to Any Theme?"
          sub="Art. IX / XII — thematic concentration; combined tech ceiling soft 38%, hard 42%"
          badge={
            sectorAlerts > 0
              ? <span className="shrink-0 flex items-center gap-1 rounded-lg bg-amber-500/10 border border-amber-400/30 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-3 w-3" /> {sectorAlerts} alert{sectorAlerts > 1 ? "s" : ""}
                </span>
              : undefined
          }
        />
        <div className="px-4 py-4 print-chart-wrap">
          <ExposureBarChart data={sectorBarData} />
        </div>
        <div className="px-5 pb-5 space-y-3">
          {sectorKeys.map((key) => {
            const { label, elevated, excessive } = SECTOR_CAPS[key]
            const value = sectorExposure[key]
            const status = statusFor(value, elevated, excessive)
            const alt = bestAlternatives([key], positions)
            const responses: Record<string, string> = {
              healthy:   "All good — your exposure to this theme is within normal limits. Keep following your standard plan.",
              elevated:  `Getting close to the limit — keep an eye on this. Put your next contributions into ${alt} instead.`,
              excessive: `Over the limit — stop buying the ETFs that drive this theme (EQQQ and/or SEMI) until this comes down. Redirect contributions to ${alt}.`,
            }
            // Contribution by ETF for this sector
            const contribs = positions.map(p => {
              const sw = SECTOR_WEIGHTS[p.ticker]
              const contrib = sw ? (p.actualPct / 100) * sw[key as keyof typeof sw] : 0
              return { ticker: p.ticker, color: p.color, contrib }
            }).filter(c => c.contrib > 0).sort((a, b) => b.contrib - a.contrib)

            return (
              <div key={key} className={`rounded-xl border p-4 ${status === "excessive" ? "border-red-500/30 bg-red-500/[0.03]" : status === "elevated" ? "border-amber-400/30 bg-amber-500/[0.03]" : "border-border bg-muted/20"} print-break-avoid`}>
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div>
                    <p className="text-sm font-bold">{label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{responses[status]}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={`text-xl font-black tabular-nums ${status === "excessive" ? "text-red-500" : status === "elevated" ? "text-amber-500" : "text-green-500"}`}>
                      {formatPercent(value, 1, false)}
                    </p>
                    <StatusBadge status={status} />
                  </div>
                </div>
                {/* Usage bar */}
                <div className="relative h-2.5 rounded-full bg-muted overflow-hidden mb-2">
                  <div
                    className={`h-full rounded-full bar-fill ${status === "excessive" ? "bg-red-500" : status === "elevated" ? "bg-amber-500" : "bg-violet-500"}`}
                    style={{ width: `${Math.min(100, (value / excessive) * 100)}%`, opacity: 0.8 }}
                  />
                  <div className="absolute inset-y-0 w-0.5 bg-amber-500/70" style={{ left: `${(elevated / excessive) * 100}%` }} />
                </div>
                <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-3">
                  <span>0%</span>
                  <span className="text-amber-500">Elevated {elevated}%</span>
                  <span className="text-red-500">Excessive {excessive}%</span>
                </div>
                {/* ETF breakdown */}
                <div className="flex flex-wrap gap-2">
                  {contribs.map(c => (
                    <div key={c.ticker} className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1">
                      <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: c.color }} />
                      <span className="text-[10px] font-bold">{c.ticker}</span>
                      <span className="text-[10px] text-muted-foreground">{c.contrib.toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── 10. ETF CONTRIBUTION BREAKDOWN ───────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card overflow-hidden mb-6 print-break-before">
        <SectionHeader
          icon={BarChart3}
          title="Which ETF Drives Each Theme?"
          sub="Art. IX — per-ETF contribution to each thematic concentration; identifies which fund to reduce first"
        />
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-5 py-2.5 text-left font-semibold text-muted-foreground">ETF</th>
                <th className="px-5 py-2.5 text-left font-semibold text-muted-foreground">Name</th>
                <th className="px-5 py-2.5 text-right font-semibold text-muted-foreground">Weight</th>
                <th className="px-5 py-2.5 text-right font-semibold text-muted-foreground">Semiconductor</th>
                <th className="px-5 py-2.5 text-right font-semibold text-muted-foreground">Digital</th>
                <th className="px-5 py-2.5 text-right font-semibold text-muted-foreground">US Mkt</th>
                <th className="px-5 py-2.5 text-right font-semibold text-muted-foreground">AI Infra</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {positions.map((p) => {
                const sw = SECTOR_WEIGHTS[p.ticker]
                if (!sw) return null
                const contrib = {
                  semiconductor: (p.actualPct / 100) * sw.semiconductor,
                  digital:       (p.actualPct / 100) * sw.digital,
                  us:            (p.actualPct / 100) * sw.us,
                  ai:            (p.actualPct / 100) * sw.ai,
                }
                return (
                  <tr key={p.ticker} className="hover:bg-accent/20 transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: p.color, boxShadow: `0 0 5px ${p.color}50` }} />
                        <span className="font-extrabold">{p.ticker}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground text-[11px]">{p.name}</td>
                    <td className="px-5 py-3 text-right tabular-nums font-semibold">{formatPercent(p.actualPct, 1, false)}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{formatPercent(contrib.semiconductor, 1, false)}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{formatPercent(contrib.digital, 1, false)}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{formatPercent(contrib.us, 1, false)}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{formatPercent(contrib.ai, 1, false)}</td>
                  </tr>
                )
              })}
              <tr className="border-t-2 border-border bg-muted/30 font-bold">
                <td colSpan={2} className="px-5 py-3 text-muted-foreground">Portfolio Total</td>
                <td className="px-5 py-3 text-right tabular-nums">100.0%</td>
                <td className="px-5 py-3 text-right tabular-nums">{formatPercent(sectorExposure.semiconductor, 1, false)}</td>
                <td className="px-5 py-3 text-right tabular-nums">{formatPercent(sectorExposure.digital, 1, false)}</td>
                <td className="px-5 py-3 text-right tabular-nums">{formatPercent(sectorExposure.us, 1, false)}</td>
                <td className="px-5 py-3 text-right tabular-nums">{formatPercent(sectorExposure.ai, 1, false)}</td>
              </tr>
              <tr className="border-t border-border bg-muted/10 text-muted-foreground text-[10px]">
                <td colSpan={3} className="px-5 py-2">Governance ceiling</td>
                {(["semiconductor","digital","us","ai"] as const).map(k => (
                  <td key={k} className="px-5 py-2 text-right">Soft {SECTOR_CAPS[k].elevated}% / Hard {SECTOR_CAPS[k].excessive}%</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Governance scorecard + summary cards removed — canonical home is the Governance page */}

      {/* Methodology */}
      <div className="rounded-xl border border-border bg-card p-4 print-break-avoid">
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          <span className="font-semibold text-foreground">Methodology.</span>{" "}
          Look-through exposures calculated using approximate ETF holdings data. Geographic exposures derived from fund mandates and published country allocations.
          HHI computed as sum of squared position weights × 100. Effective N = 1/HHI (normalised).
          ETF overlap matrix based on mandate analysis and approximate holdings overlap — verify against fund prospectuses quarterly.
          All caps are governance soft triggers only — thresholds inform contribution routing, not automatic sells.
          Company weights represent recent snapshots and should be verified against fund provider data quarterly.
        </p>
      </div>

    </Shell>
  )
}
