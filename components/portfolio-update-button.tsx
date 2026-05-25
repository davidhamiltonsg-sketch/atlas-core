"use client"

import { useState } from "react"
import { RefreshCw } from "lucide-react"
import { UpdatePortfolioModal } from "./update-portfolio-modal"

interface Holding {
  id: string
  ticker: string
  name: string
  latestUnits: number
  latestPrice: number
}

interface PortfolioUpdateButtonProps {
  holdings: Holding[]
  defaultMode?: "choose" | "manual" | "screenshot"
  label?: string
}

export function PortfolioUpdateButton({ holdings, defaultMode = "choose", label = "Update Values" }: PortfolioUpdateButtonProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-lg border border-border bg-card hover:bg-accent px-3 py-1.5 text-xs font-medium text-foreground transition-colors"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        {label}
      </button>

      {open && (
        <UpdatePortfolioModal holdings={holdings} onClose={() => setOpen(false)} defaultMode={defaultMode} />
      )}
    </>
  )
}
