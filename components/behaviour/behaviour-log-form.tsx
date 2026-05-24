"use client"

import { useState, useTransition } from "react"
import { Plus, X, Brain, ChevronDown } from "lucide-react"
import { logBehaviour, deleteBehaviourLog } from "@/app/behaviour/actions"

const LOG_TYPES = [
  { value: "Impulse",     label: "Impulse Resisted",   color: "text-red-500",   bg: "bg-red-500/10"   },
  { value: "Emotion",     label: "Emotional State",     color: "text-amber-500", bg: "bg-amber-500/10" },
  { value: "Decision",    label: "Decision Made",       color: "text-blue-500",  bg: "bg-blue-500/10"  },
  { value: "Observation", label: "Observation",         color: "text-purple-500",bg: "bg-purple-500/10"},
  { value: "Reflection",  label: "Reflection",          color: "text-green-500", bg: "bg-green-500/10" },
]

type Log = {
  id: string
  type: string
  note: string
  date: Date | string
}

interface Props {
  initialLogs: Log[]
}

export function BehaviourLogForm({ initialLogs }: Props) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [deletingId, setDeletingId] = useState<string | null>(null)

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      await logBehaviour(formData)
      setOpen(false)
    })
  }

  function handleDelete(id: string) {
    setDeletingId(id)
    startTransition(async () => {
      await deleteBehaviourLog(id)
      setDeletingId(null)
    })
  }

  const typeMap = Object.fromEntries(LOG_TYPES.map(t => [t.value, t]))

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Behaviour Log</h2>
          {initialLogs.length > 0 && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
              {initialLogs.length}
            </span>
          )}
        </div>
        <button
          onClick={() => setOpen(v => !v)}
          className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent transition-colors"
        >
          <Plus className="h-3 w-3" />
          Log entry
        </button>
      </div>

      {/* Entry form */}
      {open && (
        <form action={handleSubmit} className="mb-4 rounded-lg border border-border bg-muted/30 p-4 space-y-3">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Type</label>
            <div className="relative">
              <select
                name="type"
                required
                defaultValue=""
                className="w-full appearance-none rounded border border-border bg-card px-3 py-2 pr-8 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="" disabled>Choose type…</option>
                {LOG_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Note</label>
            <textarea
              name="note"
              required
              rows={3}
              placeholder="Describe what happened, what you felt, and what you did…"
              className="w-full rounded border border-border bg-card px-3 py-2 text-xs leading-relaxed resize-none focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/50"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="rounded bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {isPending ? "Saving…" : "Save entry"}
            </button>
          </div>
        </form>
      )}

      {/* Log entries */}
      {initialLogs.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent">
            <Brain className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="text-xs text-muted-foreground max-w-xs">
            No entries yet. Log emotional states, impulse decisions resisted, or behavioural observations here.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {initialLogs.map(log => {
            const t = typeMap[log.type] ?? { label: log.type, color: "text-muted-foreground", bg: "bg-muted" }
            const date = new Date(log.date)
            const dateStr = date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
            return (
              <div key={log.id} className="group relative rounded-lg border border-border bg-muted/20 px-4 py-3">
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${t.bg} ${t.color}`}>
                    {t.label}
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] text-muted-foreground">{dateStr}</span>
                    <button
                      onClick={() => handleDelete(log.id)}
                      disabled={deletingId === log.id || isPending}
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground/60 hover:text-red-500 disabled:opacity-30"
                      title="Delete entry"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{log.note}</p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
