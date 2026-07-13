export type BitcoinCyclePhase = "pre-halving" | "post-halving-year-1" | "post-halving-year-2" | "bear"

const LAST_HALVING = new Date("2024-04-19")
const NEXT_HALVING = new Date("2028-04-19")

export function getBitcoinCyclePhase(currentDate: Date = new Date()): BitcoinCyclePhase {
  const monthsSinceHalving = Math.floor(
    (currentDate.getTime() - LAST_HALVING.getTime()) / (30.44 * 24 * 60 * 60 * 1000),
  )
  const monthsUntilHalving = Math.floor(
    (NEXT_HALVING.getTime() - currentDate.getTime()) / (30.44 * 24 * 60 * 60 * 1000),
  )

  if (monthsUntilHalving <= 6) return "pre-halving"
  if (monthsSinceHalving >= 0 && monthsSinceHalving < 12) return "post-halving-year-1"
  if (monthsSinceHalving >= 12 && monthsSinceHalving < 24) return "post-halving-year-2"
  return "bear"
}
