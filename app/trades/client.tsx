"use client"

import { useState, useTransition } from "react"
import { Plus, Trash2, ArrowUpCircle, ArrowDownCircle, Loader2, Check, AlertCircle, X, Download } from "lucide-react"
import { addTradeAction, deleteTradeAction } from "./actions"
import { IBKRActivityImport } from "@/components/ibkr-activity-import"

type Trade = {
  id: string
  ticker: string
  type: string
  units: number
  price: number
  amount: number
  fxRate: number
  date: string
  note: string | null
}

interface TradesClientProps {
  trades: Trade[]
  holdings: { ticker: string }[]
}

export function TradesClient({ trades: initialTrades, holdings }: TradesClientProps) {
  const [trades, setTrades] = useState(initialTrades)
  const [showForm, setShowForm] = useState(false)
  const [showIBKRImport, setShowIBKRImport] = useState(false)
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setMsg(null)
    const formData = new FormData(e.currentTarget)
    const form = e.currentTarget
    startTransition(async () => {
      const result = await addTradeAction(formData)
      if (result.success) {
        setMsg({ type: "success", text: "Trade logged." })
        setShowForm(false)
        form.reset()
        setTimeout(() => setMsg(null), 3000)
        // Reload trades from server via full page refresh isn't needed; we optimistically add
        window.location.reload()
      } else {
        setMsg({ type: "error", text: result.error ?? "Failed to log trade." })
      }
    })
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deleteTradeAction(id)
      if (result.success) {
        setTrades(prev => prev.filter(t => t.id !== id))
      }
    })
  }

  const totalBought = trades.filter(t => t.type === "BUY").reduce((s, t) => s + t.amount, 0)
  const totalSold = trades.filter(t => t.type === "SELL").reduce((s, t) => s + t.amount, 0)

  return (
    <>
    {showIBKRImport && (
      <IBKRActivityImport
        onClose={() => setShowIBKRImport(false)}
        onImported={() => window.location.reload()}
      />
    )}
    <div className="space-y-5">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-border bg-card p-4 card-elevated">
          <p className="text-xs text-muted-foreground">Total Trades</p>
          <p className="text-2xl font-black mt-1">{trades.length}</p>
        </div>
        <div className="rounded-xl border border-green-500/20 bg-green-500/[0.04] p-4 card-elevated">
          <p className="text-xs text-muted-foreground">Total Bought</p>
          <p className="text-2xl font-black mt-1 text-green-500">S${totalBought.toLocaleString("en-SG", { maximumFractionDigits: 0 })}</p>
        </div>
        <div className="rounded-xl border border-red-500/20 bg-red-500/[0.04] p-4 card-elevated">
          <p className="text-xs text-muted-foreground">Total Sold</p>
          <p className="text-2xl font-black mt-1 text-red-500">S${totalSold.toLocaleString("en-SG", { maximumFractionDigits: 0 })}</p>
        </div>
      </div>

      {/* Add trade button */}
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Trade Log</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowIBKRImport(true)}
            className="flex items-center gap-1.5 rounded-lg border border-indigo-500/30 bg-indigo-500/[0.06] hover:bg-indigo-500/10 text-indigo-500 text-xs font-semibold px-3 py-1.5 transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            Import IBKR
          </button>
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-3 py-1.5 transition-colors"
          >
            {showForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            {showForm ? "Cancel" : "Log Trade"}
          </button>
        </div>
      </div>

      {/* Status message */}
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

      {/* Add trade form */}
      {showForm && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-5 py-4 border-b border-border">
            <h3 className="text-sm font-semibold">Log a Trade</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Record a buy or sell transaction</p>
          </div>
          <form onSubmit={handleAdd} className="p-5 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Ticker</label>
                <input
                  name="ticker"
                  required
                  list="ticker-list"
                  placeholder="VT"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all uppercase"
                />
                <datalist id="ticker-list">
                  {holdings.map(h => <option key={h.ticker} value={h.ticker} />)}
                </datalist>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Type</label>
                <select name="type" required className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all">
                  <option value="BUY">BUY</option>
                  <option value="SELL">SELL</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Units</label>
                <input name="units" type="number" step="0.001" min="0.001" required placeholder="10" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all" />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Price (USD)</label>
                <input name="price" type="number" step="0.01" min="0.01" required placeholder="155.52" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all" />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Date</label>
                <input name="date" type="date" required defaultValue={new Date().toISOString().split("T")[0]} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Note (optional)</label>
              <input name="note" placeholder="Monthly contribution…" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all" />
            </div>
            <button
              type="submit"
              disabled={isPending}
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-xs font-semibold px-4 py-2 transition-colors"
            >
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Log Trade
            </button>
          </form>
        </div>
      )}

      {/* Trades table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {trades.length === 0 ? (
          <div className="p-8 text-center">
            <ArrowUpCircle className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm font-medium">No trades logged yet</p>
            <p className="text-xs text-muted-foreground mt-1">Log your first buy or sell transaction above.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-5 py-2.5 text-left font-semibold text-muted-foreground">Date</th>
                  <th className="px-5 py-2.5 text-left font-semibold text-muted-foreground">Type</th>
                  <th className="px-5 py-2.5 text-left font-semibold text-muted-foreground">Ticker</th>
                  <th className="px-5 py-2.5 text-right font-semibold text-muted-foreground">Units</th>
                  <th className="px-5 py-2.5 text-right font-semibold text-muted-foreground">Price (USD)</th>
                  <th className="px-5 py-2.5 text-right font-semibold text-muted-foreground">Amount (SGD)</th>
                  <th className="px-5 py-2.5 text-left font-semibold text-muted-foreground">Note</th>
                  <th className="px-5 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {trades.map(t => (
                  <tr key={t.id} className="hover:bg-accent/30 transition-colors">
                    <td className="px-5 py-3">{new Date(t.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" })}</td>
                    <td className="px-5 py-3">
                      <span className={`flex items-center gap-1 font-bold ${t.type === "BUY" ? "text-green-500" : "text-red-500"}`}>
                        {t.type === "BUY" ? <ArrowUpCircle className="h-3.5 w-3.5" /> : <ArrowDownCircle className="h-3.5 w-3.5" />}
                        {t.type}
                      </span>
                    </td>
                    <td className="px-5 py-3 font-bold">{t.ticker}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{t.units.toLocaleString()}</td>
                    <td className="px-5 py-3 text-right tabular-nums">${t.price.toFixed(2)}</td>
                    <td className="px-5 py-3 text-right tabular-nums font-semibold">S${t.amount.toLocaleString("en-SG", { maximumFractionDigits: 2 })}</td>
                    <td className="px-5 py-3 text-muted-foreground">{t.note || "—"}</td>
                    <td className="px-5 py-3">
                      <button
                        onClick={() => handleDelete(t.id)}
                        className="text-muted-foreground hover:text-red-500 transition-colors"
                        title="Delete trade"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
    </>
  )
}
