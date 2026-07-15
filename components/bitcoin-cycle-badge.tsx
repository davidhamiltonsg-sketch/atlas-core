"use client"

import { Badge } from "@/components/ui/badge"
import type { BitcoinCyclePhase } from "@/lib/bitcoin-cycle"

export type { BitcoinCyclePhase }

interface BitcoinCycleBadgeProps {
  phase: BitcoinCyclePhase
}

const PHASE_CONFIG: Record<BitcoinCyclePhase, { label: string; description: string; bgColor: string }> = {
  "pre-halving": {
    label: "Pre-Halving",
    description: "Leading into halving event. 8% cap.",
    bgColor: "bg-blue-50 border-blue-200",
  },
  "post-halving-year-1": {
    label: "Post-Halving Bull (Year 1)",
    description: "Early post-halving bull market. 8% cap.",
    bgColor: "bg-green-50 border-green-200",
  },
  "post-halving-year-2": {
    label: "Post-Halving Bull (Year 2)",
    description: "Continued post-halving bull. 8% cap.",
    bgColor: "bg-emerald-50 border-emerald-200",
  },
  bear: {
    label: "Bear Market",
    description: "Price < 50% of cycle high. 6% cap (defensive).",
    bgColor: "bg-amber-50 border-amber-200",
  },
}

export function BitcoinCycleBadge({ phase }: BitcoinCycleBadgeProps) {
  const config = PHASE_CONFIG[phase]

  return (
    <div className={`px-3 py-2 rounded-md border ${config.bgColor}`}>
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <p className="font-semibold text-sm">{config.label}</p>
          <p className="text-xs text-gray-600">{config.description}</p>
        </div>
      </div>
    </div>
  )
}

