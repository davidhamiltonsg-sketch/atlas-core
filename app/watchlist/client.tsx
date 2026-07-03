"use client"

import { useState, useTransition } from "react"
import { Plus, Trash2, Star, Loader2, Check, AlertCircle, X } from "lucide-react"
import { addWatchlistItemAction, deleteWatchlistItemAction } from "./actions"

type WatchlistItem = {
  id: string
  ticker: string
  name: string
  note: string | null
  targetPct: number | null
  addedAt: string
}

interface WatchlistClientProps {
  items: WatchlistItem[]
}

export function WatchlistClient({ items: initialItems }: WatchlistClientProps) {
  const [items, setItems] = useState(initialItems)
  const [showForm, setShowForm] = useState(false)
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setMsg(null)
    const formData = new FormData(e.currentTarget)
    const form = e.currentTarget
    startTransition(async () => {
      const result = await addWatchlistItemAction(formData)
      if (result.success) {
        setMsg({ type: "success", text: "Added to watchlist." })
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
      const result = await deleteWatchlistItemAction(id)
      if (result.success) setItems(prev => prev.filter(i => i.id !== id))
    })
  }

  return (
    <div className="space-y-5">
      {/* Info */}
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="text-xs text-muted-foreground leading-relaxed">
          <span className="font-bold text-foreground">Watchlist tracks potential future positions.</span>{" "}
          Per governance rules, no new positions should be added without a thorough overlap and concentration review.
          Use this to shortlist candidates for the next quarterly strategic review — not for impulse decisions.
        </p>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Watchlist ({items.length})</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold px-3 py-1.5 transition-colors"
        >
          {showForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          {showForm ? "Cancel" : "Add to Watchlist"}
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
            <h3 className="text-sm font-semibold">Add to Watchlist</h3>
          </div>
          <form onSubmit={handleAdd} className="p-5 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Ticker</label>
                <input name="ticker" required placeholder="e.g. AVUV" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all uppercase" />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Name</label>
                <input name="name" required placeholder="Avantis U.S. Small Cap Value" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Hypothetical Target % (optional)</label>
                <input name="targetPct" type="number" step="0.5" min="0" max="100" placeholder="5" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all" />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Research Note</label>
                <input name="note" placeholder="Why you're watching this…" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all" />
              </div>
            </div>
            <button type="submit" disabled={isPending} className="flex items-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-xs font-semibold px-4 py-2 transition-colors">
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Add
            </button>
          </form>
        </div>
      )}

      {items.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <Star className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm font-medium">Watchlist is empty</p>
          <p className="text-xs text-muted-foreground mt-1">Add potential positions for consideration at your next quarterly review.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="divide-y divide-border">
            {items.map(item => (
              <div key={item.id} className="flex items-start justify-between px-5 py-4 hover:bg-accent/30 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-black">{item.ticker}</span>
                    <span className="text-xs text-muted-foreground">{item.name}</span>
                    {item.targetPct !== null && (
                      <span className="text-[10px] font-semibold bg-violet-500/10 text-violet-600 dark:text-violet-400 px-2 py-0.5 rounded-full">
                        {item.targetPct}% hypothetical
                      </span>
                    )}
                  </div>
                  {item.note && <p className="text-xs text-muted-foreground">{item.note}</p>}
                  <p className="text-[11px] text-muted-foreground mt-1">Added {new Date(item.addedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</p>
                </div>
                <button onClick={() => handleDelete(item.id)} className="text-muted-foreground hover:text-red-500 transition-colors ml-4 shrink-0 mt-0.5">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
