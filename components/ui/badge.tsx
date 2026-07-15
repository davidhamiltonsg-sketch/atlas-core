import { cn } from "@/lib/utils"
import type { ReactNode } from "react"

export type BadgeVariant = "default" | "success" | "warning" | "error" | "info" | "outline"

// Same semantic-token recipe as StatusChip (components/ui/status-chip.tsx) —
// one status language across both primitives. The split is size/shape only:
// StatusChip is the tiny rounded-full status pill for table cells; Badge is
// the larger rounded-md badge for arbitrary content (icons, counts, phrases).
const BADGE_STYLES: Record<BadgeVariant, string> = {
  default: "bg-muted text-foreground",
  success: "bg-success/10 text-success ring-1 ring-success/20",
  warning: "bg-warning/10 text-warning ring-1 ring-warning/20",
  error:   "bg-danger/10 text-danger ring-1 ring-danger/20",
  info:    "bg-info/10 text-info ring-1 ring-info/20",
  outline: "border border-border text-foreground",
}

interface BadgeProps {
  children: ReactNode
  variant?: BadgeVariant
  className?: string
}

export function Badge({ children, variant = "default", className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold",
        BADGE_STYLES[variant],
        className
      )}
    >
      {children}
    </span>
  )
}
