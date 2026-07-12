import { cn } from "@/lib/utils"
import type { ReactNode } from "react"

export type BadgeVariant = "default" | "success" | "warning" | "error" | "info" | "outline"

const BADGE_STYLES: Record<BadgeVariant, string> = {
  default: "bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100",
  success: "bg-green-100 text-green-900 dark:bg-green-900 dark:text-green-100",
  warning: "bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100",
  error: "bg-red-100 text-red-900 dark:bg-red-900 dark:text-red-100",
  info: "bg-blue-100 text-blue-900 dark:bg-blue-900 dark:text-blue-100",
  outline: "border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100",
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
