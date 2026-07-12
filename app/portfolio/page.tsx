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
import { applyBitcoinSleeve, BITCOIN_SLEEVE_TARGET_PCT } from "@/lib/next-best-move"
import { activePortfolioContext } from "@/lib/active-portfolio"
import { openPositionValuation } from "@/lib/valuation"
import { getUsdSgdRate } from "@/lib/holdings-sync"
import { getConstitution } from "@/lib/constitutions"
import { getCachedUsdSgdRate, clearFxCache } from "@/lib/fx-cache"

// Live refresh can poll IBKR Flex (~25s) to sync share counts — allow headroom.
export const maxDuration = 60

async function getPortfolioData(userId: string) {
  const [holdings, trades, usdSgdRate] = await Promise.all([
    db.holding.findMany({
      where: { userId },
      include: { snapshots: { orderBy: { date: "desc" }, take: 8 } },
      orderBy: { targetPct: "desc" },
    }),
    db.trade.findMany({ where: { userId }, orderBy: { date: "asc" } }),
    getCachedUsdSgdRate(),
  ])

  // Weighted-average cost basis per ticker (SGD total, USD per unit)
  const avgCostMap: Record<string, { units: number; sgd: number; usd: number }> = {}
  for (const t of trades) {
    if (!avgCostMap[t.ticker]) avgCostMap[t.ticker] = { units: 0, sgd: 0, usd: 0 }
    const a = avgCostMap[t.ticker]
    if (t.type === "BUY") { a.units += t.units; a.sgd += t.amount; a.usd += t.units * t.price }
    else { const su = a.units > 0 ? a.sgd / a.units : 0; const uu = a.units > 0 ? a.usd / a.units : 0; const rem = Math.max(0, a.units - t.units); a.units = rem; a.sgd = rem * su; a.usd = rem * uu }
  }

  const totalValue = holdings.reduce((sum, h) => sum + (h.snapshots[0]?.value ?? 0), 0)
  const hasBalance = totalValue > 0

  // Bitcoin sleeve effective targets: BTC runs off (hold-in-place), IBIT accumulates. Keeps
  // the portfolio's drift/instructions consistent with the rest of the app (no "buy BTC").
  const effTarget: Record<string, number> = {}
  for (const p of applyBitcoinSleeve(holdings.map(h => ({
    ticker: h.ticker,
    actualPct: hasBalance ? ((h.snapshots[0]?.value ?? 0) / totalValue) * 100 : 0,
    targetPct: h.targetPct,
  })))) effTarget[p.ticker] = p.targetPct

  return {
    holdings: holdings.map((h) => {
      const latest = h.snapshots[0]
      const value = latest?.value ?? 0
      const actualPct = hasBalance ? (value / totalValue) * 100 : 0
      const tgt = effTarget[h.ticker] ?? h.targetPct
      const drift = hasBalance ? actualPct - tgt : 0
      const withinBand = !hasBalance || Math.abs(drift) <= h.toleranceBand
      const overCap = hasBalance && h.hardCapPct !== null && actualPct > h.hardCapPct
      const ht = HARD_THRESHOLDS[h.ticker]
      const isHard = hasBalance && (overCap ||
        (ht?.low !== undefined && actualPct < ht.low) ||
        (ht !== undefined && actualPct > ht.high))
      const isSoft = hasBalance && !isHard && !withinBand
      const sparklineValues = h.snapshots.map(s => s.value)

      const cb = avgCostMap[h.ticker]
      const valuation=openPositionValuation({value,units:latest?.units??0,snapshotCostBasis:latest?.costBasis,snapshotUnrealizedPnl:latest?.unrealizedPnl,reconstructedCostBasis:cb?.sgd,reconstructedAveragePrice:cb&&cb.units>0?cb.usd/cb.units:null,reportingFxRate:usdSgdRate})
      const avgCostUsd=valuation.averagePriceInstrumentCurrency, unrealisedSgd=valuation.reconciles?valuation.unrealizedPnl:null, unrealisedPct=valuation.reconciles?valuation.unrealizedReturnPct:null

      return { ...h, targetPct: tgt, latestSnapshot: latest ?? null, value, actualPct, drift, withinBand, overCap, isHard, isSoft, sparklineValues, avgCostUsd, unrealisedSgd, unrealisedPct }
    }),
    totalValue,
    hasBalance,
  }
}

export default async function Portfolio() {
  try {
    const session = await getSession()
    if (!session) redirect("/login")
    const active = await activePortfolioContext(session)
    const isSbr = active.constitutionId === "silicon-brick-road"
    const targetSleeveCount = getConstitution(active.constitutionId).funds.length
    const { holdings, totalValue, hasBalance } = await getPortfolioData(active.owner.id)

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
      // Server-rendered freshness is intentionally evaluated at request time.
      // eslint-disable-next-line react-hooks/purity
      ? Math.floor((Date.now() - latestDate.getTime()) / 86_400_000)
      : null

    const withinCount = holdings.filter((h) => h.withinBand && !h.overCap).length
    const hardBreaches = holdings.filter((h) => h.isHard).length
    const softBreaches = holdings.filter((h) => h.isSoft).length

    // Merge BTC+IBIT into one sleeve entry for visual display (donut, bars, drift summary)
    const btcSlot = holdings.find(h => h.ticker === "BTC")
    const ibitSlot = holdings.find(h => h.ticker === "IBIT")
    const displaySlots = (btcSlot && ibitSlot)
      ? holdings
          .filter(h => h.ticker !== "IBIT")
          .map(h => h.ticker !== "BTC" ? h : {
            ...h,
            name: "Bitcoin sleeve",
            value: h.value + ibitSlot.value,
            actualPct: h.actualPct + ibitSlot.actualPct,
            targetPct: BITCOIN_SLEEVE_TARGET_PCT,
            drift: (h.actualPct + ibitSlot.actualPct) - BITCOIN_SLEEVE_TARGET_PCT,
            withinBand: Math.abs((h.actualPct + ibitSlot.actualPct) - BITCOIN_SLEEVE_TARGET_PCT) <= h.toleranceBand,
            isSoft: !h.isHard && Math.abs((h.actualPct + ibitSlot.actualPct) - BITCOIN_SLEEVE_TARGET_PCT) > h.toleranceBand,
          })
      : holdings

    const donutData = displaySlots.map((h) => ({
      ticker: h.ticker,
      name: h.name,
      actualPct: h.actualPct,
      targetPct: h.targetPct,
      color: h.color,
      value: h.value,
    }))

    return (
      <Shell title="Position Ledger" subtitle={`${isSbr ? "Silicon Brick Road" : "Atlas Core"} · ownership, basis and governed bands`} userName={session.name} isAdmin={session.role === "admin"} constitutionId={active.constitutionId}>
      <div className="portfolio-deck">
      <section className="portfolio-deck-hero">
        <div><p>LIVE POSITION LEDGER</p><h1>{hasBalance ? "What you own, without the noise." : "Your governed portfolio is ready."}</h1><span>{hasBalance ? "Target holdings lead. Historic and migrating instruments remain in the audit trail without crowding today’s portfolio." : "The target architecture is in place. Your first confirmed IBKR snapshot will activate performance, basis and drift controls."}</span></div>
        <dl><div><dt>Portfolio value</dt><dd>{formatCurrency(totalValue,"SGD")}</dd></div><div><dt>Target sleeves</dt><dd>{targetSleeveCount}</dd></div><div><dt>Governance</dt><dd className={hardBreaches ? "down" : "up"}>{hardBreaches ? `${hardBreaches} review` : "Clear"}</dd></div></dl>
      </section>

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
                Positions outside tolerance bands. Redirect next month&apos;s contributions to restore balance.
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
              <p className="text-xs text-muted-foreground">Keep your holdings current — choose how you&apos;d like to enter new prices</p>
            </div>
            <div className="grid sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border">
              <div className="px-5 py-4 flex items-start gap-3">
                <div className="shrink-0 h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center mt-0.5">
                  <span className="text-sm font-black text-primary">✎</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold mb-1">Type it in manually</p>
                  <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
                    Click the pencil icon on any row below to edit that holding&apos;s units and price directly. Or use the button to update all holdings at once.
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
                <div className="shrink-0 h-8 w-8 rounded-lg bg-violet-500/10 flex items-center justify-center mt-0.5">
                  <span className="text-sm font-black text-violet-500">📷</span>
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
                <p className="text-[11px] text-muted-foreground mt-0.5">Use the edit control on a row to update units and price</p>
              </div>
              <span className="text-xs text-muted-foreground">Snapshot: {snapshotDate}</span>
            </div>

            {/* Column headers */}
            <div className="hidden md:grid grid-cols-[44px_1fr_80px_110px_90px_90px_90px_44px] gap-3 px-5 py-2.5 border-b border-border bg-muted/30">
              {["", "Name", "Trend", "Value / P&L", "Actual", "Target", "Drift", ""].map((h, i) => (
                <span key={i} className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</span>
              ))}
            </div>

            <div className="divide-y divide-border">
              {(() => {
                const sleeveTickers = new Set(["BTC", "IBIT"])
                const mainHoldings = holdings.filter(h => !sleeveTickers.has(h.ticker))
                const sleeveHoldings = holdings.filter(h => sleeveTickers.has(h.ticker))
                const renderRow = (h: typeof holdings[0]) => (
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
                      avgCostUsd: h.avgCostUsd,
                      unrealisedSgd: h.unrealisedSgd,
                      unrealisedPct: h.unrealisedPct,
                    }}
                  />
                )
                return (
                  <>
                    {mainHoldings.map(renderRow)}
                    {sleeveHoldings.length > 0 && (
                      <>
                        <div className="px-5 py-2 bg-muted/20 flex items-center gap-2">
                          <div className="h-1.5 w-1.5 rounded-full bg-orange-400" />
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Bitcoin sleeve — combined target {BITCOIN_SLEEVE_TARGET_PCT}%
                            {btcSlot && ibitSlot && hasBalance && (
                              <span className="ml-2 normal-case font-normal">
                                ({(btcSlot.actualPct + ibitSlot.actualPct).toFixed(1)}% actual)
                              </span>
                            )}
                          </span>
                        </div>
                        {sleeveHoldings.map(renderRow)}
                      </>
                    )}
                  </>
                )
              })()}
            </div>

            {/* Stacked allocation bar */}
            <div className="px-5 py-4 border-t border-border bg-muted/20">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Allocation</p>
                <p className="text-[11px] text-muted-foreground">Target vs Actual</p>
              </div>
              {/* Actual bar */}
              <div className="mb-1">
                <span className="text-[10px] text-muted-foreground">Actual</span>
                <div className="flex h-3 rounded-lg overflow-hidden gap-px bg-muted mt-0.5">
                  {displaySlots.map((h) => (
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
                  {displaySlots.map((h) => (
                    <div
                      key={h.ticker}
                      style={{ width: `${h.targetPct}%`, backgroundColor: h.color, opacity: 0.4 }}
                      title={`${h.ticker} target: ${h.targetPct}%`}
                    />
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {displaySlots.map((h) => (
                  <div key={h.ticker} className="flex items-center gap-1.5">
                    <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: h.color }} />
                    <span className="text-[11px] text-muted-foreground">
                      <span className="font-semibold text-foreground">{h.name}</span> {h.actualPct.toFixed(1)}%
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
            {displaySlots.map((h) => {
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
                      {h.actualPct.toFixed(1)}% / {h.targetPct.toFixed(1)}%
                    </span>
                  </div>
                  <div className="relative h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full bar-fill transition-all"
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
      </div>
    </Shell>
      )
  } finally {
    clearFxCache()
  }
}
