import { Card, CardHeader } from "@/components/ui/primitives"
import { altLabelFor, isInScope } from "@/lib/approved-alternatives"
import { formatCurrency } from "@/lib/utils"
import { StaleBadge } from "@/components/stale-badge"
import { StatusChip, type StatusChipStatus } from "@/components/ui/status-chip"
import { Sparkline } from "@/components/charts/sparkline"

export type HoldingStatus = "healthy" | "soft" | "hard"

export interface HoldingRow {
  ticker: string
  name: string
  color: string
  units: number
  value: number
  latestPrice: number
  priceChangePct: number | null
  priceHistory: number[]
  avgCostUsd: number | null
  unrealisedSgd: number | null
  unrealisedPct: number | null
  // Band position + governance status (added for the command-deck unified row)
  actualPct: number
  targetPct: number
  toleranceBand: number
  hardCapPct: number | null
  status: HoldingStatus
  // This month's plain-English action for this holding (from the market-aware DCA plan)
  thisMonth: { amount: number; tag: string; reason: string } | null
  // True for a synthetic aggregate row (e.g. the BTC + IBIT Bitcoin sleeve): value,
  // unrealised, and band are meaningful, but per-instrument shares/price/avg-cost are not.
  aggregate?: boolean
}

// Share counts can be fractional (e.g. BTC) — show up to 4 dp but trim trailing zeros.
function fmtUnits(u: number): string {
  return u.toLocaleString("en-US", { maximumFractionDigits: 4 })
}

// Inline "position within the band" gauge — healthy (green) zone target±tolerance,
// hard (red) zone beyond the cap, a target tick, and a dot at the current weight.
function BandBar({ actualPct, targetPct, toleranceBand, hardCapPct, status }: {
  actualPct: number; targetPct: number; toleranceBand: number; hardCapPct: number | null; status: HoldingStatus
}) {
  const healthyLow = Math.max(0, targetPct - toleranceBand)
  const healthyHigh = targetPct + toleranceBand
  const hard = hardCapPct ?? targetPct + toleranceBand * 2
  const scale = Math.max(hard + 2, actualPct + 1, healthyHigh + 1)
  const pct = (v: number) => `${Math.min(100, Math.max(0, (v / scale) * 100))}%`
  const dot = status === "hard" ? "hsl(var(--danger))" : status === "soft" ? "hsl(var(--warning))" : "hsl(var(--success))"
  return (
    <div className="w-[120px]">
      <div className="relative h-3 rounded bg-muted overflow-hidden">
        {/* hard zone beyond the cap */}
        {hardCapPct !== null && (
          <div className="absolute inset-y-0 bg-danger/15" style={{ left: pct(hard), right: 0 }} />
        )}
        {/* healthy zone */}
        <div className="absolute inset-y-0 bg-success/20 bar-fill" style={{ left: pct(healthyLow), width: `calc(${pct(healthyHigh)} - ${pct(healthyLow)})` }} />
        {/* target tick */}
        <div className="absolute inset-y-0 w-px bg-foreground/30" style={{ left: pct(targetPct) }} />
        {/* current-weight dot */}
        <div className="absolute top-1/2 h-2 w-2 rounded-full -translate-x-1/2 -translate-y-1/2 ring-1 ring-background marker-land" style={{ left: pct(actualPct), background: dot }} />
      </div>
      <div className="mt-0.5 flex justify-between text-[9px] tabular-nums text-muted-foreground">
        <span className="font-semibold text-foreground">{actualPct.toFixed(1)}%</span>
        <span>target {targetPct}%</span>
      </div>
    </div>
  )
}

const STATUS_CHIP: Record<HoldingStatus, { label: string; status: StatusChipStatus }> = {
  healthy: { label: "Healthy",    status: "good" },
  soft:    { label: "Drifting",   status: "warn" },
  hard:    { label: "Over limit", status: "crit" },
}

// A concise plain-English "this month" cell from the DCA allocation.
function ThisMonth({ tm, currency }: { tm: HoldingRow["thisMonth"]; currency: string }) {
  if (!tm) return <span className="text-muted-foreground">—</span>
  if (tm.amount > 0) {
    return (
      <div>
        <div className="font-bold tabular-nums text-success">+{formatCurrency(tm.amount, currency)}</div>
        <div className="text-[10px] text-muted-foreground capitalize">{tm.tag === "dip-buy" ? "buy the dip" : tm.tag}</div>
      </div>
    )
  }
  // Nothing this month — say why, briefly. Use the plan's currency, not a bare "$".
  const reason = /high/i.test(tm.reason) ? "at high — skip"
    : /IBIT/i.test(tm.reason) ? "hold — → IBIT"
    : /ceiling|paused|over/i.test(tm.reason) ? "paused"
    : "hold"
  return <span className="text-muted-foreground">{formatCurrency(0, currency)} · {reason}</span>
}

// Dashboard "Your Holdings" — the command-deck unified row: holding (with approved
// alternative labelled where held), price trend, shares, live price, value, unrealised
// gain, position within its band, governance status, and this month's action.
export function HoldingsTable({ positions, totalValue, priceStale = false, contributionCurrency = "USD", plainEnglish = false }: { positions: HoldingRow[]; totalValue: number; priceStale?: boolean; contributionCurrency?: string; plainEnglish?: boolean }) {
  const totalUnreal = positions.reduce((s, p) => s + (p.unrealisedSgd ?? 0), 0)
  const valuationComplete = positions.filter(p=>p.value>0).every(p => p.unrealisedSgd !== null)
  // Plain-English column wording for Silicon Brick Road; institutional wording for Atlas Core.
  const L = plainEnglish
    ? { title: "Your Funds", subtitle: "What you hold, how it's doing, and what to buy this month", unreal: "Paper gain/loss", band: "Where it sits", footer: "and this month's plan" }
    : { title: "Your Holdings", subtitle: "Trend · shares · price · value · unrealised gain · position in its band · status · what to do this month", unreal: "Unrealised", band: "Position in band", footer: "band & action from the live plan" }

  return (
    <Card>
      <CardHeader
        title={L.title}
        subtitle={L.subtitle}
        right={priceStale ? <StaleBadge title="Live prices unavailable — values use the last verified prices." /> : undefined}
      />
      <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-[920px] sm:min-w-[1000px]">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border bg-muted/30">
              <th className="px-5 py-2.5 font-semibold">Holding</th>
              <th className="hidden sm:table-cell px-3 py-2.5 font-semibold">Trend</th>
              <th className="px-3 py-2.5 font-semibold text-right">Shares</th>
              <th className="px-3 py-2.5 font-semibold text-right">Price / Avg cost</th>
              <th className="px-3 py-2.5 font-semibold text-right">Value</th>
              <th className="px-3 py-2.5 font-semibold text-right">{L.unreal}</th>
              <th className="px-3 py-2.5 font-semibold">{L.band}</th>
              <th className="px-3 py-2.5 font-semibold">Status</th>
              <th className="px-5 py-2.5 font-semibold text-right">This month</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {positions.map((p) => {
              const alt = altLabelFor(p.ticker)
              const offScope = !isInScope(p.ticker)
              const gainCls = p.unrealisedSgd === null ? "text-muted-foreground" : p.unrealisedSgd >= 0 ? "text-success" : "text-danger"
              const chip = STATUS_CHIP[p.status]
              return (
                <tr key={p.ticker} className="hover:bg-accent/20 transition-colors">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="h-2 w-2 rounded-full shrink-0" style={{ background: p.color }} />
                      <span className="font-bold">{p.ticker}</span>
                      {alt && <span className="rounded-full bg-violet-500/10 text-violet-500 dark:text-violet-400 ring-1 ring-violet-500/20 px-1.5 py-0.5 text-[9px] font-semibold">{alt}</span>}
                      {offScope && <StatusChip status="warn" label="not in plan — review" className="px-1.5 text-[9px]" />}
                    </div>
                    <span className="text-[11px] text-muted-foreground">{p.name}</span>
                  </td>
                  <td className="hidden sm:table-cell px-3 py-3">
                    {p.priceHistory.length >= 2
                      ? <Sparkline data={p.priceHistory} />
                      : <span className="text-[10px] text-muted-foreground/40">—</span>}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {p.aggregate ? <span className="text-muted-foreground">—</span>
                      : p.units > 0 ? fmtUnits(p.units) : <span className="text-muted-foreground">0</span>}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {p.aggregate ? <span className="text-muted-foreground">—</span> : (
                      <>
                        {p.latestPrice > 0 ? <div className="font-medium">${p.latestPrice.toFixed(2)}</div> : <span className="text-muted-foreground">—</span>}
                        {p.avgCostUsd != null && (
                          <div className={`text-[10px] tabular-nums ${p.avgCostUsd > 0 && p.latestPrice > 0 ? (p.latestPrice >= p.avgCostUsd ? "text-success" : "text-danger") : "text-muted-foreground"}`}>
                            avg ${p.avgCostUsd.toFixed(2)}
                          </div>
                        )}
                      </>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums font-medium">
                    {p.value > 0 ? formatCurrency(p.value, "SGD") : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {p.unrealisedSgd !== null ? (
                      <>
                        <div className={`font-semibold tabular-nums ${gainCls}`}>
                          {p.unrealisedSgd >= 0 ? "+" : ""}{formatCurrency(p.unrealisedSgd, "SGD")}
                        </div>
                        {p.unrealisedPct !== null && (
                          <div className={`text-[10px] tabular-nums ${gainCls}`}>{p.unrealisedPct >= 0 ? "+" : ""}{p.unrealisedPct.toFixed(1)}%</div>
                        )}
                      </>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-3">
                    <BandBar actualPct={p.actualPct} targetPct={p.targetPct} toleranceBand={p.toleranceBand} hardCapPct={p.hardCapPct} status={p.status} />
                  </td>
                  <td className="px-3 py-3">
                    <StatusChip status={chip.status} label={chip.label} />
                  </td>
                  <td className="px-5 py-3 text-right">
                    <ThisMonth tm={p.thisMonth} currency={contributionCurrency} />
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-border bg-muted/20 font-semibold">
              <td className="px-5 py-3">Total</td>
              <td className="hidden sm:table-cell" />
              <td />
              <td />
              <td className="px-3 py-3 text-right tabular-nums">{formatCurrency(totalValue, "SGD")}</td>
              <td className={`px-3 py-3 text-right tabular-nums ${!valuationComplete ? "text-muted-foreground" : totalUnreal >= 0 ? "text-success" : "text-danger"}`}>
                {valuationComplete ? `${totalUnreal >= 0 ? "+" : ""}${formatCurrency(totalUnreal, "SGD")}` : "Needs reconciliation"}
              </td>
              <td colSpan={3} />
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="px-5 py-2.5 border-t border-border bg-muted/20 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{positions.length} {plainEnglish ? "fund" : "holding"}{positions.length !== 1 ? "s" : ""} · IBKR snapshot valuation · {L.footer}</span>
        <a href="/portfolio" className="font-semibold text-primary hover:underline">{plainEnglish ? "Manage funds →" : "Manage holdings →"}</a>
      </div>
    </Card>
  )
}
