"use client"

import { useEffect, useRef, useState } from "react"
import { RefreshCw } from "lucide-react"
import { refreshLivePrices } from "@/app/portfolio/actions"

interface AutoRefreshProps {
  intervalHours?: number
}

// Auto-update on opening. Prices refresh on every open (short gate to avoid snapshot
// spam); the heavier IBKR sync (share counts + add/remove reconciliation) runs on a
// longer gate to respect IBKR Flex rate limits (~15–20 min between requests).
const PRICE_GATE_MS = 15 * 60 * 1000      // 15 minutes
const IBKR_GATE_MS  = 6 * 60 * 60 * 1000  // 6 hours
const PRICE_KEY = "atlas_last_price_refresh"
const IBKR_KEY  = "atlas_last_ibkr_sync"

export function AutoRefresh({ intervalHours }: AutoRefreshProps) {
  void intervalHours
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [status, setStatus] = useState<"idle" | "refreshing" | "done" | "error">("idle")
  const [synced, setSynced] = useState(false) // true when share counts were synced from IBKR
  const [note, setNote] = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function doRefresh(withIbkr: boolean) {
    setStatus("refreshing")
    try {
      const result = await refreshLivePrices({ withIbkr, reconcile: withIbkr })
      if (result.success) {
        localStorage.setItem(PRICE_KEY, String(Date.now()))
        if (result.source === "ibkr") localStorage.setItem(IBKR_KEY, String(Date.now()))
        setLastRefresh(new Date())
        const changed = (result.unitsUpdated ?? 0) + (result.added ?? 0) + (result.removed ?? 0)
        setSynced(result.source === "ibkr" && changed > 0)
        const parts = [
          result.added ? `+${result.added} added` : "",
          result.removed ? `−${result.removed} removed` : "",
          result.unitsUpdated ? `${result.unitsUpdated} share count${result.unitsUpdated !== 1 ? "s" : ""} changed` : "",
        ].filter(Boolean)
        setNote(parts.length ? parts.join(" · ") : (result.note ?? null))
        setStatus("done")
        setTimeout(() => setStatus("idle"), 3500)
      } else {
        setNote(result.error ?? null)
        setStatus("error")
        setTimeout(() => setStatus("idle"), 5000)
      }
    } catch {
      setStatus("error")
      setTimeout(() => setStatus("idle"), 5000)
    }
  }

  useEffect(() => {
    function maybeRefresh() {
      const now = Date.now()
      const priceStamp = parseInt(localStorage.getItem(PRICE_KEY) ?? "0", 10)
      const ibkrStamp = parseInt(localStorage.getItem(IBKR_KEY) ?? "0", 10)
      const ibkrDue = now - ibkrStamp > IBKR_GATE_MS
      const priceDue = now - priceStamp > PRICE_GATE_MS
      if (priceDue || ibkrDue) doRefresh(ibkrDue)
    }
    // Update on opening
    maybeRefresh()
    // And periodically while the tab stays open
    intervalRef.current = setInterval(maybeRefresh, 30 * 60 * 1000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [])

  return (
    <button
      onClick={() => doRefresh(true)} // manual click → full sync (prices + IBKR share counts + reconcile)
      disabled={status === "refreshing"}
      title={
        note ??
        (lastRefresh ? `Last refresh: ${lastRefresh.toLocaleTimeString()}${synced ? " · share counts synced from IBKR" : ""}` : "Refresh prices and share counts")
      }
      className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
        status === "done"
          ? "border-green-500/40 bg-green-500/10 text-green-600 dark:text-green-400"
          : status === "error"
          ? "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400"
          : "border-border bg-card hover:bg-accent text-foreground"
      }`}
    >
      <RefreshCw className={`h-3.5 w-3.5 ${status === "refreshing" ? "animate-spin" : ""}`} />
      {status === "refreshing" ? "Refreshing…"
        : status === "done" ? (synced ? "Synced ✓" : "Prices updated")
        : status === "error" ? "Failed"
        : "Refresh"}
    </button>
  )
}
