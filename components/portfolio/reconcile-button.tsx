"use client"

import { useEffect, useState, useTransition } from "react"
import { RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react"
import { reconcileCostBasis } from "@/app/portfolio/actions"
import { setRefreshing } from "@/lib/client/refresh-signal"

export function ReconcileButton() {
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<{
    success: boolean; tradesImported?: number; dividendsImported?: number; ledgerImported?: number; contributionsImported?: number; error?: string
  } | null>(null)

  useEffect(() => {
    setRefreshing(isPending)
    return () => setRefreshing(false)
  }, [isPending])

  function handleReconcile() {
    setResult(null)
    startTransition(async () => {
      const res = await reconcileCostBasis()
      setResult(res)
      if (res.success) setTimeout(() => setResult(null), 4000)
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={handleReconcile}
        disabled={isPending}
        className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground shadow-sm hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${isPending ? "animate-spin" : ""}`} />
        {isPending ? "Reconciling…" : "Reconcile Cost Basis"}
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
          <p>
            {result.success
              ? `Reconciled — ${result.tradesImported ?? 0} trade${result.tradesImported !== 1 ? "s" : ""}, ${result.dividendsImported ?? 0} dividend${result.dividendsImported !== 1 ? "s" : ""}, ${result.ledgerImported ?? 0} cash entr${result.ledgerImported !== 1 ? "ies" : "y"} checked against your broker`
              : result.error ?? "Couldn't reconcile"}
          </p>
        </div>
      )}
    </div>
  )
}
