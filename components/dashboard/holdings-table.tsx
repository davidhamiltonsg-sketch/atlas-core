import { Card, CardHeader } from "@/components/ui/primitives"
import { altLabelFor, isInScope } from "@/lib/approved-alternatives"
import { formatCurrency } from "@/lib/utils"

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
}

// Share counts can be fractional (e.g. BTC) — show up to 4 dp but trim trailing zeros.
function fmtUnits(u: number): string {
  return u.toLocaleString("en-US", { maximumFractionDigits: 4 })
}

// Tiny inline price-trend sparkline.
function Sparkline({ data, up }: { data: number[]; up: boolean }) {
  if (data.length < 2) return <span className="text-[10px] text-muted-foreground">—</span>
  const w = 60, h = 20
  const min = Math.min(...data), max = Math.max(...data), range = max - min || 1
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * (h - 2) - 1}`).join(" ")
  const stroke = up ? "#22c55e" : "#ef4444"
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0">
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// Dashboard "Your Holdings" — the first-page table: holding (with approved alternative
// labelled where held), price trend, shares held, live price, value, your cost, and unrealised gain.
export function HoldingsTable({ positions, totalValue }: { positions: HoldingRow[]; totalValue: number }) {
  const totalUnreal = positions.reduce((s, p) => s + (p.unrealisedSgd ?? 0), 0)
  const hasAnyCost = positions.some(p => p.unrealisedSgd !== null)

  return (
    <Card>
      <CardHeader title="Your Holdings" subtitle="Shares · live price · value · your cost · unrealised gain — approved alternatives shown where held" />
      <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-[760px]">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border bg-muted/30">
              <th className="px-5 py-2.5 font-semibold">Holding</th>
              <th className="px-3 py-2.5 font-semibold">Trend</th>
              <th className="px-3 py-2.5 font-semibold text-right">Shares</th>
              <th className="px-3 py-2.5 font-semibold text-right">Price</th>
              <th className="px-3 py-2.5 font-semibold text-right">Value</th>
              <th className="px-3 py-2.5 font-semibold text-right">Your cost</th>
              <th className="px-5 py-2.5 font-semibold text-right">Unrealised gain</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {positions.map((p) => {
              const alt = altLabelFor(p.ticker)
              const offScope = !isInScope(p.ticker)
              const up = p.priceHistory.length > 1
                ? p.priceHistory[p.priceHistory.length - 1] >= p.priceHistory[0]
                : (p.priceChangePct ?? 0) >= 0
              const gainCls = p.unrealisedSgd === null ? "text-muted-foreground" : p.unrealisedSgd >= 0 ? "text-green-500" : "text-red-500"
              return (
                <tr key={p.ticker} className="hover:bg-accent/20 transition-colors">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="h-2 w-2 rounded-full shrink-0" style={{ background: p.color }} />
                      <span className="font-bold">{p.ticker}</span>
                      {alt && <span className="rounded-full bg-indigo-500/10 text-indigo-500 dark:text-indigo-400 ring-1 ring-indigo-500/20 px-1.5 py-0.5 text-[9px] font-semibold">{alt}</span>}
                      {offScope && <span className="rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-1 ring-amber-500/20 px-1.5 py-0.5 text-[9px] font-semibold">not in plan — review</span>}
                    </div>
                    <span className="text-[11px] text-muted-foreground">{p.name}</span>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <Sparkline data={p.priceHistory} up={up} />
                      {p.priceChangePct !== null && (
                        <span className={`text-[10px] tabular-nums ${p.priceChangePct >= 0 ? "text-green-500" : "text-red-500"}`}>
                          {p.priceChangePct >= 0 ? "▲" : "▼"}{Math.abs(p.priceChangePct).toFixed(1)}%
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {p.units > 0 ? fmtUnits(p.units) : <span className="text-muted-foreground">0</span>}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {p.latestPrice > 0 ? `$${p.latestPrice.toFixed(2)}` : "—"}
                    <span className="ml-1 text-[10px] text-muted-foreground">USD</span>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums font-medium">
                    {p.value > 0 ? formatCurrency(p.value, "SGD") : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {p.avgCostUsd !== null ? `$${p.avgCostUsd.toFixed(2)}` : "—"}
                    {p.avgCostUsd !== null && <span className="ml-1 text-[10px] text-muted-foreground">USD</span>}
                  </td>
                  <td className="px-5 py-3 text-right">
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
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-border bg-muted/20 font-semibold">
              <td className="px-5 py-3" colSpan={4}>Total</td>
              <td className="px-3 py-3 text-right tabular-nums">{formatCurrency(totalValue, "SGD")}</td>
              <td />
              <td className={`px-5 py-3 text-right tabular-nums ${!hasAnyCost ? "text-muted-foreground" : totalUnreal >= 0 ? "text-green-500" : "text-red-500"}`}>
                {hasAnyCost ? `${totalUnreal >= 0 ? "+" : ""}${formatCurrency(totalUnreal, "SGD")}` : "—"}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="px-5 py-2.5 border-t border-border bg-muted/20 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{positions.length} holding{positions.length !== 1 ? "s" : ""} · cost &amp; gain from your trade log</span>
        <a href="/portfolio" className="font-semibold text-primary hover:underline">Manage holdings →</a>
      </div>
    </Card>
  )
}
