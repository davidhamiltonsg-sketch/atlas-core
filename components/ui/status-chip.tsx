import { cn } from "@/lib/utils"

export type StatusChipStatus = "good" | "warn" | "crit"

// The one status-pill recipe, on semantic tokens. The tokens already flip with
// .dark (and re-skin under data-theme="sbr"), so no dark: variants are needed —
// this replaces the repeated `bg-X-500/10 text-X-600 dark:text-X-400 ring-X-500/20`
// pattern that hardcoded the palette per call-site.
const CHIP_STYLES: Record<StatusChipStatus, string> = {
  good: "bg-success/10 text-success ring-success/20",
  warn: "bg-warning/10 text-warning ring-warning/20",
  crit: "bg-danger/10 text-danger ring-danger/20",
}

interface StatusChipProps {
  status: StatusChipStatus
  label: string
  className?: string
  title?: string
}

/** Small semantic status pill — "Healthy" / "Soft Drift" / "Over limit" etc. */
export function StatusChip({ status, label, className, title }: StatusChipProps) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1",
        CHIP_STYLES[status],
        className
      )}
    >
      {label}
    </span>
  )
}
