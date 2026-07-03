import { CalendarDays, Building2, Landmark, AlertTriangle, Info } from "lucide-react"
import type { ScheduledEvent } from "@/lib/finnhub"

const KIND_META = {
  economic: { label: "Economic", Icon: Landmark,   cls: "text-violet-500 bg-violet-500/10" },
  earnings: { label: "Earnings", Icon: Building2,  cls: "text-violet-500 bg-violet-500/10" },
  policy:   { label: "Policy",   Icon: AlertTriangle, cls: "text-amber-500 bg-amber-500/10" },
} as const

function fmt(d: string): string {
  const date = new Date(d)
  if (isNaN(date.getTime())) return d
  return date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })
}

// F3 — read-only scheduled-events calendar. Context, NOT trade signals. Its only job
// is to prevent being surprised by SCHEDULED events; it never recommends an action.
export function ScheduledEvents({ events, stale, note }: { events: ScheduledEvent[]; stale: boolean; note: string | null }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center gap-2">
        <CalendarDays className="h-4 w-4 text-muted-foreground" />
        <div className="flex-1">
          <h2 className="text-sm font-semibold">Scheduled Events</h2>
          <p className="text-[11px] text-muted-foreground">Known dates ahead — context, not signals. Nothing here recommends a trade.</p>
        </div>
        {stale && (
          <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[9px] font-bold">
            <AlertTriangle className="h-2.5 w-2.5" /> STALE
          </span>
        )}
      </div>

      {note && (
        <div className="px-5 py-2.5 border-b border-border bg-muted/20 flex items-start gap-2">
          <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-[11px] text-muted-foreground">{note}</p>
        </div>
      )}

      {events.length === 0 ? (
        <div className="px-5 py-8 text-center text-xs text-muted-foreground">No scheduled events in the window.</div>
      ) : (
        <ol className="divide-y divide-border">
          {events.map((e, i) => {
            const meta = KIND_META[e.kind]
            const { Icon } = meta
            return (
              <li key={`${e.date}-${e.title}-${i}`} className="flex items-center gap-3 px-5 py-3">
                <div className="w-20 shrink-0 text-[11px] font-semibold text-foreground/80">{fmt(e.date)}</div>
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${meta.cls}`}>
                  <Icon className="h-3 w-3" />{meta.label}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{e.title}</p>
                  {e.detail && <p className="text-[11px] text-muted-foreground">{e.detail}</p>}
                </div>
              </li>
            )
          })}
        </ol>
      )}

      <div className="px-5 py-2.5 border-t border-border bg-muted/20">
        <p className="text-[10px] text-muted-foreground italic">
          The purpose of this list is to avoid being surprised by scheduled events — not to trade around them.
          Per the governance rules, scheduled events are held through, not traded.
        </p>
      </div>
    </div>
  )
}
