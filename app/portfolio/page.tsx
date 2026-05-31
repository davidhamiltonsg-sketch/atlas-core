import { Shell } from "@/components/shell"
import { db } from "@/lib/db"
import { formatCurrency } from "@/lib/utils"
import { AlertTriangle, XCircle, Activity } from "lucide-react"
import { getSession } from "@/lib/session"
import { redirect } from "next/navigation"
import { PortfolioUpdateButton } from "@/components/portfolio-update-button"
import { AllocationDonut } from "@/components/charts/allocation-donut"
import { HoldingRow } from "@/components/portfolio/holding-row"
import { RefreshPricesButton } from "@/components/portfolio/refresh-prices-button"
import { AutoRefresh } from "@/components/auto-refresh"
import { DriftNotifications } from "@/components/drift-notifications"
import { HARD_THRESHOLDS } from "@/lib/constants"

async function getPortfolioData(userId: string) {
  const holdings = await db.holding.findMany({
    where: { userId },
    include: {
      snapshots: { orderBy: { date: "desc" }, take: 8 },
    },
    orderBy: { targetPct: "desc" },
  })

  const totalValue = holdings.reduce((sum, h) => sum + (h.snapshots[0]?.value ?? 0), 0)
  const hasBalance = totalValue > 0

  return {
    holdings: holdings.map((h) => {
      const latest = h.snapshots[0]
      const value = latest?.value ?? 0
      const actualPct = hasBalance ? (value / totalValue) * 100 : 0
      const drift = hasBalance ? actualPct - h.targetPct : 0
      const withinBand = !hasBalance || Math.abs(drift) <= h.toleranceBand
      const overCap = hasBalance && h.hardCapPct !== null && actualPct > h.hardCapPct
      // Use HARD_THRESHOLDS for consistent logic: only flag overweight if no low bound
      const ht = HARD_THRESHOLDS[h.ticker]
      const isHard = hasBalance && (overCap ||
        (ht?.low !== undefined && actualPct < ht.low) ||
        (ht !== undefined && actualPct > ht.high))
      const isSoft = hasBalance && !isHard && !withinBand
      const sparklineValues = h.snapshots.map(s => s.value)
      return { ...h, latestSnapshot: latest ?? null, value, actualPct, drift, withinBand, overCap, isHard, isSoft, sparklineValues }
    }),
    totalValue,
    hasBalance,
  }
}

export default async function Portfolio() {
  const session = await getSession()
  if (!session) redirect("/login")
  const { holdings, totalValue, hasBalance } = await getPortfolioData(session.userId)

  const snapshotDate = holdings[0]?.latestSnapshot
    ? new Date(holdings[0].latestSnapshot.date).toLocaleDateString("en-GB", {
        day: "numeric", month: "short", year: "numeric",
      })
    : "—"

  const latestDate = holdings.reduce<Date | null>((latest, h) => {
    const d = h.latestSnapshot?.date
    if (!d) return latest
    const dt = new Date(d)
    return latest === null || dt > latest ? dt : latest
  }, null)
  const daysSinceUpdate = latestDate
    ? Math.floor((Date.now() - latestDate.getTime()) / 86_400_000)
    : null

  const withinCount = holdings.filter((h) => h.withinBand && !h.overCap).length
  const hardBreaches = holdings.filter((h) => h.isHard).length
  const softBreaches = holdings.filter((h) => h.isSoft).length

  const donutData = holdings.map((h) => ({
    ticker: h.ticker,
    name: h.name,
    actualPct: h.actualPct,
    targetPct: h.targetPct,
    color: h.color,
    value: h.value,
  }))

  return (
    <Shell title="Portfolio Architecture" subtitle="Holdings, target allocations, and hard caps" userName={session.name} isAdmin={session.role === "admin"}>

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <AutoRefresh intervalHours={24} />
        <DriftNotifications alerts={[
          ...holdings.filter(h => h.isHard).map(h => ({
            ticker: h.ticker,
            severity: "hard" as const,
            direction: h.drift > 0 ? "over" as const : "under" as const,
            actualPct: h.actualPct,
            targetPct: h.targetPct,
          })),
          ...holdings.filter(h => h.isSoft).map(h => ({
            ticker: h.ticker,
            severity: "soft" as const,
            direction: h.drift > 0 ? "over" as const : "under" as const,
            actualPct: h.actualPct,
            targetPct: h.targetPct,
          })),
        ]} />
      </div>

      {/* Stale data warning */}
      {daysSinceUpdate !== null && daysSinceUpdate >= 3 && (
        <div className={`mb-4 flex items-center gap-3 rounded-xl border px-5 py-3 ${
          daysSinceUpdate >= 7
            ? "border-red-500/30 bg-red-500/[0.07]"
            : "border-amber-400/30 bg-amber-400/[0.07]"
        }`}>
          <Activity className={`h-4 w-4 shrink-0 ${daysSinceUpdate >= 7 ? "text-red-500" : "text-amber-500"}`} />
          <p className={`text-xs flex-1 ${daysSinceUpdate >= 7 ? "text-red-600 dark:text-red-400" : "text-amber-700 dark:text-amber-400"}`}>
            <span className="font-bold">Prices last updated {daysSinceUpdate} day{daysSinceUpdate !== 1 ? "s" : ""} ago.</span>
            {daysSinceUpdate >= 7 ? " Values may be significantly out of date." : " Consider updating your prices."}
          </p>
        </div>
      )}

      {/* New user — no balance yet */}
      {!hasBalance && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/[0.06] px-5 py-4">
          <div className="shrink-0 flex h-9 w-9 items-center justify-center rounded-full bg-primary/15">
            <Activity className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-primary">Welcome — enter your first snapshot to get started</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Target allocations are shown below. Once you add your holdings, drift alerts and instructions will appear automatically.
            </p>
          </div>
        </div>
      )}

      {/* Hard breach banner — only when portfolio has balance */}
      {hasBalance && hardBreaches > 0 && (() => {
        const firstHard = holdings.find(h => h.isHard)
        return (
          <a href={firstHard ? `#holding-${firstHard.ticker}` : "#holdings"} className="mb-4 flex items-center gap-3 rounded-xl border border-red-500/40 bg-red-500/10 dark:bg-red-500/[0.12] px-5 py-3.5 glow-red flash-red cursor-pointer hover:bg-red-500/[0.16] transition-colors group">
            <XCircle className="h-5 w-5 text-red-500 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-bold text-red-600 dark:text-red-400">
                {hardBreaches} hard breach{hardBreaches > 1 ? "es" : ""} detected
              </p>
              <p className="text-xs text-red-600/80 dark:text-red-400/80 mt-0.5">
                One or more positions have exceeded hard drift thresholds. Review allocation immediately.
              </p>
            </div>
            <span className="shrink-0 text-xs font-semibold text-red-500/70 group-hover:text-red-500 transition-colors">Jump to row ↓</span>
          </a>
        )
      })()}

      {/* Soft breach banner */}
      {hasBalance && softBreaches > 0 && hardBreaches === 0 && (() => {
        const firstSoft = holdings.find(h => h.isSoft)
        return (
          <a href={firstSoft ? `#holding-${firstSoft.ticker}` : "#holdings"} className="mb-4 flex items-center gap-3 rounded-xl border border-amber-400/40 bg-amber-400/10 dark:bg-amber-400/[0.08] px-5 py-3.5 glow-amber cursor-pointer hover:bg-amber-400/[0.14] transition-colors group">
            <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-bold text-amber-700 dark:text-amber-400">
                {softBreaches} soft drift{softBreaches > 1 ? "s" : ""} — redirect contributions
              </p>
              <p className="text-xs text-amber-700/80 dark:text-amber-400/80 mt-0.5">
                Positions outside tolerance bands. Redirect next month's contributions to restore balance.
              </p>
            </div>
            <span className="shrink-0 text-xs font-semibold text-amber-500/70 group-hover:text-amber-500 transition-colors">Jump to row ↓</span>
          </a>
        )
      })()}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">

        {/* Left — table + allocation bar */}
        <div className="space-y-4">

          {/* KPI row */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(hasBalance ? [
              { label: "Total Value", value: formatCurrency(totalValue, "SGD"), sub: "SGD · IBKR", accent: "" },
              { label: "Holdings", value: String(holdings.length), sub: "Active positions", accent: "" },
              { label: "Within Tolerance", value: `${withinCount}/${holdings.length}`, sub: "Bands respected", accent: withinCount === holdings.length ? "text-green-500" : "text-amber-500" },
              { label: "Hard Breaches", value: String(hardBreaches), sub: hardBreaches === 0 ? "None — all clear" : "Immediate review", accent: hardBreaches > 0 ? "text-red-500" : "text-green-500" },
            ] : [
              { label: "Holdings", value: String(holdings.length), sub: "Target allocations set", accent: "" },
              { label: "Largest Target", value: `${Math.max(...holdings.map(h => h.targetPct))}%`, sub: holdings.reduce((m, h) => h.targetPct > m.targetPct ? h : m, holdings[0])?.ticker ?? "—", accent: "" },
              { label: "Hard Caps Defined", value: String(holdings.filter(h => h.hardCapPct !== null).length), sub: "Governance guardrails", accent: "text-green-500" },
              { label: "Status", value: "Ready", sub: "Add first snapshot to begin", accent: "text-primary" },
            ]).map(({ label, value, sub, accent }) => (
              <div key={label} className="rounded-xl border border-border bg-card p-4 card-elevated flex flex-col gap-2">
                <p className="text-xs font-medium text-muted-foreground">{label}</p>
                <p className={`text-2xl font-black tabular-nums ${accent}`}>{value}</p>
                <p className="text-[11px] text-muted-foreground">{sub}</p>
              </div>
            ))}
          </div>

          {/* Update portfolio — three options */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border bg-muted/20">
              <h2 className="text-sm font-semibold mb-0.5">Update Your Portfolio</h2>
              <p className="text-xs text-muted-foreground">Keep your holdings current — choose how you'd like to enter new prices</p>
            </div>
            <div className="grid sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border">
              <div className="px-5 py-4 flex items-start gap-3">
                <div className="shrink-0 h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center mt-0.5">
                  <span className="text-sm font-black text-primary">✎</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold mb-1">Type it in manually</p>
                  <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
                    Click the pencil icon on any row below to edit that holding's units and price directly. Or use the button to update all holdings at once.
                  </p>
                  <PortfolioUpdateButton
                    defaultMode="manual"
                    label="Open Manual Entry"
                    holdings={holdings.map((h) => ({
                      id: h.id,
                      ticker: h.ticker,
                      name: h.name,
                      latestUnits: h.latestSnapshot?.units ?? 0,
                      latestPrice: h.latestSnapshot?.price ?? 0,
                    }))}
                  />
                </div>
              </div>
              <div className="px-5 py-4 flex items-start gap-3">
                <div className="shrink-0 h-8 w-8 rounded-lg bg-indigo-500/10 flex items-center justify-center mt-0.5">
                  <span className="text-sm font-black text-indigo-500">📷</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold mb-1">Upload a screenshot</p>
                  <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
                    Take a screenshot of your IBKR portfolio and upload it — Atlas reads the numbers automatically using AI and fills in all your holdings.
                  </p>
                  <PortfolioUpdateButton
                    defaultMode="screenshot"
                    label="Upload Screenshot"
                    holdings={holdings.map((h) => ({
                      id: h.id,
                      ticker: h.ticker,
                      name: h.name,
                      latestUnits: h.latestSnapshot?.units ?? 0,
                      latestPrice: h.latestSnapshot?.price ?? 0,
                    }))}
                  />
                </div>
              </div>

              {/* Live prices panel */}
              <div className="px-5 py-4 flex items-start gap-3">
                <div className="shrink-0 h-8 w-8 rounded-lg bg-green-500/10 flex items-center justify-center mt-0.5">
                  <span className="text-sm">📡</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold mb-1">Refresh live prices</p>
                  <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
                    Fetch current market prices automatically. Your existing unit counts are kept — only the price per unit is updated.
                  </p>
                  <RefreshPricesButton />
                </div>
              </div>
            </div>
          </div>

          {/* Holdings table */}
          <div id="holdings" className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div>
                <h2 className="text-sm font-semibold">Holdings</h2>
                <p className="text-[11px] text-muted-foreground mt-0.5">Hover a row and click the pencil icon to edit inline</p>
              </div>
              <span className="text-xs text-muted-foreground">Snapshot: {snapshotDate}</span>
            </div>

            {/* Column headers */}
            <div className="hidden md:grid grid-cols-[44px_1fr_80px_110px_90px_90px_90px_44px] gap-3 px-5 py-2.5 border-b border-border bg-muted/30">
              {["", "Name", "Trend", "Value", "Actual", "Target", "Drift", ""].map((h, i) => (
                <span key={i} className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</span>
              ))}
            </div>

            <div className="divide-y divide-border">
              {holdings.map((h) => (
                <HoldingRow
                  key={h.ticker}
                  holding={{
                    id: h.id,
                    ticker: h.ticker,
                    name: h.name,
                    color: h.color,
                    value: h.value,
                    actualPct: h.actualPct,
                    targetPct: h.targetPct,
                    hardCapPct: h.hardCapPct,
                    drift: h.drift,
                    withinBand: h.withinBand,
                    overCap: h.overCap,
                    isHard: h.isHard,
                    isSoft: h.isSoft,
                    latestSnapshot: h.latestSnapshot ? { units: h.latestSnapshot.units, price: h.latestSnapshot.price } : null,
                    sparklineValues: h.sparklineValues,
                  }}
                />
              ))}
            </div>

            {/* Stacked allocation bar */}
            <div className="px-5 py-4 border-t border-border bg-muted/20">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Allocation</p>
                <p className="text-[11px] text-muted-foreground">Target vs Actual</p>
              </div>
              {/* Actual bar */}
              <div className="mb-1">
                <span className="text-[10px] text-muted-foreground">Actual</span>
                <div className="flex h-3 rounded-lg overflow-hidden gap-px bg-muted mt-0.5">
                  {holdings.map((h) => (
                    <div
                      key={h.ticker}
                      style={{ width: `${h.actualPct}%`, backgroundColor: h.color }}
                      title={`${h.ticker}: ${h.actualPct.toFixed(1)}%`}
                      className="transition-all"
                    />
                  ))}
                </div>
              </div>
              {/* Target bar */}
              <div className="mb-3">
                <span className="text-[10px] text-muted-foreground">Target</span>
                <div className="flex h-2 rounded-lg overflow-hidden gap-px bg-muted mt-0.5">
                  {holdings.map((h) => (
                    <div
                      key={h.ticker}
                      style={{ width: `${h.targetPct}%`, backgroundColor: h.color, opacity: 0.4 }}
                      title={`${h.ticker} target: ${h.targetPct}%`}
                    />
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {holdings.map((h) => (
                  <div key={h.ticker} className="flex items-center gap-1.5">
                    <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: h.color }} />
                    <span className="text-[11px] text-muted-foreground">
                      <span className="font-semibold text-foreground">{h.ticker}</span> {h.actualPct.toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right — donut chart */}
        <div className="rounded-xl border border-border bg-card p-5 card-elevated self-start sticky top-4">
          <h2 className="text-sm font-semibold mb-1">Allocation Chart</h2>
          <p className="text-[11px] text-muted-foreground mb-4">Outer ring = actual · Inner ring = target</p>
          <AllocationDonut
            data={donutData}
            totalValue={totalValue}
          />

          {/* Per-holding drift summary */}
          <div className="mt-5 space-y-2.5 border-t border-border pt-4">
            {holdings.map((h) => {
              const driftColor = h.isHard
                ? "#ef4444"                                 // red-500 — hard breach always red
                : h.isSoft
                ? (h.drift < 0 ? "#facc15" : "#f97316")   // yellow-400 / orange-500
                : "#22c55e"                                 // green-500
              const pct = Math.min(100, (h.actualPct / (h.hardCapPct ?? 100)) * 100)
              return (
                <div key={h.ticker}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5">
                      <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: h.color }} />
                      <span className="text-[11px] font-bold">{h.ticker}</span>
                    </div>
                    <span className="text-[11px] tabular-nums" style={{ color: driftColor }}>
                      {h.actualPct.toFixed(1)}% / {h.targetPct}%
                    </span>
                  </div>
                  <div className="relative h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full transition-all"
                      style={{ width: `${Math.min(100, (h.actualPct / 70) * 100)}%`, backgroundColor: driftColor }}
                    />
                    {/* Target marker */}
                    <div
                      className="absolute inset-y-0 w-0.5 bg-foreground/40"
                      style={{ left: `${Math.min(100, (h.targetPct / 70) * 100)}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </Shell>
  )
}
