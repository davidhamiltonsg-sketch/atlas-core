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

// ─── Static Data ──────────────────────────────────────────────────────────────

const COMPANY_WEIGHTS: Record<string, Record<string, number>> = {
  VT:   { Nvidia: 2.5, Microsoft: 3.0, Apple: 3.0, Amazon: 2.2, Meta: 1.4, Alphabet: 1.8, Broadcom: 0.9, TSMC: 0.8 },
  QQQM: { Nvidia: 7.0, Microsoft: 8.5, Apple: 9.0, Amazon: 5.5, Meta: 4.5, Alphabet: 4.0, Broadcom: 3.5, TSMC: 0.0 },
  SMH:  { Nvidia: 20.0, Microsoft: 0.0, Apple: 0.0, Amazon: 0.0, Meta: 0.0, Alphabet: 0.0, Broadcom: 8.0, TSMC: 12.0 },
  VWO:  { Nvidia: 0.0, Microsoft: 0.0, Apple: 0.0, Amazon: 0.0, Meta: 0.0, Alphabet: 0.0, Broadcom: 0.0, TSMC: 7.0 },
  BTC:  { Nvidia: 0.0, Microsoft: 0.0, Apple: 0.0, Amazon: 0.0, Meta: 0.0, Alphabet: 0.0, Broadcom: 0.0, TSMC: 0.0 },
}

const SECTOR_WEIGHTS: Record<string, { semiconductor: number; digital: number; us: number; ai: number }> = {
  VT:   { semiconductor: 8,   digital: 35,  us: 62,  ai: 15 },
  QQQM: { semiconductor: 13,  digital: 65,  us: 100, ai: 35 },
  SMH:  { semiconductor: 100, digital: 90,  us: 75,  ai: 70 },
  VWO:  { semiconductor: 12,  digital: 30,  us: 0,   ai: 10 },
  BTC:  { semiconductor: 0,   digital: 0,   us: 0,   ai: 0  },
}

// Geographic exposure by ETF (US / Intl Developed / Emerging / Crypto)
const GEO_WEIGHTS: Record<string, { us: number; intlDev: number; emerging: number; crypto: number }> = {
  VT:   { us: 62,  intlDev: 30, emerging: 8,   crypto: 0 },
  QQQM: { us: 100, intlDev: 0,  emerging: 0,   crypto: 0 },
  SMH:  { us: 75,  intlDev: 13, emerging: 12,  crypto: 0 },
  VWO:  { us: 0,   intlDev: 0,  emerging: 100, crypto: 0 },
  BTC:  { us: 0,   intlDev: 0,  emerging: 0,   crypto: 100 },
}

const COMPANY_CAPS: Record<string, { soft: number; hard: number }> = {
  Nvidia:    { soft: 10, hard: 13 },
  Microsoft: { soft: 10, hard: 13 },
  Apple:     { soft: 8,  hard: 11 },
  Amazon:    { soft: 7,  hard: 9  },
  Meta:      { soft: 6,  hard: 8  },
  Alphabet:  { soft: 6,  hard: 8  },
  Broadcom:  { soft: 5,  hard: 7  },
  TSMC:      { soft: 5,  hard: 7  },
}

// v5.8 cluster caps (Section 4.2) — "elevated" = soft cap, "excessive" = hard cap
const SECTOR_CAPS = {
  semiconductor: { label: "Semiconductor & Compute", elevated: 28, excessive: 35 },
  digital:       { label: "Digital Economy",         elevated: 55, excessive: 65 },
  us:            { label: "US Equity Dependency",    elevated: 70, excessive: 80 },
  ai:            { label: "AI Infrastructure",       elevated: 20, excessive: 28 },
}

// Date the ETF look-through weights (COMPANY_WEIGHTS, SECTOR_WEIGHTS, GEO_WEIGHTS) were last reviewed.
// Update this whenever you re-check the ETF composition data against the fund fact sheets.
const LOOK_THROUGH_LAST_REVIEWED = new Date("2026-01-01")
const LOOK_THROUGH_STALE_DAYS = 90

// Pairwise overlap data (approximate % of ETF-A that is shared with ETF-B, weighted)
const OVERLAP_MATRIX: Record<string, Record<string, number>> = {
  VT:   { VT: 100, QQQM: 28, SMH: 7,  VWO: 8,  BTC: 0 },
  QQQM: { VT: 28,  QQQM: 100,SMH: 22, VWO: 0,  BTC: 0 },
  SMH:  { VT: 7,   QQQM: 22, SMH: 100,VWO: 1,  BTC: 0 },
  VWO:  { VT: 8,   QQQM: 0,  SMH: 1,  VWO: 100,BTC: 0 },
  BTC:  { VT: 0,   QQQM: 0,  SMH: 0,  VWO: 0,  BTC: 100 },
}

// ─── Data Fetching ─────────────────────────────────────────────────────────────

async function getReportData(userId: string) {
  const [holdings, rules] = await Promise.all([
    db.holding.findMany({
      where: { userId },
      include: {
        snapshots: { orderBy: { date: "desc" }, take: 5 }, // last 5 for drift history
      },
    }),
    db.governanceRule.findMany({ where: { active: true }, orderBy: { category: "asc" } }),
  ])

  const totalValue = holdings.reduce((sum, h) => sum + (h.snapshots[0]?.value ?? 0), 0)

  const positions = holdings.map((h) => {
    const latest = h.snapshots[0]
    const value = latest?.value ?? 0
    const actualPct = totalValue > 0 ? (value / totalValue) * 100 : 0
    const drift = Math.abs(actualPct - h.targetPct)
    const driftPct = actualPct - h.targetPct
    const outsideBand = drift > h.toleranceBand
    const overCap = h.hardCapPct !== null && actualPct > h.hardCapPct

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
      targetPct: h.targetPct,
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

  // Company look-through
  const companies = Object.keys(COMPANY_CAPS)
  const companyExposure: Record<string, number> = {}
  for (const company of companies) {
    companyExposure[company] = positions.reduce((sum, p) => {
      const etfWeight = COMPANY_WEIGHTS[p.ticker]?.[company] ?? 0
      return sum + (p.actualPct / 100) * etfWeight
    }, 0)
  }

  // Sector exposure
  const sectorExposure: Record<string, number> = { semiconductor: 0, digital: 0, us: 0, ai: 0 }
  for (const p of positions) {
    const sw = SECTOR_WEIGHTS[p.ticker]
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
    const gw = GEO_WEIGHTS[p.ticker]
    if (gw) {
      geoExposure.us       += (p.actualPct / 100) * gw.us
      geoExposure.intlDev  += (p.actualPct / 100) * gw.intlDev
      geoExposure.emerging += (p.actualPct / 100) * gw.emerging
      geoExposure.crypto   += (p.actualPct / 100) * gw.crypto
    }
  }

  // HHI Concentration Index
  const hhi = positions.reduce((sum, p) => sum + Math.pow(p.actualPct / 100, 2), 0)
  const effectiveN = hhi > 0 ? 1 / hhi : 0
  // HHI thresholds: <0.10 = diversified, 0.10–0.18 = moderate, >0.18 = concentrated
  const hhiPct = hhi * 100
  const concentrationRating = hhiPct < 10 ? "Diversified" : hhiPct < 18 ? "Moderate" : "Concentrated"

  // Largest position dominance
  const topPosition = [...positions].sort((a, b) => b.actualPct - a.actualPct)[0]

  // Metrics — same hard threshold logic as dashboard
  const HARD_THRESHOLDS: Record<string, { low?: number; high: number }> = {
    VT:   { low: 40, high: 62 },
    QQQM: { low: 16, high: 31 },
    SMH:  { high: 15 },
    VWO:  { low: 4,  high: 12 },
    BTC:  { high: 8  },
  }
  const driftAlerts    = positions.filter((p) => p.outsideBand || p.overCap).length
  const maxDrift       = positions.reduce((max, p) => Math.max(max, p.drift), 0)
  const companyBreaches = companies.filter((c) => companyExposure[c] > COMPANY_CAPS[c].soft).length
  const sectorBreaches  = (Object.keys(SECTOR_CAPS) as (keyof typeof SECTOR_CAPS)[]).filter(
    (k) => sectorExposure[k] > SECTOR_CAPS[k].elevated
  ).length
  const hardBreaches   = positions.filter(p => {
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

  // Governance compliance — map each rule category to a status
  const ruleCategories = [...new Set(rules.map(r => r.category as string))]

  return {
    totalValue, positions, companyExposure, sectorExposure, geoExposure,
    health, healthScore, driftAlerts, maxDrift, companyBreaches, sectorBreaches,
    hardBreaches, softBreaches, hhi, hhiPct, effectiveN, concentrationRating, topPosition,
    rules, ruleCategories,
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
    <span className={`${base} bg-amber-500/15 text-amber-700 dark:text-amber-400 ring-1 ring-amber-400/25`} title={tip ?? "Approaching the warning limit — keep an eye on this. Redirect next contributions to VT or VWO."}>
      <AlertTriangle className="h-2.5 w-2.5" /> Elevated
    </span>
  )
  return (
    <span className={`${base} bg-green-500/10 text-green-600 dark:text-green-400 ring-1 ring-green-500/20`} title={tip ?? "Within normal limits — no action needed."}>
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
        <div className="shrink-0 flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/10">
          <Icon className="h-4 w-4 text-indigo-500" />
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

  const {
    totalValue, positions, companyExposure, sectorExposure, geoExposure,
    health, healthScore, driftAlerts, maxDrift, companyBreaches, sectorBreaches,
    hardBreaches, hhi, hhiPct, effectiveN, concentrationRating, topPosition,
    rules, ruleCategories,
  } = await getReportData(session.userId)

  const reportDate = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
  const lookThroughAgeDays = Math.floor((Date.now() - LOOK_THROUGH_LAST_REVIEWED.getTime()) / 86_400_000)
  const lookThroughStale = lookThroughAgeDays > LOOK_THROUGH_STALE_DAYS
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
  if (companyAlerts > 0) summaryPoints.push({ text: `You own too much of ${companyAlerts} individual compan${companyAlerts > 1 ? "ies" : "y"} (through your ETFs combined). Stop adding to QQQM and SMH until this resolves.`, severity: "warn" })
  if (sectorAlerts > 0) summaryPoints.push({ text: `Your portfolio is overexposed to ${sectorAlerts} theme${sectorAlerts > 1 ? "s" : ""} (e.g. semiconductors or tech). Put your next contributions into ${bestAlternatives(elevatedSectors, positions)} instead.`, severity: "warn" })
  if (geoExposure.us > 70) summaryPoints.push({ text: `${geoExposure.us.toFixed(0)}% of your money is tied to the US market — that's more than your plan allows. Shift upcoming purchases toward VT and VWO to re-balance.`, severity: "warn" })
  if (hhiPct > 15) summaryPoints.push({ text: `Your portfolio is more concentrated than it looks — it behaves like you own only ${effectiveN.toFixed(1)} equally-sized positions. Consider spreading contributions more evenly.`, severity: "warn" })
  if (summaryPoints.length === 0) summaryPoints.push({ text: "Everything looks good — all holdings are within their target ranges and no limits have been breached. Keep following your standard monthly plan.", severity: "ok" })
  summaryPoints.push({ text: `Overall health score: ${healthScore}/100 (${healthLabel}). Last prices recorded: ${snapshotDate}.`, severity: healthScore >= 80 ? "ok" : healthScore >= 60 ? "warn" : "critical" })

  // Priority action plan — plain English
  const actions: { priority: number; action: string; urgency: "critical" | "high" | "medium" | "low" }[] = []
  positions.filter(p => p.overCap).forEach(p => {
    actions.push({ priority: 1, action: `${p.ticker} is at ${p.actualPct.toFixed(1)}% — above its hard limit. Do NOT buy any more ${p.ticker} until it drops back below ${p.hardCapPct}%. Consider selling a small amount if it stays elevated.`, urgency: "critical" })
  })
  positions.filter(p => p.outsideBand && p.driftPct < 0).forEach(p => {
    actions.push({ priority: 2, action: `${p.ticker} (${p.name}) is too small in your portfolio at ${p.actualPct.toFixed(1)}% — your plan says it should be ${p.targetPct}%. Put this month's contribution into ${p.ticker} to bring it back up.`, urgency: "high" })
  })
  positions.filter(p => p.outsideBand && p.driftPct > 0 && !p.overCap).forEach(p => {
    actions.push({ priority: 3, action: `${p.ticker} has grown to ${p.actualPct.toFixed(1)}% — a little above its ${p.targetPct}% target. Skip buying ${p.ticker} this month and put that money into smaller positions instead.`, urgency: "high" })
  })
  if (excessiveCompanies.length > 0) {
    actions.push({ priority: 4, action: `You have too much tied to ${excessiveCompanies.join(", ")} through your ETFs. Stop buying QQQM and SMH for now — these are the ETFs that hold the most of those companies.`, urgency: "high" })
  }
  if (geoExposure.us > 70) {
    actions.push({ priority: 5, action: `${geoExposure.us.toFixed(0)}% of your portfolio is in US companies. Your plan allows up to 70%. Buy more VT (which includes international) and VWO (emerging markets) to rebalance.`, urgency: "medium" })
  }
  if (actions.length === 0) {
    actions.push({ priority: 1, action: "Nothing needs fixing right now. Follow your normal monthly plan — invest your usual amounts into each holding as normal.", urgency: "low" })
  }

  return (
    <Shell title="Reports" subtitle="Overlap & concentration engine — v5.8" userName={session.name} isAdmin={session.role === "admin"}>

      {/* Print-only cover header */}
      <div className="print-header hidden">
        {/* Title row */}
        <div className="flex items-start justify-between mb-3">
          <div>
            <p className="text-[9px] uppercase tracking-widest text-gray-500 mb-0.5">Atlas Core · Governed Digital Economy Architecture</p>
            <h1 className="text-[22pt] font-black text-gray-900 leading-tight">Annual Portfolio Report</h1>
            <p className="text-[9pt] text-gray-500 mt-0.5">v5.8 · {reportDate} · Confidential — personal use only</p>
          </div>
          <div className="text-right">
            <p className="text-[8pt] text-gray-500 uppercase tracking-wider">Total Portfolio Value</p>
            <p className="text-[20pt] font-black text-gray-900 leading-tight">{formatCurrency(totalValue, "SGD")}</p>
            <p className="text-[8pt] text-gray-500">Snapshot: {snapshotDate}</p>
          </div>
        </div>
        {/* Key metrics strip */}
        <div className="flex gap-6 border-t border-gray-200 pt-2 mt-1">
          <div>
            <p className="text-[7pt] uppercase tracking-wider text-gray-400">Health Score</p>
            <p className={`text-[13pt] font-black ${healthScore >= 80 ? "text-green-700" : healthScore >= 65 ? "text-amber-600" : "text-red-600"}`}>
              {healthScore}/100
            </p>
            <p className="text-[7pt] text-gray-500">{healthLabel}</p>
          </div>
          <div>
            <p className="text-[7pt] uppercase tracking-wider text-gray-400">Drift Alerts</p>
            <p className={`text-[13pt] font-black ${driftAlerts > 0 ? "text-red-600" : "text-green-700"}`}>{driftAlerts}</p>
            <p className="text-[7pt] text-gray-500">{hardBreaches} hard breach{hardBreaches !== 1 ? "es" : ""}</p>
          </div>
          <div>
            <p className="text-[7pt] uppercase tracking-wider text-gray-400">Concentration</p>
            <p className={`text-[13pt] font-black ${hhiPct > 18 ? "text-red-600" : hhiPct > 10 ? "text-amber-600" : "text-green-700"}`}>{concentrationRating}</p>
            <p className="text-[7pt] text-gray-500">HHI {hhiPct.toFixed(1)}% · {effectiveN.toFixed(1)} eff. positions</p>
          </div>
          <div>
            <p className="text-[7pt] uppercase tracking-wider text-gray-400">Company Alerts</p>
            <p className={`text-[13pt] font-black ${companyBreaches > 0 ? "text-amber-600" : "text-green-700"}`}>{companyBreaches}</p>
            <p className="text-[7pt] text-gray-500">{sectorBreaches} sector alert{sectorBreaches !== 1 ? "s" : ""}</p>
          </div>
          <div>
            <p className="text-[7pt] uppercase tracking-wider text-gray-400">US Exposure</p>
            <p className={`text-[13pt] font-black ${geoExposure.us > 80 ? "text-red-600" : geoExposure.us > 70 ? "text-amber-600" : "text-green-700"}`}>{geoExposure.us.toFixed(0)}%</p>
            <p className="text-[7pt] text-gray-500">limit 80% hard</p>
          </div>
          <div className="ml-auto text-right">
            <p className="text-[7pt] uppercase tracking-wider text-gray-400">Holdings</p>
            <p className="text-[13pt] font-black text-gray-800">{positions.length}</p>
            <p className="text-[7pt] text-gray-500">ETF positions</p>
          </div>
        </div>
        {/* Compact holdings table */}
        <table className="w-full mt-3 text-[7.5pt]" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "0.5pt solid #ccc", background: "#f5f5f5" }}>
              <th style={{ textAlign: "left", padding: "2pt 4pt" }}>Ticker</th>
              <th style={{ textAlign: "right", padding: "2pt 4pt" }}>Actual %</th>
              <th style={{ textAlign: "right", padding: "2pt 4pt" }}>Target %</th>
              <th style={{ textAlign: "right", padding: "2pt 4pt" }}>Drift</th>
              <th style={{ textAlign: "right", padding: "2pt 4pt" }}>Value (SGD)</th>
              <th style={{ textAlign: "center", padding: "2pt 4pt" }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {positions.map(p => (
              <tr key={p.ticker} style={{ borderBottom: "0.4pt solid #e5e5e5" }}>
                <td style={{ padding: "2pt 4pt", fontWeight: "700" }}>{p.ticker}</td>
                <td style={{ padding: "2pt 4pt", textAlign: "right" }}>{p.actualPct.toFixed(1)}%</td>
                <td style={{ padding: "2pt 4pt", textAlign: "right" }}>{p.targetPct.toFixed(1)}%</td>
                <td style={{ padding: "2pt 4pt", textAlign: "right", color: p.driftPct > 0 ? "#c05c00" : p.driftPct < 0 ? "#0055cc" : "#555" }}>
                  {p.driftPct >= 0 ? "+" : ""}{p.driftPct.toFixed(1)}%
                </td>
                <td style={{ padding: "2pt 4pt", textAlign: "right" }}>{formatCurrency(p.value, "SGD")}</td>
                <td style={{ padding: "2pt 4pt", textAlign: "center", color: p.overCap ? "#c00" : p.outsideBand ? "#c05c00" : "#166534" }}>
                  {p.overCap ? "HARD BREACH" : p.outsideBand ? "Outside band" : "Healthy"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Screen page header */}
      <div className="no-print flex items-center justify-between mb-5">
        <div>
          <p className="text-xs text-muted-foreground">Generated {reportDate} · Snapshot {snapshotDate}</p>
        </div>
        <ExportPdfButton />
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
              <code className="font-mono text-[10px]">app/reports/page.tsx</code> and refresh{" "}
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
              🔴 Over the limit — {excessiveCompanies.join(", ")}
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
              🟡 Theme limit reached — {excessiveSectors.map((k) => SECTOR_CAPS[k].label).join(", ")}
            </p>
            <p className="text-xs text-amber-700/80 dark:text-amber-400/80 mt-0.5">
              Too much of your money is tied to one theme. Redirect your next contributions to {bestAlternatives(excessiveSectors, positions)} to spread the risk.
            </p>
          </div>
        </div>
      )}

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
          title="What's Happening — Summary"
          sub="Plain-English overview of your portfolio right now"
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

      {/* ── 3. PRIORITY ACTION PLAN ──────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card overflow-hidden mb-6 print-break-before print-break-avoid">
        <SectionHeader
          icon={Zap}
          title="What To Do — Action Plan"
          sub="Step-by-step actions, most urgent first"
          badge={
            <span className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-bold ${
              actions.some(a => a.urgency === "critical") ? "bg-red-500/10 text-red-600 dark:text-red-400" :
              actions.some(a => a.urgency === "high")     ? "bg-amber-500/10 text-amber-600 dark:text-amber-400" :
              "bg-green-500/10 text-green-600 dark:text-green-400"
            }`}>
              {actions.filter(a => a.urgency !== "low").length} action{actions.filter(a => a.urgency !== "low").length !== 1 ? "s" : ""} needed
            </span>
          }
        />
        <div className="divide-y divide-border">
          {actions.map((a, i) => {
            const urgencyStyle = {
              critical: { bg: "bg-red-500/[0.04] border-l-4 border-l-red-500",   badge: "bg-red-500/15 text-red-600 dark:text-red-400",     label: "Critical" },
              high:     { bg: "bg-amber-500/[0.03] border-l-[3px] border-l-amber-400", badge: "bg-amber-500/15 text-amber-700 dark:text-amber-400", label: "High" },
              medium:   { bg: "bg-blue-500/[0.03] border-l-[3px] border-l-blue-400",   badge: "bg-blue-500/15 text-blue-700 dark:text-blue-400",   label: "Medium" },
              low:      { bg: "border-l-4 border-l-transparent",                        badge: "bg-green-500/10 text-green-600 dark:text-green-400",  label: "Clear" },
            }[a.urgency]
            return (
              <div key={i} className={`flex items-start gap-4 px-5 py-3.5 ${urgencyStyle.bg}`}>
                <div className="shrink-0 flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] font-black text-muted-foreground mt-0.5">
                  {i + 1}
                </div>
                <p className="flex-1 text-xs leading-relaxed text-foreground/85">{a.action}</p>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${urgencyStyle.badge}`}>
                  {urgencyStyle.label}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── 4. ALLOCATION + DONUT ─────────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-[1fr_300px] mb-6 print-break-before">
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <SectionHeader
            icon={BarChart3}
            title="Where Your Money Is"
            sub={`How each holding compares to its target — biggest gap: ${formatPercent(maxDrift, 1, false)}`}
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
                        <div className="h-full rounded-full" style={{ width: `${Math.min(100, p.actualPct / 0.7)}%`, backgroundColor: p.color }} />
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
          sub="Measures how evenly your money is spread — more spread = lower risk"
          badge={
            <span className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-bold ${
              concentrationRating === "Concentrated" ? "bg-red-500/10 text-red-500" :
              concentrationRating === "Moderate"     ? "bg-amber-500/10 text-amber-500" :
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
              sub: "Lower score = more spread out",
              note: hhiPct < 10 ? "Well diversified" : hhiPct < 18 ? "Somewhat concentrated" : "Too concentrated",
              cls: hhiPct < 10 ? "text-green-500" : hhiPct < 18 ? "text-amber-500" : "text-red-500",
            },
            {
              label: "Concentration Density",
              value: effectiveN.toFixed(1),
              unit: "",
              sub: "Effective independent positions (1/HHI)",
              note: effectiveN >= 5 ? "Good diversity" : effectiveN >= 3 ? "Moderate" : "Very concentrated",
              cls: effectiveN >= 5 ? "text-green-500" : effectiveN >= 3 ? "text-amber-500" : "text-red-500",
            },
            {
              label: "Biggest Holding",
              value: topPosition ? topPosition.actualPct.toFixed(1) : "—",
              unit: "%",
              sub: topPosition ? `${topPosition.ticker} — ${topPosition.name}` : "",
              note: topPosition && topPosition.actualPct > 55 ? "Getting large — watch it" : "Normal size",
              cls: topPosition && topPosition.actualPct > 55 ? "text-amber-500" : "text-foreground",
            },
            {
              label: "Hard Drift Positions",
              value: String(positions.filter(p => p.outsideBand && Math.abs(p.driftPct) > p.toleranceBand * 2).length),
              unit: `/ ${positions.length}`,
              sub: "Positions in hard drift territory",
              note: positions.filter(p => p.outsideBand && Math.abs(p.driftPct) > p.toleranceBand * 2).length === 0 ? "None — good" : "Review required",
              cls: positions.filter(p => p.outsideBand && Math.abs(p.driftPct) > p.toleranceBand * 2).length > 0 ? "text-red-500" : "text-green-500",
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
                        className="h-full rounded-full"
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
          sub="How much of your portfolio is in each region — across all your ETFs combined"
          badge={
            geoExposure.us > 70
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
              { key: "us",       label: "United States",     color: geoColors.us,       cap: 70, capLabel: "soft 70% · hard 78%", value: geoExposure.us },
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
                      className="h-full rounded-full transition-all"
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
          sub="How much each pair of ETFs shares the same underlying companies (overlap = double-counting risk)"
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
                    const intensity = overlap / 100
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
          sub="Your real exposure to individual companies through all ETFs combined — 🟡 approaching limit · 🔴 over limit"
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
          sub="How much of your portfolio depends on each industry or theme — across all ETFs"
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
            const pctOfElevated = (value / elevated) * 100
            const alt = bestAlternatives([key], positions)
            const responses: Record<string, string> = {
              healthy:   "🟢 All good — your exposure to this theme is within normal limits. Keep following your standard plan.",
              elevated:  `🟡 Getting close to the limit — keep an eye on this. Put your next contributions into ${alt} instead.`,
              excessive: `🔴 Over the limit — stop buying the ETFs that drive this theme (QQQM and/or SMH) until this comes down. Redirect contributions to ${alt}.`,
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
                    className={`h-full rounded-full ${status === "excessive" ? "bg-red-500" : status === "elevated" ? "bg-amber-500" : "bg-indigo-500"}`}
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
          sub="How much each of your ETFs contributes to each thematic exposure"
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
                <td className="px-5 py-2 text-right">Soft 20% / Hard 26%</td>
                <td className="px-5 py-2 text-right">Soft 48% / Hard 54%</td>
                <td className="px-5 py-2 text-right">Soft 70% / Hard 78%</td>
                <td className="px-5 py-2 text-right">Soft 38% / Hard 46%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 11. GOVERNANCE COMPLIANCE SCORECARD ──────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card overflow-hidden mb-6 print-break-before">
        <SectionHeader
          icon={ShieldCheck}
          title="Your Investment Rules"
          sub={`${rules.length} active rules across ${ruleCategories.length} categories — these are the guardrails that protect your plan`}
          badge={
            <span className="shrink-0 rounded-lg bg-indigo-500/10 border border-indigo-500/20 px-2.5 py-1 text-xs font-bold text-indigo-600 dark:text-indigo-400">
              {rules.length} rules active
            </span>
          }
        />
        <div className="divide-y divide-border">
          {ruleCategories.map((category) => {
            const catRules = rules.filter(r => r.category === category)
            return (
              <div key={category} className="print-break-avoid">
                <div className="px-5 py-2.5 bg-muted/30 flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{category}</span>
                  <span className="text-[10px] text-muted-foreground">{catRules.length} rule{catRules.length !== 1 ? "s" : ""}</span>
                </div>
                <div className="divide-y divide-border/60">
                  {catRules.map((rule) => (
                    <div key={rule.id} className="px-5 py-3 flex items-start gap-3 hover:bg-accent/20 transition-colors">
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold">{rule.title}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{rule.description}</p>
                      </div>
                      <span className="shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold bg-green-500/10 text-green-600 dark:text-green-400 ring-1 ring-green-500/20">Active</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── 12. GOVERNANCE SUMMARY CARDS ─────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-3 mb-6 print-break-before print-break-avoid">
        {[
          {
            title: "Contribution Routing",
            body: driftAlerts === 0
              ? "All positions within tolerance. Maintain standard monthly allocation split."
              : `${driftAlerts} position${driftAlerts > 1 ? "s" : ""} outside tolerance band. Redirect contributions to underweight positions before next execution day.`,
            status: driftAlerts === 0 ? "healthy" : "elevated" as "healthy" | "elevated" | "excessive",
          },
          {
            title: "Concentration Review",
            body: companyAlerts === 0
              ? "No single-stock concentration caps breached. Look-through exposure within governance limits."
              : `${companyAlerts} company cap${companyAlerts > 1 ? "s" : ""} breached. Review contributions to QQQM and SMH to reduce concentrated exposure.`,
            status: companyAlerts === 0 ? "healthy" : "elevated" as "healthy" | "elevated" | "excessive",
          },
          {
            title: "Rebalance Trigger",
            body: maxDrift < 5
              ? `Max drift ${formatPercent(maxDrift, 1, false)}. No rebalancing action required. Continue contribution-based routing.`
              : `Max drift ${formatPercent(maxDrift, 1, false)}. Hard trigger review warranted. Redirect contributions to underweight positions first.`,
            status: maxDrift < 5 ? "healthy" : maxDrift < 10 ? "elevated" : "excessive" as "healthy" | "elevated" | "excessive",
          },
        ].map(({ title, body, status }) => (
          <div key={title} className={`rounded-xl border bg-card p-4 ${status === "excessive" ? "border-red-500/30" : status === "elevated" ? "border-amber-400/30" : "border-border"}`}>
            <div className="flex items-center gap-2 mb-2">
              {status === "healthy"
                ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                : <AlertTriangle className={`h-3.5 w-3.5 shrink-0 ${status === "excessive" ? "text-red-500" : "text-amber-500"}`} />
              }
              <p className="text-xs font-semibold">{title}</p>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">{body}</p>
          </div>
        ))}
      </div>

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
