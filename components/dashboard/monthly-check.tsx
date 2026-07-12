"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { CalendarCheck, Check, Loader2 } from "lucide-react"
import { logMonthlyCheck } from "@/lib/monthly-check-actions"

const CADENCE_DAYS = 30

// The monthly 5-minute check, made a first-class habit. When you're up to date it
// gently tells you to close the app — the whole point is NOT to check more often.
export function MonthlyCheck({ lastCheckIso }: { lastCheckIso: string | null }) {
  const [isPending, start] = useTransition()
  const router = useRouter()

  const last = lastCheckIso ? new Date(lastCheckIso) : null
  // eslint-disable-next-line react-hooks/purity
  const daysSince = last ? Math.floor((Date.now() - last.getTime()) / 86_400_000) : null
  const dueIn = daysSince === null ? 0 : Math.max(0, CADENCE_DAYS - daysSince)
  const due = dueIn === 0

  function mark() {
    start(async () => { await logMonthlyCheck(); router.refresh() })
  }

  if (!due) {
    return (
      <div className="flex items-center gap-2.5 rounded-xl border border-green-500/25 bg-green-500/[0.05] px-4 py-2.5">
        <Check className="h-4 w-4 text-green-500 shrink-0" />
        <p className="text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">You&apos;re up to date.</span>{" "}
          Last check {daysSince === 0 ? "today" : `${daysSince} day${daysSince === 1 ? "" : "s"} ago`} · next due in {dueIn} day{dueIn === 1 ? "" : "s"}. Nothing to do — close the app.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet-500/30 bg-violet-500/[0.06] px-4 py-3">
      <div className="flex items-center gap-2.5">
        <CalendarCheck className="h-4 w-4 text-violet-500 shrink-0" />
        <p className="text-xs">
          <span className="font-semibold">Time for your monthly check.</span>{" "}
          <span className="text-muted-foreground">
            Read the Next Best Move, route this month&apos;s money, then mark it done.
            {last ? ` Last done ${daysSince} days ago.` : ""}
          </span>
        </p>
      </div>
      <button
        onClick={mark}
        disabled={isPending}
        className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-60 px-3 py-1.5 text-xs font-semibold text-white transition-colors shrink-0"
      >
        {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
        Mark this month done
      </button>
    </div>
  )
}
