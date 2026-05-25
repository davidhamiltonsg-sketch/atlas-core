"use client"

import { useState, useTransition } from "react"
import { Plus, Trash2, PiggyBank, Loader2, Check, AlertCircle, X, Calendar } from "lucide-react"
import { addContributionAction, deleteContributionAction } from "./actions"

type Contribution = {
  id: string
  amount: number
  date: string
  note: string | null
}

interface ContributionsClientProps {
  contributions: Contribution[]
  monthlyTarget: number
}

// Group contributions by year-month
function groupByMonth(contributions: Contribution[]) {
  const groups = new Map<string, Contribution[]>()
  for (const c of contributions) {
    const key = c.date.substring(0, 7) // YYYY-MM
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(c)
  }
  return Array.from(groups.entries()).sort((a, b) => b[0].localeCompare(a[0]))
}

export function ContributionsClient({ contributions: initialContributions, monthlyTarget }: ContributionsClientProps) {
  const [contributions, setContributions] = useState(initialContributions)
  const [showForm, setShowForm] = useState(false)
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setMsg(null)
    const formData = new FormData(e.currentTarget)
    const form = e.currentTarget
    startTransition(async () => {
      const result = await addContributionAction(formData)
      if (result.success) {
        setMsg({ type: "success", text: "Contribution recorded." })
        setShowForm(false)
        form.reset()
        window.location.reload()
      } else {
        setMsg({ type: "error", text: result.error ?? "Failed to record." })
      }
    })
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deleteContributionAction(id)
      if (result.success) {
        setContributions(prev => prev.filter(c => c.id !== id))
      }
    })
  }

  const total = contributions.reduce((s, c) => s + c.amount, 0)
  const months = groupByMonth(contributions)
  const monthCount = months.length
  const avgMonthly = monthCount > 0 ? total / monthCount : 0

  // Generate next 12 months schedule
  const schedule: Array<{ label: string; key: string; target: number }> = []
  const now = new Date()
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 15)
    const key = d.toISOString().substring(0, 7)
    schedule.push({
      label: d.toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
      key,
      target: monthlyTarget,
    })
  }

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-border bg-card p-4 card-elevated">
          <p className="text-xs text-muted-foreground">Total Contributed</p>
          <p className="text-2xl font-black mt-1 tabular-nums">${total.toLocaleString()}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">USD across {monthCount} months</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 card-elevated">
          <p className="text-xs text-muted-foreground">Monthly Average</p>
          <p className="text-2xl font-black mt-1 tabular-nums">${avgMonthly.toLocaleString("en-US", { maximumFractionDigits: 0 })}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">vs target ${monthlyTarget.toLocaleString()}</p>
        </div>
        <div className={`rounded-xl border bg-card p-4 card-elevated ${avgMonthly >= monthlyTarget ? "border-green-500/30" : "border-yellow-400/30"}`}>
          <p className="text-xs text-muted-foreground">Target Achievement</p>
          <p className={`text-2xl font-black mt-1 tabular-nums ${avgMonthly >= monthlyTarget ? "text-green-500" : "text-yellow-400"}`}>
            {monthlyTarget > 0 ? `${((avgMonthly / monthlyTarget) * 100).toFixed(0)}%` : "—"}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">of ${monthlyTarget.toLocaleString()} target</p>
        </div>
      </div>

      {/* Header + button */}
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Contribution History</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-3 py-1.5 transition-colors"
        >
          {showForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          {showForm ? "Cancel" : "Record Contribution"}
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
            <h3 className="text-sm font-semibold">Record a Contribution</h3>
          </div>
          <form onSubmit={handleAdd} className="p-5 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Amount (USD)</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                  <input name="amount" type="number" step="100" min="1" required defaultValue={monthlyTarget} className="w-full rounded-lg border border-border bg-background pl-7 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Date</label>
                <input name="date" type="date" required defaultValue={new Date().toISOString().split("T")[0]} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Note (optional)</label>
              <input name="note" placeholder="Monthly DCA…" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all" />
            </div>
            <button type="submit" disabled={isPending} className="flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-xs font-semibold px-4 py-2 transition-colors">
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Record
            </button>
          </form>
        </div>
      )}

      {/* Monthly breakdown */}
      {contributions.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <PiggyBank className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm font-medium">No contributions recorded yet</p>
          <p className="text-xs text-muted-foreground mt-1">Start logging your monthly contributions above.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {months.map(([key, items]) => {
            const monthTotal = items.reduce((s, c) => s + c.amount, 0)
            const label = new Date(key + "-01").toLocaleDateString("en-GB", { month: "long", year: "numeric" })
            const pct = monthlyTarget > 0 ? Math.min(100, (monthTotal / monthlyTarget) * 100) : 100
            return (
              <div key={key} className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="flex items-center gap-4 px-5 py-3 border-b border-border">
                  <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
                  <h3 className="text-sm font-semibold flex-1">{label}</h3>
                  <span className={`text-sm font-black tabular-nums ${monthTotal >= monthlyTarget ? "text-green-500" : "text-yellow-400"}`}>
                    ${monthTotal.toLocaleString()}
                  </span>
                  <span className="text-[11px] text-muted-foreground">/ ${monthlyTarget.toLocaleString()}</span>
                </div>
                <div className="h-1 bg-muted">
                  <div className="h-full bg-indigo-500 transition-all" style={{ width: `${pct}%` }} />
                </div>
                <div className="divide-y divide-border">
                  {items.map(c => (
                    <div key={c.id} className="flex items-center justify-between px-5 py-2.5">
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground">{new Date(c.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
                        <span className="text-xs font-semibold">${c.amount.toLocaleString()}</span>
                        {c.note && <span className="text-xs text-muted-foreground">{c.note}</span>}
                      </div>
                      <button onClick={() => handleDelete(c.id)} className="text-muted-foreground hover:text-red-500 transition-colors">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Upcoming schedule */}
      <div>
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Upcoming Schedule</h2>
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="divide-y divide-border">
            {schedule.map((m, i) => {
              const actual = contributions.filter(c => c.date.startsWith(m.key))
              const done = actual.length > 0
              const actualAmount = actual.reduce((s, c) => s + c.amount, 0)
              return (
                <div key={m.key} className={`flex items-center justify-between px-5 py-3 ${i === 0 ? "bg-indigo-500/[0.04]" : ""}`}>
                  <div className="flex items-center gap-3">
                    <div className={`h-2 w-2 rounded-full ${done ? "bg-green-500" : i === 0 ? "bg-indigo-500 animate-pulse" : "bg-border"}`} />
                    <span className="text-xs font-medium">{m.label}</span>
                    {i === 0 && !done && <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-semibold bg-indigo-500/10 px-2 py-0.5 rounded-full">Next contribution</span>}
                  </div>
                  <div className="text-right">
                    {done ? (
                      <span className="text-xs font-bold text-green-500">${actualAmount.toLocaleString()} ✓</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">${m.target.toLocaleString()} target</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
