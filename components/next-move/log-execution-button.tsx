"use client"

import { useState, useTransition } from "react"
import { Check, Loader2, AlertCircle } from "lucide-react"
import { logThisMonthExecution } from "@/app/next/actions"

interface LogExecutionButtonProps {
  ticker: string
  shares: number
  alreadyLogged: boolean
  canLog: boolean
  accent: "violet" | "sky"
}

/** One-tap "I bought N shares" — writes the append-only governance log, then locks
 *  itself for the rest of the month. */
export function LogExecutionButton({ ticker, shares, alreadyLogged, canLog, accent }: LogExecutionButtonProps) {
  const [done, setDone] = useState(alreadyLogged)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (!canLog || shares <= 0) return null

  if (done) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-2xl border border-success/30 bg-success/10 px-5 py-4 text-sm font-semibold text-success">
        <Check className="h-4 w-4" /> Logged for this month
      </div>
    )
  }

  const bg = accent === "sky" ? "bg-sky-600 hover:bg-sky-700" : "bg-violet-600 hover:bg-violet-700"
  return (
    <div className="space-y-2">
      <button
        onClick={() => {
          setError(null)
          startTransition(async () => {
            const result = await logThisMonthExecution(ticker, shares)
            if (result.success || result.error === "This month's purchase is already logged.") setDone(true)
            else setError(result.error ?? "Could not log the purchase.")
          })
        }}
        disabled={pending}
        className={`w-full flex items-center justify-center gap-2 rounded-2xl ${bg} disabled:opacity-60 text-white text-sm font-bold px-5 py-4 transition-colors`}
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        I bought {shares} share{shares === 1 ? "" : "s"} of {ticker}
      </button>
      {error && (
        <p className="flex items-center gap-1.5 text-xs text-danger">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      )}
    </div>
  )
}
