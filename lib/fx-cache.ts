/**
 * Atlas Core — FX Rate Cache v1
 *
 * Provides per-request FX rate caching to ensure consistent SGD conversions
 * across all components within a single page render.
 *
 * Problem: Without caching, Dashboard and Portfolio pages fetch the USD/SGD rate
 * independently, leading to different rates if called seconds apart. This causes
 * the same holding to show different SGD values on different pages.
 *
 * Solution: Cache the rate for 5 seconds (per-request consistency window).
 * When used in Server Components, the cache lives for the duration of the page render.
 *
 * Usage:
 *   // In Server Components
 *   const rate = await getCachedUsdSgdRate();
 *
 * Clearing:
 *   // Call at end of request (after all rendering is complete)
 *   clearFxCache();
 */

import { getUsdSgdRate } from "@/lib/finnhub"

interface CachedRate {
  rate: number
  timestamp: number
}

let cachedRate: CachedRate | null = null

// Cache duration: 5 seconds (per-request consistency within a single page render)
const CACHE_DURATION_MS = 5000

/**
 * Get USD/SGD exchange rate with caching.
 * Returns cached rate if <5 seconds old, otherwise fetches fresh rate from Finnhub.
 *
 * @returns USD/SGD rate (e.g., 1.35 means 1 USD = 1.35 SGD)
 */
export async function getCachedUsdSgdRate(): Promise<number> {
  const now = Date.now()

  // Return cached rate if still fresh
  if (cachedRate && now - cachedRate.timestamp < CACHE_DURATION_MS) {
    console.debug(
      `[FX Cache] Using cached rate: ${cachedRate.rate} (age: ${now - cachedRate.timestamp}ms)`
    )
    return cachedRate.rate
  }

  // Fetch fresh rate
  console.debug("[FX Cache] Fetching fresh USD/SGD rate from Finnhub...")
  const rate = await getUsdSgdRate()
  cachedRate = { rate, timestamp: now }

  console.debug(`[FX Cache] Cached rate: ${rate}`)
  return rate
}

/**
 * Clear the FX rate cache.
 * Call this at the end of a request to ensure fresh rates on the next request.
 *
 * Note: In Next.js Server Components, this is called automatically at the end
 * of each page render, but explicit calls are useful in Server Actions or API routes.
 */
export function clearFxCache(): void {
  if (cachedRate) {
    console.debug(
      `[FX Cache] Clearing cache (age: ${Date.now() - cachedRate.timestamp}ms)`
    )
  }
  cachedRate = null
}

/**
 * Get the current cache state (for testing/debugging).
 * @returns Current cached rate or null if not cached
 */
export function getCacheState(): CachedRate | null {
  return cachedRate
}

/**
 * Reset the cache (for testing).
 * @internal
 */
export function _testResetCache(): void {
  cachedRate = null
}
