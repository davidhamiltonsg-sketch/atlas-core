"use client"

import { Badge } from "@/components/ui/badge"

export type BitcoinCyclePhase = "pre-halving" | "post-halving-year-1" | "post-halving-year-2" | "bear"

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

/**
 * Determine Bitcoin cycle phase based on current date and halving dates.
 * Bitcoin halving occurs approximately every 4 years.
 *
 * Recent & upcoming halving dates:
 * - 2020-05-11: 3rd halving
 * - 2024-04-19: 4th halving
 * - 2028-04-19 (estimated): 5th halving
 *
 * Post-halving bull phases historically last 12-24 months.
 * Bear phases are defined as price < 50% of cycle high.
 */
export function getBitcoinCyclePhase(currentDate: Date = new Date()): BitcoinCyclePhase {
  // 4th halving: 2024-04-19
  const LAST_HALVING = new Date("2024-04-19")
  const NEXT_HALVING = new Date("2028-04-19")

  const monthsSinceHalving = Math.floor(
    (currentDate.getTime() - LAST_HALVING.getTime()) / (30.44 * 24 * 60 * 60 * 1000)
  )

  // Months until next halving
  const monthsUntilHalving = Math.floor(
    (NEXT_HALVING.getTime() - currentDate.getTime()) / (30.44 * 24 * 60 * 60 * 1000)
  )

  // Pre-halving: within 6 months of next halving
  if (monthsUntilHalving <= 6) {
    return "pre-halving"
  }

  // Post-halving phases (historically bull markets)
  if (monthsSinceHalving >= 0 && monthsSinceHalving < 12) {
    return "post-halving-year-1"
  }

  if (monthsSinceHalving >= 12 && monthsSinceHalving < 24) {
    return "post-halving-year-2"
  }

  // Default: normal market (cap: 8%, not 6%)
  // Note: Bear phase detection would require live price data (price < 50% of cycle high).
  // For now, only the IBKR data will trigger bear phase via constitution rules.
  return "bear"
}
