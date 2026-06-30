"use client"

import { useState, useTransition } from "react"
import { Check, CheckCircle2 } from "lucide-react"
import { logExecution } from "@/lib/execution-actions"

// "I did this" — logs that the user executed the recommended action, closing the loop.
export function MarkDoneButton({ action }: { action: string }) {
  const [done, setDone] = useState(false)
  const [pending, startTransition] = useTransition()

  if (done) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-green-600 dark:text-green-400">
        <CheckCircle2 className="h-3.5 w-3.5" /> Logged — nicely done
      </span>
    )
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(async () => {
        const r = await logExecution(action)
        if (!("error" in r)) setDone(true)
      })}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background/60 px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-accent/60 transition-colors disabled:opacity-50"
    >
      <Check className="h-3.5 w-3.5" /> {pending ? "Saving…" : "I did this"}
    </button>
  )
}
