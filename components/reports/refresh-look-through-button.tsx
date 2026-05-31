"use client"

import { useState, useTransition } from "react"
import { RefreshCw, Check, AlertCircle } from "lucide-react"
import { refreshLookThroughAction } from "@/app/reports/actions"

export function RefreshLookThroughButton({ lastUpdated }: { lastUpdated: Date | null }) {
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)

  function handleRefresh() {
    setResult(null)
    startTransition(async () => {
      const res = await refreshLookThroughAction()
      if (res.error) {
        setResult({ ok: false, msg: res.error })
      } else {
        const warnings = res.errors?.length ? ` (${res.errors.join("; ")})` : ""
        setResult({ ok: true, msg: `Updated ${res.updated?.join(", ")}${warnings}` })
      }
    })
  }

  const ageLabel = lastUpdated
    ? `Updated ${lastUpdated.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" })}`
    : "Never refreshed — using estimates"

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        onClick={handleRefresh}
        disabled={isPending}
        className="no-print inline-flex items-center gap-2 rounded-lg border border-indigo-500/30 bg-indigo-500/[0.06] hover:bg-indigo-500/10 text-indigo-500 px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${isPending ? "animate-spin" : ""}`} />
        {isPending ? "Fetching holdings…" : "Refresh Holdings Data"}
      </button>
      <p className="text-[11px] text-muted-foreground">{ageLabel}</p>
      {result && (
        <div className={`flex items-start gap-1.5 text-[11px] max-w-xs text-right ${result.ok ? "text-green-500" : "text-red-500"}`}>
          {result.ok
            ? <Check className="h-3 w-3 shrink-0 mt-0.5" />
            : <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />}
          {result.msg}
        </div>
      )}
    </div>
  )
}
