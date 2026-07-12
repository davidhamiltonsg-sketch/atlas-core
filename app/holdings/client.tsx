"use client"

import { useState, useTransition } from "react"
import { Plus, Trash2, Pencil, Loader2, Check, AlertCircle, X, PieChart } from "lucide-react"
import { addHoldingAction, deleteHoldingAction, updateHoldingAction } from "./actions"

type Holding = {
  id: string
  ticker: string
  name: string
  targetPct: number
  hardCapPct: number | null
  toleranceBand: number
  color: string
  snapshotCount: number
  latestValue: number | null
}

interface HoldingsClientProps {
  holdings: Holding[]
  totalTargetPct: number
  /** @deprecated use constitutionId */
  isSbr?: boolean
  constitutionId?: string
}

const PRESET_COLORS = [
  "#6366f1", "#8b5cf6", "#3b82f6", "#06b6d4", "#10b981",
  "#f59e0b", "#ef4444", "#f97316", "#ec4899", "#84cc16",
]

export function HoldingsClient({ holdings: initial, totalTargetPct: initialTotal, isSbr: isSbrLegacy = false, constitutionId = "atlas-core" }: HoldingsClientProps) {
  const isSbr = isSbrLegacy || constitutionId === "silicon-brick-road"
  // Brand the shared page to the active portfolio: teal for Silicon Brick Road, indigo for
  // Atlas Core. Full class-name literals so Tailwind compiles them (no dynamic string building).
  const accentBtn   = isSbr ? "bg-sky-600 hover:bg-sky-700" : "bg-violet-600 hover:bg-violet-700"
  const accentRing  = isSbr ? "focus:ring-sky-500/30 focus:border-sky-500" : "focus:ring-violet-500/30 focus:border-violet-500"
  const accentHover = isSbr ? "hover:text-sky-500" : "hover:text-violet-500"
  const accentBadge = isSbr ? "bg-sky-500/10 text-sky-600 dark:text-sky-400" : "bg-violet-500/10 text-violet-500 dark:text-violet-400"
  const [holdings, setHoldings] = useState(initial)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null)
  const [isPending, startTransition] = useTransition()
  const [selectedColor, setSelectedColor] = useState(PRESET_COLORS[0])

  const totalTarget = holdings.reduce((s, h) => s + h.targetPct, 0)
  const remaining = 100 - totalTarget

  function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setMsg(null)
    const fd = new FormData(e.currentTarget)
    fd.set("color", selectedColor)
    const form = e.currentTarget
    startTransition(async () => {
      const result = await addHoldingAction(fd)
      if (result.success) {
        setMsg({ type: "success", text: "Holding added." })
        setShowForm(false)
        form.reset()
        setSelectedColor(PRESET_COLORS[0])
        window.location.reload()
      } else {
        setMsg({ type: "error", text: result.error ?? "Failed." })
      }
    })
  }

  function handleEdit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setMsg(null)
    const fd = new FormData(e.currentTarget)
    fd.set("color", selectedColor)
    startTransition(async () => {
      const result = await updateHoldingAction(fd)
      if (result.success) {
        setMsg({ type: "success", text: "Holding updated." })
        setEditId(null)
        window.location.reload()
      } else {
        setMsg({ type: "error", text: result.error ?? "Failed." })
      }
    })
  }

  function handleDelete(id: string) {
    if (!confirm(isSbr ? "Remove this fund and all its recorded values? This cannot be undone." : "Delete this holding and all its snapshots? This cannot be undone.")) return
    startTransition(async () => {
      const result = await deleteHoldingAction(id)
      if (result.success) {
        setHoldings(prev => prev.filter(h => h.id !== id))
        setMsg({ type: "success", text: "Holding deleted." })
      } else {
        setMsg({ type: "error", text: result.error ?? "Failed." })
      }
    })
  }

  function startEdit(h: Holding) {
    setEditId(h.id)
    setSelectedColor(h.color)
    setShowForm(false)
  }

  return (
    <div className="space-y-5">

      {/* Allocation overview */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-muted-foreground">Total Target Allocation</p>
          <p className={`text-sm font-black tabular-nums ${Math.abs(totalTarget - 100) < 0.1 ? "text-green-500" : totalTarget > 100 ? "text-red-500" : "text-yellow-400"}`}>
            {totalTarget.toFixed(1)}% / 100%
          </p>
        </div>
        <div className="h-2.5 rounded-full bg-muted overflow-hidden flex">
          {holdings.map(h => (
            <div
              key={h.id}
              className="h-full transition-all"
              style={{ width: `${Math.min(h.targetPct, 100)}%`, background: h.color }}
              title={`${h.ticker}: ${h.targetPct}%`}
            />
          ))}
          {remaining > 0 && (
            <div className="h-full bg-muted-foreground/20" style={{ width: `${remaining}%` }} />
          )}
        </div>
        <p className="text-[11px] text-muted-foreground mt-1.5">
          {Math.abs(remaining) < 0.1 ? "Fully allocated." : remaining > 0 ? `${remaining.toFixed(1)}% unallocated.` : `${Math.abs(remaining).toFixed(1)}% over 100% — reduce targets.`}
        </p>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{isSbr ? "Your Funds" : "Holdings"} ({holdings.length})</h2>
        <button
          onClick={() => { setShowForm(!showForm); setEditId(null); setMsg(null) }}
          className={`flex items-center gap-1.5 rounded-lg ${accentBtn} text-white text-xs font-semibold px-3 py-1.5 transition-colors`}
        >
          {showForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          {showForm ? "Cancel" : (isSbr ? "Add a fund" : "Add Holding")}
        </button>
      </div>

      {msg && (
        <div className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-xs ${
          msg.type === "success"
            ? "bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20 text-green-700 dark:text-green-400"
            : "bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400"
        }`}>
          {msg.type === "success" ? <Check className="h-3.5 w-3.5 shrink-0" /> : <AlertCircle className="h-3.5 w-3.5 shrink-0" />}
          {msg.text}
        </div>
      )}

      {/* Add form */}
      {showForm && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-5 py-4 border-b border-border">
            <h3 className="text-sm font-semibold">{isSbr ? "Add a fund" : "Add New Holding"}</h3>
          </div>
          <form onSubmit={handleAdd} className="p-5 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Ticker</label>
                <input name="ticker" required placeholder={isSbr ? "e.g. IMID" : "e.g. IMID"} className={`w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 ${accentRing} transition-all uppercase`} />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Name</label>
                <input name="name" required placeholder={isSbr ? "SPDR MSCI ACWI IMI (IMID)" : "SPDR MSCI ACWI IMI UCITS ETF"} className={`w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 ${accentRing} transition-all`} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Target % <span className={isSbr ? "text-sky-400" : "text-violet-400"}>({remaining.toFixed(1)}% remaining)</span></label>
                <input name="targetPct" type="number" required step="0.5" min="0" max="100" placeholder="52" className={`w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 ${accentRing} transition-all`} />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">{isSbr ? "Max % (optional)" : "Hard Cap % (optional)"}</label>
                <input name="hardCapPct" type="number" step="0.5" min="0" max="100" placeholder="62" className={`w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 ${accentRing} transition-all`} />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">{isSbr ? "Drift allowance %" : "Tolerance Band %"}</label>
                <input name="toleranceBand" type="number" step="0.5" min="0" max="20" placeholder="2.5" defaultValue="2.5" className={`w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 ${accentRing} transition-all`} />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Color</label>
              <div className="flex gap-2 flex-wrap">
                {PRESET_COLORS.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setSelectedColor(c)}
                    className={`h-7 w-7 rounded-full transition-all ${selectedColor === c ? "ring-2 ring-offset-2 ring-offset-background ring-white scale-110" : "opacity-70 hover:opacity-100"}`}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </div>
            <button type="submit" disabled={isPending} className={`flex items-center gap-1.5 rounded-lg ${accentBtn} disabled:opacity-60 text-white text-xs font-semibold px-4 py-2 transition-colors`}>
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              {isSbr ? "Add fund" : "Add Holding"}
            </button>
          </form>
        </div>
      )}

      {/* Holdings list */}
      {holdings.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <PieChart className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm font-medium">No holdings yet</p>
          <p className="text-xs text-muted-foreground mt-1">Add your ETFs and assets to start tracking your portfolio.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="divide-y divide-border">
            {holdings.map(h => (
              <div key={h.id}>
                <div className="flex items-center justify-between px-5 py-4 hover:bg-accent/30 transition-colors">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="h-3 w-3 rounded-full shrink-0" style={{ background: h.color }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-black">{h.ticker}</span>
                        <span className="text-xs text-muted-foreground truncate">{h.name}</span>
                        <span className={`text-[10px] font-semibold ${accentBadge} px-2 py-0.5 rounded-full`}>
                          {h.targetPct}% target
                        </span>
                        {h.hardCapPct && (
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${isSbr ? "bg-muted text-muted-foreground" : "bg-red-500/10 text-red-500"}`}>
                            {isSbr ? `max ${h.hardCapPct}%` : `${h.hardCapPct}% cap`}
                          </span>
                        )}
                        <span className="text-[10px] text-muted-foreground">{isSbr ? `ok within ±${h.toleranceBand}%` : `±${h.toleranceBand}% band`}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {h.latestValue
                          ? `Now worth S$${h.latestValue.toLocaleString("en-SG", { maximumFractionDigits: 2 })}`
                          : (isSbr ? "No value yet — add what you hold on Portfolio" : `${h.snapshotCount} snapshot${h.snapshotCount !== 1 ? "s" : ""} · no value yet`)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-4">
                    <button
                      onClick={() => startEdit(editId === h.id ? null as unknown as Holding : h)}
                      className={`text-muted-foreground ${accentHover} transition-colors`}
                      title="Edit" aria-label={`Edit ${h.ticker}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(h.id)}
                      disabled={isPending}
                      className="text-muted-foreground hover:text-red-500 transition-colors"
                      title="Delete" aria-label={`Delete ${h.ticker}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Inline edit form */}
                {editId === h.id && (
                  <div className="border-t border-border bg-muted/20 px-5 py-4">
                    <form onSubmit={handleEdit} className="space-y-3">
                      <input type="hidden" name="id" value={h.id} />
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-muted-foreground mb-1">Name</label>
                          <input name="name" required defaultValue={h.name} className={`w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 ${accentRing} transition-all`} />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-muted-foreground mb-1">Target %</label>
                          <input name="targetPct" type="number" required step="0.5" min="0" max="100" defaultValue={h.targetPct} className={`w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 ${accentRing} transition-all`} />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-muted-foreground mb-1">{isSbr ? "Max %" : "Hard Cap %"}</label>
                          <input name="hardCapPct" type="number" step="0.5" min="0" max="100" defaultValue={h.hardCapPct ?? ""} className={`w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 ${accentRing} transition-all`} />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-muted-foreground mb-1">{isSbr ? "Drift allowance %" : "Tolerance Band %"}</label>
                          <input name="toleranceBand" type="number" step="0.5" min="0" max="20" defaultValue={h.toleranceBand} className={`w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 ${accentRing} transition-all`} />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1">Color</label>
                        <div className="flex gap-2 flex-wrap">
                          {PRESET_COLORS.map(c => (
                            <button
                              key={c}
                              type="button"
                              onClick={() => setSelectedColor(c)}
                              className={`h-6 w-6 rounded-full transition-all ${selectedColor === c ? "ring-2 ring-offset-2 ring-offset-background ring-white scale-110" : "opacity-70 hover:opacity-100"}`}
                              style={{ background: c }}
                            />
                          ))}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button type="submit" disabled={isPending} className={`flex items-center gap-1.5 rounded-lg ${accentBtn} disabled:opacity-60 text-white text-xs font-semibold px-3 py-1.5 transition-colors`}>
                          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                          Save
                        </button>
                        <button type="button" onClick={() => setEditId(null)} className="flex items-center gap-1.5 rounded-lg border border-border text-xs font-semibold px-3 py-1.5 transition-colors hover:bg-accent">
                          <X className="h-3.5 w-3.5" />
                          Cancel
                        </button>
                      </div>
                    </form>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Warning */}
      {holdings.some(h => h.snapshotCount === 0) && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <p className="text-xs font-semibold text-amber-500 mb-0.5">{isSbr ? "Some funds have no value yet" : "Holdings without snapshots"}</p>
          <p className="text-xs text-muted-foreground">
            {isSbr
              ? <>Go to <a href="/portfolio" className="underline hover:text-foreground">Portfolio</a> and use &quot;Update Values&quot; to enter how much you currently hold.</>
              : <>Some holdings have no price data. Go to <a href="/portfolio" className="underline hover:text-foreground">Portfolio</a> and use &quot;Update Values&quot; to enter the first snapshot.</>}
          </p>
        </div>
      )}

    </div>
  )
}
