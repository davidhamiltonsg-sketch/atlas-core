"use client"

import { createContext, useCallback, useContext, useMemo, useState } from "react"
import { AlertTriangle, AlertCircle, CheckCircle, Info, X } from "lucide-react"
import { cn } from "@/lib/utils"
import type { AlertType } from "./alert"

interface ToastItem {
  id: number
  type: AlertType
  message: string
  title?: string
}

interface ToastContextValue {
  toast: (message: string, opts?: { type?: AlertType; title?: string; durationMs?: number }) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const TOAST_STYLES: Record<AlertType, string> = {
  success: "bg-green-50 border-green-200 text-green-900 dark:bg-green-950 dark:border-green-800 dark:text-green-100",
  error: "bg-red-50 border-red-200 text-red-900 dark:bg-red-950 dark:border-red-800 dark:text-red-100",
  warning: "bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-950 dark:border-amber-800 dark:text-amber-100",
  info: "bg-blue-50 border-blue-200 text-blue-900 dark:bg-blue-950 dark:border-blue-800 dark:text-blue-100",
}

const TOAST_ICONS: Record<AlertType, React.ComponentType<{ className?: string }>> = {
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
}

const DEFAULT_DURATION_MS = 4000

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const toast = useCallback((message: string, opts?: { type?: AlertType; title?: string; durationMs?: number }) => {
    const id = Date.now() + Math.random()
    const type = opts?.type ?? "info"
    setToasts(prev => [...prev, { id, type, message, title: opts?.title }])
    const durationMs = opts?.durationMs ?? DEFAULT_DURATION_MS
    setTimeout(() => dismiss(id), durationMs)
  }, [dismiss])

  const value = useMemo(() => ({ toast }), [toast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-[calc(100vw-2rem)] max-w-sm pointer-events-none"
        role="region"
        aria-label="Notifications"
        aria-live="polite"
      >
        {toasts.map(t => {
          const Icon = TOAST_ICONS[t.type]
          return (
            <div
              key={t.id}
              role="status"
              className={cn(
                "pointer-events-auto rounded-lg border px-4 py-3 shadow-lg flex gap-3 items-start",
                "motion-safe:animate-in motion-safe:slide-in-from-bottom-2 motion-safe:fade-in duration-200",
                TOAST_STYLES[t.type]
              )}
            >
              <Icon className="h-5 w-5 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                {t.title && <p className="font-semibold text-sm">{t.title}</p>}
                <p className={cn("text-sm", t.title && "mt-0.5")}>{t.message}</p>
              </div>
              <button
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss notification"
                className="shrink-0 rounded p-0.5 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error("useToast must be used within a ToastProvider")
  return ctx
}
