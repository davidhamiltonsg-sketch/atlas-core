import { CheckCircle2, AlertTriangle, XCircle, Info, Minus } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ReactNode } from "react"

// ─── Status — one consolidated semantic system ───────────────────────────────
export type Status = "positive" | "caution" | "critical" | "info" | "neutral"

const STATUS_TEXT: Record<Status, string> = {
  positive: "text-green-600 dark:text-green-400",
  caution:  "text-amber-600 dark:text-amber-400",
  critical: "text-red-600 dark:text-red-400",
  info:     "text-indigo-600 dark:text-indigo-400",
  neutral:  "text-muted-foreground",
}
const STATUS_PILL: Record<Status, string> = {
  positive: "bg-green-500/10 text-green-600 dark:text-green-400 ring-green-500/20",
  caution:  "bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-amber-500/20",
  critical: "bg-red-500/10 text-red-600 dark:text-red-400 ring-red-500/20",
  info:     "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 ring-indigo-500/20",
  neutral:  "bg-muted text-muted-foreground ring-border",
}
const STATUS_ICON = {
  positive: CheckCircle2, caution: AlertTriangle, critical: XCircle, info: Info, neutral: Minus,
} as const

/** Status as an icon — never colour alone (accessible + clearer). */
export function StatusIcon({ status, className }: { status: Status; className?: string }) {
  const Icon = STATUS_ICON[status]
  return <Icon className={cn("h-4 w-4 shrink-0", STATUS_TEXT[status], className)} />
}

/** Consistent status pill: icon + label, one look everywhere. */
export function Pill({ status = "neutral", icon = true, children, className }: {
  status?: Status; icon?: boolean; children: ReactNode; className?: string
}) {
  const Icon = STATUS_ICON[status]
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1",
      STATUS_PILL[status], className,
    )}>
      {icon && <Icon className="h-3 w-3" />}
      {children}
    </span>
  )
}

// ─── Card — one surface primitive (soft elevation, one radius) ───────────────
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("rounded-xl border border-border bg-card card-elevated", className)}>
      {children}
    </div>
  )
}

export function CardHeader({ title, subtitle, right, className }: {
  title: ReactNode; subtitle?: ReactNode; right?: ReactNode; className?: string
}) {
  return (
    <div className={cn("flex items-start justify-between gap-3 px-5 py-4 border-b border-border", className)}>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold leading-tight">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</p>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  )
}

// ─── Money — never ambiguous about currency ──────────────────────────────────
export function Money({ value, ccy = "SGD", sign = false, decimals = 0, className }: {
  value: number; ccy?: "SGD" | "USD"; sign?: boolean; decimals?: number; className?: string
}) {
  const n = Math.abs(value).toLocaleString("en-SG", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  const prefix = value < 0 ? "−" : sign ? "+" : ""
  return (
    <span className={cn("tabular-nums", className)}>
      {prefix}{ccy === "USD" ? "$" : "S$"}{n}
      <span className="ml-1 text-[0.7em] font-medium text-muted-foreground align-baseline">{ccy}</span>
    </span>
  )
}
