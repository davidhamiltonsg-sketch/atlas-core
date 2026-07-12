"use client"

import { useState, useTransition } from "react"
import { createCommitteeMinute } from "@/app/actions/sbr-committee"

const SBR_ARTICLES = [
  "Hard-cap review",
  "DBMFE floor review",
  "EQAC plus SMH ceiling",
  "Look-through concentration review",
  "Future SGD use documented",
  "Rule change (30-day cooling-off)",
  "Other (describe in decision)",
]

interface Props {
  /** Pre-select the article when opened from an EME banner */
  defaultArticle?: string
}

export function CommitteeMinuteForm({ defaultArticle }: Props) {
  const [open, setOpen] = useState(false)
  const [decision, setDecision] = useState("")
  const [article, setArticle] = useState(defaultArticle ?? SBR_ARTICLES[0])
  const [confirmed, setConfirmed] = useState(false)
  const [pending, startTransition] = useTransition()
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!confirmed) { setError("Both parties must tick the confirmation box."); return }
    if (!decision.trim()) { setError("Write a brief summary of the decision."); return }
    startTransition(async () => {
      try {
        await createCommitteeMinute({ decision, articleTriggered: article, bothConfirmed: confirmed })
        setDone(true)
        setOpen(false)
        setDecision("")
        setConfirmed(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save — try again.")
      }
    })
  }

  if (!open) {
    return (
      <button
        onClick={() => { setOpen(true); setDone(false) }}
        className={`w-full rounded-lg border px-4 py-2.5 text-sm font-semibold transition-colors text-left ${
          done
            ? "border-green-500/30 bg-green-500/10 text-green-500"
            : "border-sky-500/30 bg-sky-500/[0.06] text-sky-400 hover:bg-sky-500/[0.10]"
        }`}
      >
        {done ? "✓ Minute filed — circuit breaker satisfied" : "File committee minute"}
      </button>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-sky-500/30 bg-sky-500/[0.06] p-4 space-y-3">
      <p className="text-xs font-bold text-sky-400 uppercase tracking-widest">Committee Minute</p>
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        Both David and Dami must agree before any discretionary sell during an Exceptional Market Event.
        Record the decision here. This becomes the audit trail.
      </p>

      <div>
        <label className="text-[11px] font-semibold text-muted-foreground block mb-1">Article / rule triggered</label>
        <select
          value={article}
          onChange={(e) => setArticle(e.target.value)}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-sky-500"
        >
          {SBR_ARTICLES.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      <div>
        <label className="text-[11px] font-semibold text-muted-foreground block mb-1">Decision (what was agreed)</label>
        <textarea
          value={decision}
          onChange={(e) => setDecision(e.target.value)}
          rows={3}
          placeholder="e.g. Agreed to hold all positions — drawdown is within normal volatility for the plan. No sells this month."
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-sky-500 resize-none"
        />
      </div>

      <label className="flex items-start gap-2.5 cursor-pointer">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-0.5 h-3.5 w-3.5 rounded accent-sky-500"
        />
        <span className="text-[11px] text-muted-foreground leading-relaxed">
          Both David and Dami have discussed and agreed to the above. This minute is filed under the Silicon Brick Road constitution.
        </span>
      </label>

      {error && <p className="text-[11px] text-red-400">{error}</p>}

      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={pending}
          className="flex-1 rounded-lg bg-sky-500 px-4 py-2 text-xs font-bold text-white hover:bg-sky-400 disabled:opacity-50 transition-colors"
        >
          {pending ? "Filing…" : "File minute"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-border px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-accent transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
