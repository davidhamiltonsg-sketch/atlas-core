"use client"

import { useState, useTransition } from "react"
import { TrendingUp, TrendingDown, Minus, AlertTriangle, XCircle, CheckCircle2, Pencil, Check, X, Trash2 } from "lucide-react"
import { updateHoldingsManually, removeErroneousPosition } from "@/app/portfolio/actions"
import { Sparkline } from "@/components/charts/sparkline"
import { sgdUnitPrice } from "@/lib/unit-price"

interface HoldingRowProps {
  holding: {
    id: string
    ticker: string
    name: string
    color: string
    value: number
    actualPct: number
    targetPct: number
    hardCapPct: number | null
    drift: number
    withinBand: boolean
    overCap: boolean
    isHard: boolean
    isSoft: boolean
    latestSnapshot: { units: number; price: number } | null
    sparklineValues?: number[]
    avgCostUsd?: number | null
    unrealisedSgd?: number | null
    unrealisedPct?: number | null
    /** Valued holding outside the governed universe — no target, no drift advice. */
    legacy?: boolean
    /** Owner-only correction: zero out an erroneous non-governed row (append-only). */
    canRemove?: boolean
  }
}

export function HoldingRow({ holding: h }: HoldingRowProps) {
  const [editing, setEditing] = useState(false)
  const [units, setUnits] = useState(String(h.latestSnapshot?.units ?? 0))
  const [price, setPrice] = useState(String(h.latestSnapshot?.price ?? 0))
  const [saved, setSaved] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleRemove() {
    if (!window.confirm(`Remove erroneous ${h.ticker} position? The row is zeroed and logged — history stays in the audit trail.`)) return
    setRemoveError(null)
    startTransition(async () => {
      const result = await removeErroneousPosition(h.id)
      if (result?.error) setRemoveError(result.error)
    })
  }

  const DriftIcon = h.drift > 0.05 ? TrendingUp : h.drift < -0.05 ? TrendingDown : Minus
  // Semantic status tokens: hard breach = danger, any soft drift = warning
  // (direction is carried by the trend icon and the ↑/↓ copy, not a second
  // hue — same collapse as the compliance/threshold surfaces), healthy = success.
  const driftColor = h.isHard
    ? "text-danger"
    : h.isSoft
    ? "text-warning"
    : "text-success"
  const StatusIcon = h.isHard ? XCircle : h.isSoft ? AlertTriangle : CheckCircle2
  const statusIconCls = driftColor
  const pulseCls = h.isHard ? "pulse-red" : ""
  const rowAccent = h.isHard
    ? "border-l-4 border-danger bg-danger/[0.02]"
    : h.isSoft
    ? "border-l-[3px] border-warning bg-warning/[0.02]"
    : "border-l-4 border-transparent"

  function handleSave() {
    const u = parseFloat(units)
    const p = parseFloat(price)
    if (!u || !p || u <= 0 || p <= 0) return
    startTransition(async () => {
      await updateHoldingsManually([{ holdingId: h.id, units: u, price: p }])
      setSaved(true)
      setEditing(false)
      setTimeout(() => setSaved(false), 2000)
    })
  }

  function handleCancel() {
    setUnits(String(h.latestSnapshot?.units ?? 0))
    setPrice(String(h.latestSnapshot?.price ?? 0))
    setEditing(false)
  }

  const liveValue = (parseFloat(units) || 0) * (parseFloat(price) || 0)

  return (
    <div
      id={`holding-${h.ticker}`}
      className={`group grid grid-cols-[44px_1fr] md:grid-cols-[44px_1fr_80px_110px_90px_90px_90px_44px] items-center gap-x-3 gap-y-0.5 px-5 py-3.5 hover:bg-accent/30 transition-colors scroll-mt-4 ${rowAccent} ${saved ? "bg-success/[0.04]" : ""}`}
    >
      {/* Color dot + ticker */}
      <div className="flex items-center gap-2">
        <div className="h-2.5 w-2.5 rounded-full shrink-0 ring-2 ring-offset-1 ring-offset-card" style={{ backgroundColor: h.color, boxShadow: `0 0 8px ${h.color}60` }} />
        <span className="text-xs font-extrabold tracking-tight">{h.ticker}</span>
      </div>

      <span className="text-xs text-muted-foreground truncate">{h.name}</span>

      {/* Sparkline */}
      <div className="hidden md:flex items-center justify-center">
        {h.sparklineValues && h.sparklineValues.length >= 2 ? (
          <Sparkline data={[...h.sparklineValues].reverse()} color={h.color} />
        ) : (
          <span className="text-[10px] text-muted-foreground/40">—</span>
        )}
      </div>

      {/* Value — editable when in edit mode */}
      {editing ? (
        <div className="hidden md:flex flex-col gap-1">
          <label className="text-[9px] text-muted-foreground uppercase tracking-wider">Preview (fund currency)</label>
          <span className="text-xs font-semibold tabular-nums text-primary">
            {liveValue > 0 ? liveValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
          </span>
        </div>
      ) : (
        <div className="hidden md:flex flex-col items-end gap-0.5">
          <span className="text-xs font-semibold tabular-nums">
            S${h.value.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          {h.unrealisedSgd !== null && h.unrealisedSgd !== undefined && (
            <span className={`text-[10px] font-semibold tabular-nums ${h.unrealisedSgd >= 0 ? "text-success" : "text-danger"}`}>
              {h.unrealisedSgd >= 0 ? "+" : ""}S${Math.abs(h.unrealisedSgd).toLocaleString("en-SG", { maximumFractionDigits: 0 })}
              {h.unrealisedPct !== null && h.unrealisedPct !== undefined && ` (${h.unrealisedPct >= 0 ? "+" : ""}${h.unrealisedPct.toFixed(1)}%)`}
            </span>
          )}
          {(() => {
            // Derive, don't trust: Snapshot.price has no currency guarantee (lib/unit-price.ts),
            // so the displayed per-unit figures come from the SGD value of the same snapshot.
            const units = h.latestSnapshot?.units ?? 0
            const nowSgd = sgdUnitPrice(units, h.value)
            if (nowSgd === null) return null
            const avgSgd = h.unrealisedSgd !== null && h.unrealisedSgd !== undefined && units > 0 ? (h.value - h.unrealisedSgd) / units : null
            const avgLabel = avgSgd !== null
              ? `avg S$${avgSgd.toFixed(2)} · `
              : h.avgCostUsd !== null && h.avgCostUsd !== undefined ? `avg ${h.avgCostUsd.toFixed(2)} (fund ccy) · ` : ""
            return (
              <span className="text-[9px] text-muted-foreground tabular-nums">
                {avgLabel}now S${nowSgd.toFixed(2)}
              </span>
            )
          })()}
        </div>
      )}

      {/* Actual % */}
      <div className="hidden md:flex flex-col items-end gap-1">
        <span className="text-xs font-semibold tabular-nums">{h.actualPct.toFixed(1)}%</span>
        <div className="w-full h-1 rounded-full bg-muted overflow-hidden">
          <div className="h-full rounded-full bar-fill transition-all" style={{ width: `${Math.min(100, h.actualPct / 0.7)}%`, backgroundColor: h.color }} />
        </div>
      </div>

      {/* Target % with inline edit inputs */}
      {editing ? (
        <div className="hidden md:flex flex-col gap-1 col-span-2">
          <div className="flex gap-1.5">
            <div className="flex flex-col gap-0.5">
              <label className="text-[9px] text-muted-foreground uppercase tracking-wider">Units</label>
              <input
                type="number"
                value={units}
                onChange={e => setUnits(e.target.value)}
                className="w-20 rounded border border-border bg-card px-2 py-1 text-xs tabular-nums focus:outline-none focus:ring-1 focus:ring-primary"
                step="0.01"
                min="0"
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-0.5">
              <label className="text-[9px] text-muted-foreground uppercase tracking-wider">Price (fund ccy)</label>
              <input
                type="number"
                value={price}
                onChange={e => setPrice(e.target.value)}
                className="w-24 rounded border border-border bg-card px-2 py-1 text-xs tabular-nums focus:outline-none focus:ring-1 focus:ring-primary"
                step="0.01"
                min="0"
              />
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="hidden md:flex flex-col items-end gap-1">
            {h.legacy ? (
              <span className="text-xs text-muted-foreground tabular-nums">—</span>
            ) : (
              <>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {h.targetPct.toFixed(1)}%
                  {h.hardCapPct && <span className="text-[10px] ml-1 opacity-50">/{h.hardCapPct}%</span>}
                </span>
                <div className="w-full h-1 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full opacity-40" style={{ width: `${Math.min(100, h.targetPct / 0.7)}%`, backgroundColor: h.color }} />
                </div>
              </>
            )}
          </div>

          {/* Drift — meaningless for a legacy row without a governed target */}
          {h.legacy ? (
            <div className="hidden md:flex items-center justify-end text-[10px] text-muted-foreground">awaiting sale</div>
          ) : (
            <div className={`hidden md:flex items-center gap-1 justify-end text-xs font-bold tabular-nums ${driftColor}`}>
              <DriftIcon className="h-3 w-3 shrink-0" />
              {h.drift >= 0 ? "+" : ""}{h.drift.toFixed(1)}%
              {h.overCap && <span className="ml-1 rounded bg-danger/15 px-1 text-[9px] font-bold text-danger">CAP</span>}
            </div>
          )}
        </>
      )}

      {/* Action column — edit/save/cancel or status icon */}
      <div className="hidden md:flex items-center justify-end gap-1">
        {editing ? (
          <>
            <button
              onClick={handleSave}
              disabled={isPending}
              className="flex h-6 w-6 items-center justify-center rounded bg-success/15 text-success hover:bg-success/25 transition-colors disabled:opacity-50"
              title="Save changes"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={handleCancel}
              className="flex h-6 w-6 items-center justify-center rounded bg-muted text-muted-foreground hover:bg-accent transition-colors"
              title="Cancel"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => setEditing(true)}
              className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground/50 hover:text-foreground hover:bg-accent/60 transition-colors opacity-0 group-hover:opacity-100"
              title={`Edit ${h.ticker} units and price`}
            >
              <Pencil className="h-3 w-3" />
            </button>
            {h.canRemove && (
              <button
                onClick={handleRemove}
                disabled={isPending}
                className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground/50 hover:text-danger hover:bg-danger/10 transition-colors disabled:opacity-50"
                title={`Remove erroneous ${h.ticker} position (zeroed and logged — not deleted)`}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
            {h.legacy ? (
              <div title={`${h.ticker} is a legacy holding awaiting sale. It stays in NAV and allocation until the sale settles; proceeds land in the cash bank before replacement buys (Art. VII).`}>
                <Minus className="h-4 w-4 text-muted-foreground/50 cursor-help" />
              </div>
            ) : (
              <div title={
                h.isHard
                  ? `Hard breach: ${h.ticker} is at ${h.actualPct.toFixed(1)}% vs ${h.targetPct.toFixed(1)}% target. Immediate rebalancing required.`
                  : h.isSoft
                  ? `Soft drift: ${h.ticker} is at ${h.actualPct.toFixed(1)}% vs ${h.targetPct.toFixed(1)}% target. Redirect contributions over the next 2–3 months.`
                  : `${h.ticker} is within its tolerance band at ${h.actualPct.toFixed(1)}% (target ${h.targetPct.toFixed(1)}%). No action needed.`
              }>
                <StatusIcon className={`h-4 w-4 ${statusIconCls} ${pulseCls} cursor-help`} />
              </div>
            )}
          </>
        )}
      </div>

      {/* Mobile row */}
      <div className="col-span-2 grid grid-cols-2 gap-2 md:hidden text-xs mt-2">
        <div><span className="block text-[10px] uppercase tracking-wider text-muted-foreground">Market value</span><strong>S${h.value.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
        <div><span className="block text-[10px] uppercase tracking-wider text-muted-foreground">Units · price</span><strong>{h.latestSnapshot?.units?.toLocaleString("en-SG") ?? "—"} · {(() => { const p = sgdUnitPrice(h.latestSnapshot?.units, h.value); return p !== null ? `S$${p.toFixed(2)}` : h.latestSnapshot?.price ? `${h.latestSnapshot.price.toFixed(2)} (fund ccy)` : "—" })()}</strong></div>
        <div><span className="block text-[10px] uppercase tracking-wider text-muted-foreground">Target</span><strong>{h.legacy ? "—" : `${h.targetPct.toFixed(1)}%`}</strong></div>
        <div className="flex items-center justify-between gap-2">
          <span className={`font-bold ${h.legacy ? "text-muted-foreground" : driftColor}`}>
            {h.actualPct.toFixed(1)}%{h.legacy ? " · awaiting sale" : ` · ${h.drift >= 0 ? "+" : ""}${h.drift.toFixed(1)}% drift`}
          </span>
          <button onClick={() => setEditing(!editing)} aria-label={`Edit ${h.ticker} units and price`} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
            <Pencil className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Mobile edit inputs */}
      {editing && (
        <div className="col-span-2 mt-2 md:hidden">
          <div className="flex gap-2 flex-wrap">
            <div className="flex flex-col gap-0.5">
              <label className="text-[9px] text-muted-foreground uppercase tracking-wider">Units</label>
              <input type="number" value={units} onChange={e => setUnits(e.target.value)}
                className="h-11 w-28 rounded border border-border bg-card px-2 text-base tabular-nums"
                step="0.01" min="0" />
            </div>
            <div className="flex flex-col gap-0.5">
              <label className="text-[9px] text-muted-foreground uppercase tracking-wider">Price (fund ccy)</label>
              <input type="number" value={price} onChange={e => setPrice(e.target.value)}
                className="h-11 w-32 rounded border border-border bg-card px-2 text-base tabular-nums"
                step="0.01" min="0" />
            </div>
            <div className="flex items-end gap-1">
              <button onClick={handleSave} disabled={isPending}
                className="flex h-11 items-center gap-1 rounded bg-success/15 px-3 text-xs font-semibold text-success hover:bg-success/25 disabled:opacity-50">
                <Check className="h-3.5 w-3.5" /> Save
              </button>
              <button onClick={handleCancel}
                className="flex h-11 items-center gap-1 rounded bg-muted px-3 text-xs font-semibold text-muted-foreground hover:bg-accent">
                <X className="h-3.5 w-3.5" /> Cancel
              </button>
            </div>
          </div>
          {liveValue > 0 && (
            <p className="text-[11px] text-primary mt-1.5">
              Preview value: {liveValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (fund currency)
            </p>
          )}
        </div>
      )}

      {/* Recommended action box — only for rows with a governed target. Target-drift
          advice is meaningless against a 0% placeholder target, so legacy/0-target
          rows never render a suggestion. Derived sleeve targets print at 1 dp. */}
      {!editing && !h.legacy && h.targetPct > 0 && (h.isHard || h.isSoft) && (
        <div className={`col-span-2 md:col-span-7 mt-1.5 rounded-lg px-3 py-2 text-xs leading-relaxed ${
          h.isHard
            ? "bg-danger/[0.08] text-danger border border-danger/20"
            : "bg-warning/[0.08] text-warning border border-warning/20"
        }`}>
          <span className="font-bold mr-1">{h.isHard ? "Action required:" : "Suggested:"}</span>
          {h.isHard
            ? h.drift > 0
              ? `Overweight at ${h.actualPct.toFixed(1)}% vs ${h.targetPct.toFixed(1)}% target. Stop buying this fund and consider selling a small amount to bring it back to ${h.targetPct.toFixed(1)}%.`
              : `Underweight at ${h.actualPct.toFixed(1)}% vs ${h.targetPct.toFixed(1)}% target. Redirect all contributions to ${h.ticker} until restored above ${Math.max(0, h.targetPct - 2).toFixed(1)}%.`
            : h.drift > 0
              ? `Overweight at ${h.actualPct.toFixed(1)}% vs ${h.targetPct.toFixed(1)}% target. Pause accumulation for 1–3 months and redirect freed capital to underweight positions.`
              : `Underweight at ${h.actualPct.toFixed(1)}% vs ${h.targetPct.toFixed(1)}% target. Redirect contributions for next 3 months until restored to within tolerance band.`
          }
        </div>
      )}

      {removeError && (
        <div className="col-span-2 md:col-span-7 mt-1 text-[11px] text-danger font-semibold">{removeError}</div>
      )}

      {saved && (
        <div className="col-span-2 md:col-span-7 mt-1 text-[11px] text-success font-semibold flex items-center gap-1">
          <Check className="h-3 w-3" /> Saved — page will refresh with updated values
        </div>
      )}
    </div>
  )
}
