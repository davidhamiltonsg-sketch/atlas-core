"use client"

import { useState, useTransition } from "react"
import { RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react"
import { refreshLivePrices } from "@/app/portfolio/actions"

export function RefreshPricesButton() {
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<{ success: boolean; updated?: number; error?: string } | null>(null)

  function handleRefresh() {
    setResult(null)
    startTransition(async () => {
      const res = await refreshLivePrices()
      setResult(res)
      if (res.success) {
        setTimeout(() => setResult(null), 4000)
      }
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={handleRefresh}
        disabled={isPending}
        className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground shadow-sm hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${isPending ? "animate-spin" : ""}`} />
        {isPending ? "Fetching prices…" : "Refresh Live Prices"}
      </button>

      {result && (
        <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${
          result.success
            ? "bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20"
            : "bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20"
        }`}>
          {result.success
            ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            : <AlertTriangle className="h-3.5 w-3.5 shrink-0" />}
          {result.success
            ? `${result.updated} price${result.updated !== 1 ? "s" : ""} updated from live market data`
            : result.error ?? "Failed to fetch prices"}
        </div>
      )}
    </div>
  )
}
