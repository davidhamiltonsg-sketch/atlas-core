"use client"

import { useState, useTransition } from "react"
import { TrendingUp, TrendingDown, Minus, AlertTriangle, XCircle, CheckCircle2, Pencil, Check, X } from "lucide-react"
import { updateHoldingsManually } from "@/app/portfolio/actions"
import { Sparkline } from "@/components/charts/sparkline"

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
  }
}

export function HoldingRow({ holding: h }: HoldingRowProps) {
  const [editing, setEditing] = useState(false)
  const [units, setUnits] = useState(String(h.latestSnapshot?.units ?? 0))
  const [price, setPrice] = useState(String(h.latestSnapshot?.price ?? 0))
  const [saved, setSaved] = useState(false)
  const [isPending, startTransition] = useTransition()

  const DriftIcon = h.drift > 0.05 ? TrendingUp : h.drift < -0.05 ? TrendingDown : Minus
  // Color system: hard breach = red (severity), soft = direction-aware (yellow/orange), healthy = green
  const under = h.drift < 0
  const driftColor = h.isHard
    ? "text-red-500"
    : h.isSoft
    ? (under ? "text-yellow-400" : "text-orange-500")
    : "text-green-500"
  const StatusIcon = h.isHard ? XCircle : h.isSoft ? AlertTriangle : CheckCircle2
  const statusIconCls = driftColor
  const pulseCls = h.isHard ? "pulse-red" : ""
  const rowAccent = h.isHard
    ? "border-l-4 border-red-500 bg-red-500/[0.02]"
    : h.isSoft
    ? under
      ? "border-l-[3px] border-yellow-400 bg-yellow-400/[0.02]"
      : "border-l-[3px] border-orange-500 bg-orange-500/[0.02]"
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
      className={`group grid grid-cols-[44px_1fr] md:grid-cols-[44px_1fr_80px_110px_90px_90px_90px_44px] items-center gap-x-3 gap-y-0.5 px-5 py-3.5 hover:bg-accent/30 transition-colors scroll-mt-4 ${rowAccent} ${saved ? "bg-green-500/[0.04]" : ""}`}
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
          <label className="text-[9px] text-muted-foreground uppercase tracking-wider">USD preview</label>
          <span className="text-xs font-semibold tabular-nums text-primary">
            ${liveValue > 0 ? liveValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
          </span>
        </div>
      ) : (
        <span className="text-xs font-semibold text-right hidden md:block">
          S${h.value.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      )}

      {/* Actual % */}
      <div className="hidden md:flex flex-col items-end gap-1">
        <span className="text-xs font-semibold tabular-nums">{h.actualPct.toFixed(1)}%</span>
        <div className="w-full h-1 rounded-full bg-muted overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, h.actualPct / 0.7)}%`, backgroundColor: h.color }} />
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
              <label className="text-[9px] text-muted-foreground uppercase tracking-wider">Price $</label>
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
            <span className="text-xs text-muted-foreground tabular-nums">
              {h.targetPct}%
              {h.hardCapPct && <span className="text-[10px] ml-1 opacity-50">/{h.hardCapPct}%</span>}
            </span>
            <div className="w-full h-1 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full opacity-40" style={{ width: `${Math.min(100, h.targetPct / 0.7)}%`, backgroundColor: h.color }} />
            </div>
          </div>

          {/* Drift */}
          <div className={`hidden md:flex items-center gap-1 justify-end text-xs font-bold tabular-nums ${driftColor}`}>
            <DriftIcon className="h-3 w-3 shrink-0" />
            {h.drift >= 0 ? "+" : ""}{h.drift.toFixed(1)}%
            {h.overCap && <span className="ml-1 rounded bg-red-500/15 px-1 text-[9px] font-bold text-red-500">CAP</span>}
          </div>
        </>
      )}

      {/* Action column — edit/save/cancel or status icon */}
      <div className="hidden md:flex items-center justify-end gap-1">
        {editing ? (
          <>
            <button
              onClick={handleSave}
              disabled={isPending}
              className="flex h-6 w-6 items-center justify-center rounded bg-green-500/15 text-green-600 hover:bg-green-500/25 transition-colors disabled:opacity-50"
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
            <div title={
              h.isHard
                ? `Hard breach: ${h.ticker} is at ${h.actualPct.toFixed(1)}% vs ${h.targetPct}% target. Immediate rebalancing required.`
                : h.isSoft
                ? `Soft drift: ${h.ticker} is at ${h.actualPct.toFixed(1)}% vs ${h.targetPct}% target. Redirect contributions over the next 2–3 months.`
                : `${h.ticker} is within its tolerance band at ${h.actualPct.toFixed(1)}% (target ${h.targetPct}%). No action needed.`
            }>
              <StatusIcon className={`h-4 w-4 ${statusIconCls} ${pulseCls} cursor-help`} />
            </div>
          </>
        )}
      </div>

      {/* Mobile row */}
      <div className="col-span-2 flex items-center justify-between md:hidden text-xs mt-1">
        <span className="font-semibold">S${h.value.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        <div className="flex items-center gap-2">
          <span className={`font-bold ${driftColor}`}>
            {h.actualPct.toFixed(1)}% · {h.drift >= 0 ? "+" : ""}{h.drift.toFixed(1)}% drift
          </span>
          <button onClick={() => setEditing(!editing)} className="text-muted-foreground/60 hover:text-foreground transition-colors">
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
                className="w-24 rounded border border-border bg-card px-2 py-1 text-xs tabular-nums"
                step="0.01" min="0" />
            </div>
            <div className="flex flex-col gap-0.5">
              <label className="text-[9px] text-muted-foreground uppercase tracking-wider">Price $</label>
              <input type="number" value={price} onChange={e => setPrice(e.target.value)}
                className="w-28 rounded border border-border bg-card px-2 py-1 text-xs tabular-nums"
                step="0.01" min="0" />
            </div>
            <div className="flex items-end gap-1">
              <button onClick={handleSave} disabled={isPending}
                className="flex items-center gap-1 rounded bg-green-500/15 px-2.5 py-1 text-xs font-semibold text-green-600 hover:bg-green-500/25 disabled:opacity-50">
                <Check className="h-3.5 w-3.5" /> Save
              </button>
              <button onClick={handleCancel}
                className="flex items-center gap-1 rounded bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground hover:bg-accent">
                <X className="h-3.5 w-3.5" /> Cancel
              </button>
            </div>
          </div>
          {liveValue > 0 && (
            <p className="text-[11px] text-primary mt-1.5">
              Preview value: ${liveValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          )}
        </div>
      )}

      {/* Recommended action box */}
      {!editing && (h.isHard || h.isSoft) && (
        <div className={`col-span-2 md:col-span-7 mt-1.5 rounded-lg px-3 py-2 text-xs leading-relaxed ${
          h.isHard
            ? "bg-red-500/[0.08] text-red-700 dark:text-red-300 border border-red-500/20"
            : under
              ? "bg-yellow-400/[0.08] text-yellow-700 dark:text-yellow-300 border border-yellow-400/20"
              : "bg-orange-500/[0.08] text-orange-700 dark:text-orange-300 border border-orange-500/20"
        }`}>
          <span className="font-bold mr-1">{h.isHard ? "Action required:" : "Suggested:"}</span>
          {h.isHard
            ? h.drift > 0
              ? `Overweight at ${h.actualPct.toFixed(1)}% vs ${h.targetPct}% target. Halt accumulation immediately. Assess selective trim at next dealing window.`
              : `Underweight at ${h.actualPct.toFixed(1)}% vs ${h.targetPct}% target. Redirect all contributions to ${h.ticker} until restored above ${h.targetPct - 2}%.`
            : h.drift > 0
              ? `Overweight at ${h.actualPct.toFixed(1)}% vs ${h.targetPct}% target. Pause accumulation for 1–3 months and redirect freed capital to underweight positions.`
              : `Underweight at ${h.actualPct.toFixed(1)}% vs ${h.targetPct}% target. Redirect contributions for next 3 months until restored to within tolerance band.`
          }
        </div>
      )}

      {saved && (
        <div className="col-span-2 md:col-span-7 mt-1 text-[11px] text-green-600 dark:text-green-400 font-semibold flex items-center gap-1">
          <Check className="h-3 w-3" /> Saved — page will refresh with updated values
        </div>
      )}
    </div>
  )
}
