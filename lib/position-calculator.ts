/**
 * Atlas Core — Unified Position Calculator v1
 *
 * Single source of truth for allocation calculations across all pages.
 * Ensures Dashboard, Portfolio, Mission Control, Forecast, and Reports all
 * show identical percentages for the same holdings.
 *
 * Key principle: Bitcoin sleeve consolidation (BTC + IBIT + GBTC) happens
 * FIRST, then percentages are calculated on the consolidated positions.
 */

import { BITCOIN_TICKERS } from "@/lib/constants"

// Extended Bitcoin holdings including legacy GBTC
const ALL_BITCOIN_TICKERS = ["BTC", "IBIT", "GBTC"] as const

export interface Holding {
  ticker: string
  name: string
  value: number
  units?: number
  price?: number
  [key: string]: any
}

export interface Constitution {
  [key: string]: any
}

/**
 * Calculate allocation percentages consistently across all pages.
 * Consolidates Bitcoin sleeve (BTC + IBIT + GBTC) into a single position first.
 *
 * @param holdings Array of holdings with values
 * @param constitution (unused but kept for future governance checks)
 * @returns Map of ticker -> percentage allocation
 */
export function calculateAllocationPercentages(
  holdings: Holding[],
  _constitution?: Constitution
): Map<string, number> {
  // 1. Consolidate Bitcoin sleeve first
  const consolidated = consolidateBitcoinSleeve(holdings)

  // 2. Calculate total value
  const totalValue = consolidated.reduce((sum, h) => sum + h.value, 0)

  // 3. Calculate percentages
  const percentages = new Map<string, number>()
  consolidated.forEach((holding) => {
    const pct = totalValue > 0 ? (holding.value / totalValue) * 100 : 0
    percentages.set(holding.ticker, pct)
  })

  return percentages
}

/**
 * Consolidate Bitcoin sleeve holdings (BTC, IBIT, GBTC) into a single
 * "BTC" position that represents the total Bitcoin exposure.
 * Non-Bitcoin holdings pass through unchanged.
 *
 * Note: This handles both BITCOIN_TICKERS (BTC, IBIT) and legacy GBTC.
 *
 * @param holdings Array of all holdings
 * @returns Consolidated holdings array with Bitcoin merged
 */
function consolidateBitcoinSleeve(holdings: Holding[]): Holding[] {
  const bitcoinHoldings = holdings.filter((h) =>
    ALL_BITCOIN_TICKERS.includes(h.ticker as any)
  )

  if (bitcoinHoldings.length <= 1) {
    // No consolidation needed if 0 or 1 Bitcoin holdings
    return holdings
  }

  // Sum all Bitcoin holdings
  const totalBitcoinValue = bitcoinHoldings.reduce((sum, h) => sum + h.value, 0)
  const totalBitcoinUnits = bitcoinHoldings.reduce((sum, h) => sum + (h.units ?? 0), 0)

  // Get the first Bitcoin holding's metadata for the consolidated position
  const firstBtc = bitcoinHoldings[0]

  // Create the consolidated Bitcoin position
  const consolidatedBitcoin: Holding = {
    ...firstBtc,
    ticker: "BTC",
    name: `Bitcoin sleeve · ${bitcoinHoldings.map((h) => h.ticker).join(" + ")}`,
    value: totalBitcoinValue,
    units: totalBitcoinUnits,
  }

  // Return non-Bitcoin holdings plus the consolidated Bitcoin position
  const nonBitcoin = holdings.filter(
    (h) => !ALL_BITCOIN_TICKERS.includes(h.ticker as any)
  )

  return [...nonBitcoin, consolidatedBitcoin]
}

/**
 * Calculate Bitcoin sleeve percentage specifically (used for display).
 * Consolidates all Bitcoin holdings and returns their combined percentage.
 *
 * @param holdings Array of all holdings
 * @returns Bitcoin sleeve percentage (0-100)
 */
export function calculateBitcoinSleevePercent(holdings: Holding[]): number {
  const consolidated = consolidateBitcoinSleeve(holdings)
  const btcPosition = consolidated.find((h) => h.ticker === "BTC")

  if (!btcPosition || btcPosition.value <= 0) {
    return 0
  }

  const totalValue = consolidated.reduce((sum, h) => sum + h.value, 0)
  return totalValue > 0 ? (btcPosition.value / totalValue) * 100 : 0
}

/**
 * Get consolidated Bitcoin holdings as a single position object.
 * Useful for display components that want to show Bitcoin sleeve metrics.
 *
 * @param holdings Array of all holdings
 * @returns Consolidated Bitcoin holding or null if no Bitcoin holdings
 */
export function getConsolidatedBitcoinPosition(
  holdings: Holding[]
): Holding | null {
  const consolidated = consolidateBitcoinSleeve(holdings)
  return consolidated.find((h) => h.ticker === "BTC") ?? null
}
