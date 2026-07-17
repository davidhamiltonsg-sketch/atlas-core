"use client"

import { useEffect, useState, useTransition } from "react"
import { RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react"
import { refreshLivePrices } from "@/app/portfolio/actions"
import { setRefreshing } from "@/lib/client/refresh-signal"

export function RefreshPricesButton() {
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<{ success: boolean; updated?: number; unitsUpdated?: number; added?: number; removed?: number; source?: "ibkr" | "yahoo"; note?: string; error?: string } | null>(null)

  // Publish pending state so sibling components (the holdings table) can show a
  // loading skeleton while this refresh — and the revalidation it triggers — is in flight.
  useEffect(() => {
    setRefreshing(isPending)
    return () => setRefreshing(false)
  }, [isPending])

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
        <div className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${
          result.success
            ? "bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20"
            : "bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20"
        }`}>
          {result.success
            ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            : <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />}
          <div>
            <p>
              {result.success
                ? result.source === "ibkr"
                  ? `${result.updated} holding${result.updated !== 1 ? "s" : ""} synced from your broker — share counts and prices updated`
                    + (result.unitsUpdated ? ` · ${result.unitsUpdated} share count${result.unitsUpdated !== 1 ? "s" : ""} changed` : "")
                    + (result.added ? ` · ${result.added} new holding${result.added !== 1 ? "s" : ""} added` : "")
                    + (result.removed ? ` · ${result.removed} sold-out holding${result.removed !== 1 ? "s" : ""} removed` : "")
                  : `${result.updated} price${result.updated !== 1 ? "s" : ""} updated from live market data`
                : result.error ?? "Couldn't fetch prices"}
            </p>
            {result.success && result.note && (
              <p className="text-muted-foreground mt-0.5">{result.note}</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
