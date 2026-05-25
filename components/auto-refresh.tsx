"use client"

import { useEffect, useRef, useState } from "react"
import { RefreshCw } from "lucide-react"
import { refreshLivePrices } from "@/app/portfolio/actions"

interface AutoRefreshProps {
  intervalHours?: number
}

export function AutoRefresh({ intervalHours = 24 }: AutoRefreshProps) {
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [status, setStatus] = useState<"idle" | "refreshing" | "done" | "error">("idle")
  const intervalRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function doRefresh() {
    setStatus("refreshing")
    try {
      const result = await refreshLivePrices()
      if (result.success) {
        setLastRefresh(new Date())
        setStatus("done")
        setTimeout(() => setStatus("idle"), 3000)
      } else {
        setStatus("error")
        setTimeout(() => setStatus("idle"), 5000)
      }
    } catch {
      setStatus("error")
      setTimeout(() => setStatus("idle"), 5000)
    }
  }

  useEffect(() => {
    // Check if we should auto-refresh based on last stored time
    const stored = localStorage.getItem("atlas_last_auto_refresh")
    const now = Date.now()
    const intervalMs = intervalHours * 60 * 60 * 1000

    if (!stored || now - parseInt(stored) > intervalMs) {
      // Auto-refresh on mount if interval has passed
      doRefresh().then(() => localStorage.setItem("atlas_last_auto_refresh", String(Date.now())))
    }

    // Schedule periodic check
    intervalRef.current = setInterval(() => {
      const s = localStorage.getItem("atlas_last_auto_refresh")
      if (!s || Date.now() - parseInt(s) > intervalMs) {
        doRefresh().then(() => localStorage.setItem("atlas_last_auto_refresh", String(Date.now())))
      }
    }, 60 * 60 * 1000) // check every hour

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [intervalHours])

  return (
    <button
      onClick={() => {
        doRefresh().then(() => localStorage.setItem("atlas_last_auto_refresh", String(Date.now())))
      }}
      disabled={status === "refreshing"}
      title={lastRefresh ? `Last auto-refresh: ${lastRefresh.toLocaleTimeString()}` : "Auto-refresh prices"}
      className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
        status === "done"
          ? "border-green-500/40 bg-green-500/10 text-green-600 dark:text-green-400"
          : status === "error"
          ? "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400"
          : "border-border bg-card hover:bg-accent text-foreground"
      }`}
    >
      <RefreshCw className={`h-3.5 w-3.5 ${status === "refreshing" ? "animate-spin" : ""}`} />
      {status === "refreshing" ? "Refreshing…" : status === "done" ? "Updated" : status === "error" ? "Failed" : "Refresh Prices"}
    </button>
  )
}
