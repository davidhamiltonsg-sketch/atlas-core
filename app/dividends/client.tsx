"use client"

import { useState, useTransition } from "react"
import { Plus, Trash2, Coins, Loader2, Check, AlertCircle, X } from "lucide-react"
import { addDividendAction, deleteDividendAction } from "./actions"

type Dividend = {
  id: string
  ticker: string
  amount: number
  units: number
  paymentDate: string
  note: string | null
}

interface DividendsClientProps {
  dividends: Dividend[]
  holdings: { ticker: string }[]
}

export function DividendsClient({ dividends: initialDividends, holdings }: DividendsClientProps) {
  const [dividends, setDividends] = useState(initialDividends)
  const [showForm, setShowForm] = useState(false)
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setMsg(null)
    const formData = new FormData(e.currentTarget)
    const form = e.currentTarget
    startTransition(async () => {
      const result = await addDividendAction(formData)
      if (result.success) {
        setMsg({ type: "success", text: "Dividend recorded." })
        setShowForm(false)
        form.reset()
        window.location.reload()
      } else {
        setMsg({ type: "error", text: result.error ?? "Failed." })
      }
    })
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deleteDividendAction(id)
      if (result.success) setDividends(prev => prev.filter(d => d.id !== id))
    })
  }

  const total = dividends.reduce((s, d) => s + d.amount, 0)
  const thisYear = dividends.filter(d => new Date(d.paymentDate).getFullYear() === new Date().getFullYear())
  const thisYearTotal = thisYear.reduce((s, d) => s + d.amount, 0)

  // Group by ticker
  const byTicker = dividends.reduce((acc, d) => {
    if (!acc[d.ticker]) acc[d.ticker] = 0
    acc[d.ticker] += d.amount
    return acc
  }, {} as Record<string, number>)

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-border bg-card p-4 card-elevated">
          <p className="text-xs text-muted-foreground">Total Dividends</p>
          <p className="text-2xl font-black tabular-nums mt-1">S${total.toLocaleString("en-SG", { maximumFractionDigits: 2 })}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{dividends.length} payments recorded</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 card-elevated">
          <p className="text-xs text-muted-foreground">This Year</p>
          <p className="text-2xl font-black tabular-nums mt-1 text-green-500">S${thisYearTotal.toLocaleString("en-SG", { maximumFractionDigits: 2 })}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{thisYear.length} payments in {new Date().getFullYear()}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 card-elevated">
          <p className="text-xs text-muted-foreground">Largest Payer</p>
          <p className="text-2xl font-black tabular-nums mt-1">
            {Object.keys(byTicker).length > 0 ? Object.entries(byTicker).sort((a, b) => b[1] - a[1])[0][0] : "—"}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">by total dividend received</p>
        </div>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Dividend Log</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-3 py-1.5 transition-colors"
        >
          {showForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          {showForm ? "Cancel" : "Record Dividend"}
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

      {showForm && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-5 py-4 border-b border-border">
            <h3 className="text-sm font-semibold">Record a Dividend</h3>
          </div>
          <form onSubmit={handleAdd} className="p-5 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Ticker</label>
                <input name="ticker" required list="div-ticker-list" placeholder="VT" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all uppercase" />
                <datalist id="div-ticker-list">
                  {holdings.map(h => <option key={h.ticker} value={h.ticker} />)}
                </datalist>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Payment Date</label>
                <input name="paymentDate" type="date" required defaultValue={new Date().toISOString().split("T")[0]} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Amount Received (SGD)</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">S$</span>
                  <input name="amount" type="number" step="0.01" min="0.01" required placeholder="150.00" className="w-full rounded-lg border border-border bg-background pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Units Held at Payment</label>
                <input name="units" type="number" step="0.001" min="0.001" required placeholder="428" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Note (optional)</label>
              <input name="note" placeholder="Q1 2025 distribution…" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all" />
            </div>
            <button type="submit" disabled={isPending} className="flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-xs font-semibold px-4 py-2 transition-colors">
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Record
            </button>
          </form>
        </div>
      )}

      {dividends.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <Coins className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm font-medium">No dividends recorded yet</p>
          <p className="text-xs text-muted-foreground mt-1">VT and VWO pay regular distributions. Log them here to track your passive income.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-5 py-2.5 text-left font-semibold text-muted-foreground">Date</th>
                  <th className="px-5 py-2.5 text-left font-semibold text-muted-foreground">Ticker</th>
                  <th className="px-5 py-2.5 text-right font-semibold text-muted-foreground">Units</th>
                  <th className="px-5 py-2.5 text-right font-semibold text-muted-foreground">Amount (SGD)</th>
                  <th className="px-5 py-2.5 text-right font-semibold text-muted-foreground">Per Unit</th>
                  <th className="px-5 py-2.5 text-left font-semibold text-muted-foreground">Note</th>
                  <th className="px-5 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {dividends.map(d => (
                  <tr key={d.id} className="hover:bg-accent/30 transition-colors">
                    <td className="px-5 py-3">{new Date(d.paymentDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" })}</td>
                    <td className="px-5 py-3 font-bold">{d.ticker}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{d.units.toLocaleString()}</td>
                    <td className="px-5 py-3 text-right tabular-nums font-semibold text-green-500">S${d.amount.toLocaleString("en-SG", { maximumFractionDigits: 2 })}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">S${(d.amount / d.units).toFixed(4)}</td>
                    <td className="px-5 py-3 text-muted-foreground">{d.note || "—"}</td>
                    <td className="px-5 py-3">
                      <button onClick={() => handleDelete(d.id)} className="text-muted-foreground hover:text-red-500 transition-colors">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border bg-muted/20">
                  <td colSpan={3} className="px-5 py-3 text-xs font-semibold text-muted-foreground">Total</td>
                  <td className="px-5 py-3 text-right text-xs font-black text-green-500 tabular-nums">S${total.toLocaleString("en-SG", { maximumFractionDigits: 2 })}</td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
