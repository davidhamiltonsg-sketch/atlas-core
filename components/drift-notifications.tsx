"use client"

import { useEffect, useRef, useState } from "react"
import { Bell, BellOff } from "lucide-react"

interface DriftAlert {
  ticker: string
  severity: "hard" | "soft"
  direction: "over" | "under"
  actualPct: number
  targetPct: number
}

interface DriftNotificationsProps {
  alerts: DriftAlert[]
}

const STORAGE_KEY = "atlas_notifications_enabled"
const LAST_NOTIFIED_KEY = "atlas_last_notified"
const NOTIFY_COOLDOWN_MS = 4 * 60 * 60 * 1000 // 4 hours

export function DriftNotifications({ alerts }: DriftNotificationsProps) {
  const [enabled, setEnabled] = useState(false)
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default")
  const notifiedRef = useRef(false)

  // Check notification support and stored preference on mount
  useEffect(() => {
    if (!("Notification" in window)) {
      setPermission("unsupported")
      return
    }
    setPermission(Notification.permission)
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === "true" && Notification.permission === "granted") {
      setEnabled(true)
    }
  }, [])

  // Fire notifications when enabled and alerts exist
  useEffect(() => {
    if (!enabled || notifiedRef.current || alerts.length === 0) return
    if (permission !== "granted") return

    // Cooldown: don't notify more than once per 4 hours
    const lastNotified = localStorage.getItem(LAST_NOTIFIED_KEY)
    if (lastNotified && Date.now() - parseInt(lastNotified) < NOTIFY_COOLDOWN_MS) return

    notifiedRef.current = true
    localStorage.setItem(LAST_NOTIFIED_KEY, String(Date.now()))

    const hardAlerts = alerts.filter(a => a.severity === "hard")
    const softAlerts = alerts.filter(a => a.severity === "soft")

    if (hardAlerts.length > 0) {
      const tickers = hardAlerts.map(a => a.ticker).join(", ")
      new Notification("Atlas Core — Hard Breach", {
        body: `${tickers} ${hardAlerts.length === 1 ? "has" : "have"} breached hard drift thresholds. Immediate review required.`,
        icon: "/icon-192.png",
        tag: "atlas-hard-breach",
        requireInteraction: true,
      })
    } else if (softAlerts.length > 0) {
      const tickers = softAlerts.map(a => a.ticker).join(", ")
      new Notification("Atlas Core — Drift Alert", {
        body: `${tickers} ${softAlerts.length === 1 ? "has" : "have"} drifted outside tolerance bands.`,
        icon: "/icon-192.png",
        tag: "atlas-soft-drift",
      })
    }
  }, [enabled, alerts, permission])

  async function toggleNotifications() {
    if (permission === "unsupported") return

    if (!enabled) {
      if (permission !== "granted") {
        const result = await Notification.requestPermission()
        setPermission(result)
        if (result !== "granted") return
      }
      setEnabled(true)
      localStorage.setItem(STORAGE_KEY, "true")
      notifiedRef.current = false // allow next fire
    } else {
      setEnabled(false)
      localStorage.setItem(STORAGE_KEY, "false")
    }
  }

  if (permission === "unsupported") return null

  return (
    <button
      onClick={toggleNotifications}
      title={
        permission === "denied"
          ? "Notifications blocked — enable in browser settings"
          : enabled
          ? "Drift notifications ON — click to disable"
          : "Enable drift notifications"
      }
      className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
        enabled
          ? "border-indigo-500/40 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"
          : "border-border bg-card hover:bg-accent text-muted-foreground"
      } ${permission === "denied" ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      {enabled ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
      {enabled ? "Alerts on" : "Alerts off"}
    </button>
  )
}
