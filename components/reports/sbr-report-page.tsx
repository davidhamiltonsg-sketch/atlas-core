import Link from "next/link"
import { Shell } from "@/components/shell"
import { db } from "@/lib/db"
import { formatCurrency } from "@/lib/utils"
import {
  CheckCircle2, AlertTriangle, XCircle, TrendingUp, Target,
  BarChart3, ShieldCheck, Zap, Activity, FileText, ChevronRight,
  ArrowRight,
} from "lucide-react"
import { SILICON_BRICK_ROAD as SBR } from "@/lib/constitutions"
import {
  computeSbrNextMove, computeSbrDca, computeSbrHealth, sbrPhase, type SbrPosition,
} from "@/lib/sbr-engine"
import { sbrBlendedGrowthRate, monthsToTarget } from "@/lib/sbr-forecast"
import { evaluateSbrGovernance } from "@/lib/sbr-governance"
import { buildPortfolioTimeline } from "@/lib/portfolio-metrics"
import { getSbrMarketData } from "@/lib/sbr-market"
import { DownloadReportCard } from "@/components/reports/download-report-card"

const SBR_FUND_TICKERS = SBR.funds.map((f) => f.ticker)
const TARGET_VALUE = SBR.targetValue ?? 120000
const MONTHLY_CONTRIB = SBR.monthlyContribution ?? 3000

const PHASE_MARKS = [
  { key: "I",   label: "Phase I",   threshold: 72000  },
  { key: "II",  label: "Phase II",  threshold: 96000  },
  { key: "III", label: "Phase III", threshold: 114000 },
  { key: "IV",  label: "Phase IV",  threshold: TARGET_VALUE },
]

function monthsToLabel(months: number | null): string {
  if (months === null) return "50+ years at this rate"
  if (months === 0) return "already there"
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() + months)
  return d.toLocaleDateString("en-GB", { month: "short", year: "numeric" })
}

function SectionHeader({
  icon: Icon, title, sub, badge,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  sub: string
  badge?: React.ReactNode
}) {
  return (
    <div className="px-5 py-4 border-b border-border flex items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        <div className="shrink-0 flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/10">
          <Icon className="h-4 w-4 text-sky-500" />
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

function CheckRow({
  label, status, detail,
}: {
  label: string
  status: "ok" | "watch" | "breach"
  detail: string
}) {
  if (status === "breach") return (
    <div className="flex items-start gap-3 py-3 border-b border-border/60 last:border-0">
      <XCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{detail}</p>
      </div>
      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/10 text-red-600 dark:text-red-400 ring-1 ring-red-500/20 shrink-0">Breach</span>
    </div>
  )
  if (status === "watch") return (
    <div className="flex items-start gap-3 py-3 border-b border-border/60 last:border-0">
      <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{detail}</p>
      </div>
      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400 ring-1 ring-amber-500/20 shrink-0">Watch</span>
    </div>
  )
  return (
    <div className="flex items-start gap-3 py-3 border-b border-border/60 last:border-0">
      <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{detail}</p>
      </div>
      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-500/10 text-green-600 dark:text-green-400 ring-1 ring-green-500/20 shrink-0">OK</span>
    </div>
  )
}

function HealthBar({ score, color }: { score: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs font-bold tabular-nums w-8 text-right">{score}</span>
    </div>
  )
}

async function getSbrReport(userId: string) {
  const [holdings, market] = await Promise.all([
    db.holding.findMany({
      where: { userId, ticker: { in: SBR_FUND_TICKERS } },
      include: { snapshots: { orderBy: { date: "desc" }, take: 8 } },
    }),
    getSbrMarketData(),
  ])

  const fundOrder = SBR.funds.map((f) => f.ticker)
  const holdingsSorted = [...holdings].sort(
    (a, b) => fundOrder.indexOf(a.ticker) - fundOrder.indexOf(b.ticker),
  )
  const totalValue = holdingsSorted.reduce((s, h) => s + (h.snapshots[0]?.value ?? 0), 0)
  const priceMap = market.positions

  const positions: SbrPosition[] = holdingsSorted.map((h) => {
    const fund = SBR.funds.find((f) => f.ticker === h.ticker)
    const value = h.snapshots[0]?.value ?? 0
    const actualPct = totalValue > 0 ? (value / totalValue) * 100 : 0
    const live = priceMap[h.ticker]
    return {
      ticker: h.ticker, name: h.name, color: fund?.color ?? h.color, value, actualPct,
      targetPct: h.targetPct, rangeLow: fund?.rangeLow ?? h.targetPct - h.toleranceBand,
      rangeHigh: fund?.rangeHigh ?? h.targetPct + h.toleranceBand, hardCap: h.hardCapPct,
      floor: fund?.floor, latestPrice: live?.price || h.snapshots[0]?.price || 0, hi52: live?.hi52 || 0,
    }
  })

  const allocMap: Record<string, number> = {}
  for (const p of positions) allocMap[p.ticker] = p.actualPct
  const growthRates = sbrBlendedGrowthRate(allocMap)

  const monthsToGoal = {
    conservative: monthsToTarget(totalValue, MONTHLY_CONTRIB, growthRates.conservative, TARGET_VALUE),
    base: monthsToTarget(totalValue, MONTHLY_CONTRIB, growthRates.base, TARGET_VALUE),
    aggressive: monthsToTarget(totalValue, MONTHLY_CONTRIB, growthRates.aggressive, TARGET_VALUE),
  }

  const timeline = buildPortfolioTimeline(holdings)
  let drawdownPct: number | undefined
  if (timeline.length >= 2) {
    const peak = Math.max(...timeline.map((t) => t.value))
    const current = timeline[timeline.length - 1].value
    if (peak > 0 && current < peak) drawdownPct = ((current - peak) / peak) * 100
  }

  const latest = holdingsSorted.reduce<Date | null>(
    (d, h) => { const s = h.snapshots[0]?.date; return s && (!d || s > d) ? s : d }, null,
  )
  const snapshotAgeDays = latest
    ? Math.floor((Date.now() - new Date(latest).getTime()) / 86_400_000)
    : 999

  const health = computeSbrHealth(positions, totalValue, snapshotAgeDays)
  const governance = evaluateSbrGovernance(positions, totalValue)
  const nextMove = computeSbrNextMove(positions, totalValue, { drawdownPct })
  const dca = computeSbrDca(positions, MONTHLY_CONTRIB, { drawdownPct })
  const phase = sbrPhase(totalValue)

  const snapshotDate = latest
    ? new Date(latest).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : "—"
  const reportDate = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })

  return {
    totalValue, positions, growthRates, monthsToGoal, health, governance,
    nextMove, dca, phase, snapshotDate, reportDate, snapshotAgeDays,
  }
}

export async function SbrReportPage({
  userId, userName, isAdmin,
}: {
  userId: string
  userName: string
  isAdmin: boolean
}) {
  const d = await getSbrReport(userId)
  const hasBalance = d.totalValue > 0
  const progressPct = TARGET_VALUE > 0 ? Math.min(100, (d.totalValue / TARGET_VALUE) * 100) : 0
  const valueFrac = TARGET_VALUE > 0 ? Math.min(1, d.totalValue / TARGET_VALUE) : 0

  // Trajectory band: blended base return vs 12% / 15% thresholds
  const blendedBase = d.growthRates.base
  const trajectoryBand = blendedBase <= 0.12 ? "green" : blendedBase <= 0.15 ? "amber" : "red"

  const healthColor = d.health.overall >= 80 ? "text-green-500" : d.health.overall >= 65 ? "text-amber-500" : "text-red-500"
  const healthBg    = d.health.overall >= 80 ? "bg-green-500" : d.health.overall >= 65 ? "bg-amber-500" : "bg-red-500"

  const breaches = d.governance.checks.filter((c) => c.status === "breach").length
  const watches  = d.governance.checks.filter((c) => c.status === "watch").length

  return (
    <Shell
      title="Road Report"
      subtitle={`Silicon Brick Road · ${d.reportDate}`}
      userName={userName}
      isAdmin={isAdmin}
    >
      {/* ── Print cover (hidden on screen) ── */}
      <div className="print-header hidden">
        <p className="ph-eyebrow">Silicon Brick Road · v2.2 · HDB Deposit Fund</p>
        <h1>Road Report</h1>
        <p className="ph-sub">{d.reportDate} &nbsp;·&nbsp; Personal &amp; Confidential</p>
        <hr className="ph-divider" />
        <div className="ph-metrics">
          <div className="ph-metric">
            <p className="ph-metric-label">Total Value</p>
            <p className="ph-metric-value">{formatCurrency(d.totalValue, "SGD")}</p>
            <p className="ph-metric-sub">of {formatCurrency(TARGET_VALUE, "SGD")} target</p>
          </div>
          <div className="ph-metric">
            <p className="ph-metric-label">Progress</p>
            <p className={`ph-metric-value ${progressPct >= 80 ? "good" : "warn"}`}>{progressPct.toFixed(1)}%</p>
            <p className="ph-metric-sub">{d.phase.label}</p>
          </div>
          <div className="ph-metric">
            <p className="ph-metric-label">Health Score</p>
            <p className={`ph-metric-value ${d.health.overall >= 80 ? "good" : d.health.overall >= 65 ? "warn" : "crit"}`}>{d.health.overall}/100</p>
            <p className="ph-metric-sub">{d.health.overallLabel}</p>
          </div>
          <div className="ph-metric">
            <p className="ph-metric-label">Arrival (Base)</p>
            <p className="ph-metric-value good">{monthsToLabel(d.monthsToGoal.base)}</p>
            <p className="ph-metric-sub">{(blendedBase * 100).toFixed(1)}% blended rate</p>
          </div>
          <div className="ph-metric">
            <p className="ph-metric-label">Compliance</p>
            <p className={`ph-metric-value ${breaches > 0 ? "crit" : watches > 0 ? "warn" : "good"}`}>
              {breaches > 0 ? `${breaches} breach` : watches > 0 ? `${watches} watch` : "All clear"}
            </p>
            <p className="ph-metric-sub">{d.governance.checks.length} rules checked</p>
          </div>
        </div>
      </div>

      <div className="space-y-5 print:space-y-6">

        {/* ── 1. KPI Strip ── */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            {
              label: "Total value",
              value: hasBalance ? formatCurrency(d.totalValue, "SGD") : "—",
              sub: `of ${formatCurrency(TARGET_VALUE, "SGD")} target`,
              color: "text-foreground",
            },
            {
              label: "Progress",
              value: hasBalance ? `${progressPct.toFixed(1)}%` : "—",
              sub: d.phase.label.split("—")[0].trim(),
              color: "text-sky-500",
            },
            {
              label: "Health score",
              value: hasBalance ? `${d.health.overall}/100` : "—",
              sub: d.health.overallLabel,
              color: healthColor,
            },
            {
              label: "Arrival (base case)",
              value: hasBalance ? monthsToLabel(d.monthsToGoal.base) : "—",
              sub: `${(blendedBase * 100).toFixed(1)}% blended rate`,
              color: "text-foreground",
            },
          ].map((kpi) => (
            <div key={kpi.label} className="rounded-xl border border-border bg-card p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{kpi.label}</p>
              <p className={`text-lg font-bold tabular-nums mt-1 ${kpi.color}`}>{kpi.value}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{kpi.sub}</p>
            </div>
          ))}
        </div>

        {!hasBalance && (
          <div className="rounded-xl border border-sky-500/30 bg-sky-500/[0.06] px-5 py-4">
            <p className="text-sm font-bold text-sky-400">No portfolio data yet</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Add your current holdings on the{" "}
              <Link href="/portfolio" className="underline font-semibold">Portfolio</Link>{" "}
              page and this report will populate automatically.
            </p>
          </div>
        )}

        {hasBalance && (
          <>

            {/* ── 2. Trajectory & Forecast (Art. I) ── */}
            <div className="rounded-2xl border border-border bg-card overflow-hidden">
              <SectionHeader
                icon={TrendingUp}
                title="Trajectory & Forecast"
                sub="Art. I — Time to goal and return assumptions"
                badge={
                  <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ring-1 ${
                    trajectoryBand === "green"
                      ? "bg-green-500/10 text-green-600 dark:text-green-400 ring-green-500/20"
                      : trajectoryBand === "amber"
                      ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 ring-amber-400/25"
                      : "bg-red-500/10 text-red-600 dark:text-red-400 ring-red-500/20"
                  }`}>
                    {trajectoryBand === "green" ? "On track" : trajectoryBand === "amber" ? "Elevated" : "Review horizon"}
                  </span>
                }
              />
              <div className="p-5 space-y-4">
                {/* Blended return gauge */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-xs font-semibold">Blended expected return</p>
                    <p className={`text-sm font-bold tabular-nums ${
                      trajectoryBand === "green" ? "text-green-500" : trajectoryBand === "amber" ? "text-amber-500" : "text-red-500"
                    }`}>{(blendedBase * 100).toFixed(1)}% p.a.</p>
                  </div>
                  <div className="relative h-2.5 rounded-full bg-muted overflow-hidden">
                    {/* Band zones */}
                    <div className="absolute inset-y-0 left-0 rounded-l-full bg-green-500/20" style={{ width: "60%" }} />
                    <div className="absolute inset-y-0 bg-amber-500/20" style={{ left: "60%", width: "20%" }} />
                    <div className="absolute inset-y-0 rounded-r-full bg-red-500/20" style={{ left: "80%", width: "20%" }} />
                    {/* Needle */}
                    <div
                      className={`absolute inset-y-0 w-1 rounded-full ${
                        trajectoryBand === "green" ? "bg-green-500" : trajectoryBand === "amber" ? "bg-amber-500" : "bg-red-500"
                      }`}
                      style={{ left: `${Math.min(98, (blendedBase / 0.20) * 100)}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-muted-foreground/60 mt-1">
                    <span>0%</span><span>12% target</span><span>15% caution</span><span>20%</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                    Blended from what you actually hold — weighted by current allocation, not target weights. A portfolio concentrated in SEMI or EQQQ raises this number; more VWRA and A35 brings it down. The plan is designed to stay below 12%.
                  </p>
                </div>

                {/* Arrival scenarios */}
                <div className="rounded-lg border border-border bg-muted/30 divide-y divide-border">
                  {[
                    { label: "Conservative", sub: `${(d.growthRates.conservative * 100).toFixed(1)}% p.a.`, months: d.monthsToGoal.conservative, color: "text-muted-foreground" },
                    { label: "Base case",    sub: `${(d.growthRates.base * 100).toFixed(1)}% p.a.`,         months: d.monthsToGoal.base,         color: "text-foreground font-semibold" },
                    { label: "Optimistic",   sub: `${(d.growthRates.aggressive * 100).toFixed(1)}% p.a.`,   months: d.monthsToGoal.aggressive,   color: "text-sky-500" },
                  ].map((s) => (
                    <div key={s.label} className="px-4 py-2.5 flex items-center justify-between gap-3">
                      <div>
                        <p className={`text-sm ${s.color}`}>{s.label}</p>
                        <p className="text-[11px] text-muted-foreground">{s.sub}</p>
                      </div>
                      <p className={`text-sm tabular-nums ${s.color}`}>{monthsToLabel(s.months)}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* ── 3. Phase Progress (Art. III) ── */}
            <div className="rounded-2xl border border-border bg-card overflow-hidden">
              <SectionHeader
                icon={Target}
                title="Phase Progress"
                sub="Art. III — Four-phase journey to SGD 120,000"
                badge={
                  <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-400 ring-1 ring-sky-500/20">
                    {d.phase.label.split("—")[0].trim()}
                  </span>
                }
              />
              <div className="p-5">
                <div className="mb-3">
                  <div className="relative h-4 rounded-full bg-muted overflow-hidden">
                    {PHASE_MARKS.map((pm, i) => {
                      const prev = i === 0 ? 0 : PHASE_MARKS[i - 1].threshold
                      const start = (prev / TARGET_VALUE) * 100
                      const width = ((pm.threshold - prev) / TARGET_VALUE) * 100
                      const isCurrent = pm.key === d.phase.key
                      return (
                        <div
                          key={pm.key}
                          className={`absolute top-0 h-full border-r border-background/40 ${isCurrent ? "bg-sky-500/20" : "bg-transparent"}`}
                          style={{ left: `${start}%`, width: `${width}%` }}
                        />
                      )
                    })}
                    <div
                      className="absolute top-0 left-0 h-full rounded-full bg-gradient-to-r from-sky-400 via-blue-500 to-cyan-400 transition-all duration-700"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                  <div className="flex mt-1.5">
                    {PHASE_MARKS.map((pm, i) => {
                      const prev = i === 0 ? 0 : PHASE_MARKS[i - 1].threshold
                      const width = ((pm.threshold - prev) / TARGET_VALUE) * 100
                      const isCurrent = pm.key === d.phase.key
                      return (
                        <div key={pm.key} className="text-center" style={{ width: `${width}%` }}>
                          <span className={`text-[10px] font-bold ${isCurrent ? "text-sky-400" : "text-muted-foreground/50"}`}>{pm.key}</span>
                        </div>
                      )
                    })}
                  </div>
                  <div className="flex justify-between text-[10px] text-muted-foreground/40 mt-0.5">
                    <span>SGD 0</span><span>72k</span><span>96k</span><span>114k</span><span>120k</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
                  {[
                    { key: "I",   label: "Phase I",   desc: "Grow to 72k — all contributions to highest-priority fund", end: 72000 },
                    { key: "II",  label: "Phase II",  desc: "72k–96k — same approach, momentum builds", end: 96000 },
                    { key: "III", label: "Phase III", desc: "96k–114k — quarterly sells to load up A35 safety floor", end: 114000 },
                    { key: "IV",  label: "Phase IV",  desc: "114k–120k — all new money to A35; equity runs to close", end: TARGET_VALUE },
                  ].map((pm) => {
                    const isCurrent = pm.key === d.phase.key
                    const isDone = d.totalValue >= pm.end
                    return (
                      <div key={pm.key} className={`rounded-lg border p-3 ${
                        isCurrent ? "border-sky-500/40 bg-sky-500/[0.07]"
                          : isDone ? "border-green-500/30 bg-green-500/[0.05]"
                          : "border-border bg-muted/20"
                      }`}>
                        <div className="flex items-center justify-between mb-1">
                          <p className={`text-[10px] font-bold uppercase tracking-wide ${isCurrent ? "text-sky-400" : isDone ? "text-green-500" : "text-muted-foreground/60"}`}>{pm.label}</p>
                          {isDone && !isCurrent && <CheckCircle2 className="h-3 w-3 text-green-500" />}
                          {isCurrent && <ArrowRight className="h-3 w-3 text-sky-400" />}
                        </div>
                        <p className="text-[10px] text-muted-foreground leading-relaxed">{pm.desc}</p>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* ── 4. Constitution Compliance ── */}
            <div className="rounded-2xl border border-border bg-card overflow-hidden">
              <SectionHeader
                icon={ShieldCheck}
                title="Constitution Compliance"
                sub="Art. VI, XIV, XV, XVII — rules and limits checked against live positions"
                badge={
                  <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ring-1 ${
                    breaches > 0
                      ? "bg-red-500/10 text-red-600 dark:text-red-400 ring-red-500/20"
                      : watches > 0
                      ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 ring-amber-400/25"
                      : "bg-green-500/10 text-green-600 dark:text-green-400 ring-green-500/20"
                  }`}>
                    {breaches > 0 ? `${breaches} breach` : watches > 0 ? `${watches} watch` : "All clear"}
                  </span>
                }
              />
              <div className="px-5 py-2">
                {d.governance.checks.map((check) => (
                  <CheckRow key={check.id} label={check.label} status={check.status} detail={check.detail} />
                ))}
              </div>
              {breaches === 0 && watches === 0 && (
                <div className="px-5 pb-4">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Every rule in the written plan is satisfied. No changes required — continue with the monthly plan as normal.
                  </p>
                </div>
              )}
            </div>

            {/* ── 5. Fund Allocation (Art. II) ── */}
            <div className="rounded-2xl border border-border bg-card overflow-hidden">
              <SectionHeader
                icon={BarChart3}
                title="Fund Allocation"
                sub="Art. II — Actual vs target for each of the four funds"
              />
              <div className="divide-y divide-border/60">
                {d.positions.map((p) => {
                  const drift = p.actualPct - p.targetPct
                  const isHard = (p.hardCap !== null && p.actualPct > (p.hardCap ?? 100))
                  const isSoft = !isHard && Math.abs(drift) > 3
                  const statusLabel = isHard ? "Breach" : isSoft ? "Drift" : "OK"
                  const statusColor = isHard
                    ? "bg-red-500/10 text-red-600 dark:text-red-400 ring-red-500/20"
                    : isSoft
                    ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 ring-amber-400/25"
                    : "bg-green-500/10 text-green-600 dark:text-green-400 ring-green-500/20"

                  return (
                    <div key={p.ticker} className="px-5 py-3.5">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: p.color }} />
                          <span className="text-sm font-bold">{p.ticker}</span>
                          <span className="text-xs text-muted-foreground">{p.name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground tabular-nums">{p.actualPct.toFixed(1)}% / {p.targetPct}%</span>
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ring-1 ${statusColor}`}>{statusLabel}</span>
                        </div>
                      </div>
                      <div className="relative h-2 rounded-full bg-muted overflow-hidden">
                        <div className="absolute top-0 left-0 h-full rounded-full transition-all" style={{ width: `${Math.min(100, p.actualPct)}%`, background: p.color, opacity: 0.8 }} />
                        <div className="absolute top-0 h-full w-0.5 bg-foreground/30" style={{ left: `${Math.min(100, p.targetPct)}%` }} />
                      </div>
                      <div className="flex justify-between text-[10px] text-muted-foreground/60 mt-0.5">
                        <span>0%</span>
                        <span>target {p.targetPct}%</span>
                        <span>100%</span>
                      </div>
                      {Math.abs(drift) > 0.5 && (
                        <p className="text-[11px] text-muted-foreground mt-1.5">
                          {drift > 0
                            ? `${drift.toFixed(1)}pp above target — ${isHard ? "hard cap breached, do not buy more" : "skip buying this month"}`
                            : `${Math.abs(drift).toFixed(1)}pp below target — ${Math.abs(drift) > 3 ? "direct this month's contribution here" : "within tolerance"}`
                          }
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* ── 6. This Month — Next Move (Art. V) ── */}
            <div className="rounded-2xl border border-border bg-card overflow-hidden">
              <SectionHeader
                icon={Zap}
                title="What to Do This Month"
                sub="Art. V — Eight-step decision ladder output"
                badge={
                  <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ring-1 ${
                    d.nextMove.severity === "critical" || d.nextMove.severity === "high"
                      ? "bg-red-500/10 text-red-600 dark:text-red-400 ring-red-500/20"
                      : d.nextMove.severity === "medium"
                      ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 ring-amber-400/25"
                      : "bg-green-500/10 text-green-600 dark:text-green-400 ring-green-500/20"
                  }`}>
                    {d.nextMove.severity === "none" ? "On track" :
                      d.nextMove.severity === "medium" ? "Heads up" :
                      d.nextMove.severity === "high" ? "Important" : "Act now"}
                  </span>
                }
              />
              <div className="px-5 py-4 space-y-3">
                <p className="text-sm font-semibold">{d.nextMove.action}</p>
                <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2">
                  <p className="text-xs leading-relaxed">{d.nextMove.what}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{d.nextMove.why}</p>
                  {d.nextMove.when && (
                    <p className="text-[11px] text-muted-foreground/70 pt-2 border-t border-border">{d.nextMove.when}</p>
                  )}
                </div>

                {/* DCA allocation breakdown */}
                <div className="divide-y divide-border/60 rounded-lg border border-border overflow-hidden">
                  {d.dca.allocations.map((a) => (
                    <div key={a.ticker} className="px-4 py-2.5 flex items-center gap-3">
                      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: a.color }} />
                      <span className="font-bold text-sm w-14">{a.ticker}</span>
                      <span className="flex-1 text-xs text-muted-foreground">{a.reason}</span>
                      <span className={`text-sm font-bold tabular-nums ${a.amount > 0 ? "text-green-500" : "text-muted-foreground"}`}>
                        {a.amount > 0 ? `+${formatCurrency(a.amount, "SGD")}` : "—"}
                      </span>
                    </div>
                  ))}
                </div>
                {d.dca.overlayNote && (
                  <p className="text-[11px] text-amber-500 leading-relaxed">{d.dca.overlayNote}</p>
                )}
              </div>
            </div>

            {/* ── 7. Health Scorecard (Art. XIX) ── */}
            <div className="rounded-2xl border border-border bg-card overflow-hidden">
              <SectionHeader
                icon={Activity}
                title="Health Scorecard"
                sub="Art. XIX — Six-category weighted score (100 points total)"
                badge={
                  <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ring-1 ${
                    d.health.overall >= 80
                      ? "bg-green-500/10 text-green-600 dark:text-green-400 ring-green-500/20"
                      : d.health.overall >= 65
                      ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 ring-amber-400/25"
                      : "bg-red-500/10 text-red-600 dark:text-red-400 ring-red-500/20"
                  }`}>
                    {d.health.overall}/100
                  </span>
                }
              />
              <div className="p-5 space-y-3">
                <p className={`text-lg font-bold ${healthColor}`}>{d.health.overallLabel}</p>
                <div className="space-y-2.5">
                  {[
                    { label: "Governance",   score: d.health.governance,   weight: 25, desc: "Decision steps followed, no unauthorised trades" },
                    { label: "Risk",         score: d.health.risk,         weight: 20, desc: "SEMI cap, combined ceiling, no hard breaches" },
                    { label: "Allocation",   score: d.health.allocation,   weight: 15, desc: "All funds within comfortable ranges" },
                    { label: "Contribution", score: d.health.contribution, weight: 15, desc: "Monthly contributions at plan level" },
                    { label: "Behaviour",    score: d.health.behavioural,  weight: 10, desc: "Discipline — no uncorrected breaches or lapses" },
                    { label: "Liquidity",    score: d.health.liquidity,    weight: 10, desc: "A35 above 7% floor, emergency fund maintained" },
                    { label: "Documentation",score: d.health.documentation,weight: 5,  desc: "Data currency — trade log and snapshots fresh" },
                  ].map((dim) => {
                    const barColor = dim.score >= 80 ? "bg-green-500" : dim.score >= 60 ? "bg-amber-500" : "bg-red-500"
                    return (
                      <div key={dim.label}>
                        <div className="flex items-center justify-between mb-1">
                          <div>
                            <span className="text-xs font-semibold">{dim.label}</span>
                            <span className="text-[10px] text-muted-foreground ml-2">{dim.weight}% weight</span>
                          </div>
                          <span className={`text-xs font-bold tabular-nums ${dim.score >= 80 ? "text-green-500" : dim.score >= 60 ? "text-amber-500" : "text-red-500"}`}>{dim.score}/100</span>
                        </div>
                        <HealthBar score={dim.score} color={barColor} />
                        <p className="text-[10px] text-muted-foreground mt-0.5">{dim.desc}</p>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

          </>
        )}

        {/* ── Download / Export ── */}
        <DownloadReportCard endpoint="/api/reports/sbr" accent="sky" title="Download Full PDF Report" subtitle="A premium PDF version of this report — all sections, formatted for print." />

        {/* ── Link back to dashboard ── */}
        <div className="text-center pb-2">
          <Link href="/" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-sky-400 transition-colors">
            <ChevronRight className="h-3 w-3 rotate-180" />
            Back to dashboard
          </Link>
        </div>

      </div>
    </Shell>
  )
}
