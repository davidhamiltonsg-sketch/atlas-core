/**
 * Atlas Core — USD/SGD FX rate: single fetcher + cross-page cache.
 *
 * This is THE one place the app fetches the USD→SGD rate (Yahoo Finance,
 * query1 → query2 fallback, hardcoded 1.35 fallback when both are down).
 *
 * Problem the cache solves: without it, Dashboard and Portfolio pages fetch the
 * rate independently, leading to different rates if called seconds apart — the
 * same holding then shows different SGD values on different pages. The rate is
 * cached for 5 minutes, so normal browsing (dashboard → portfolio → back) shows
 * a consistent SGD figure instead of a value that jumps on every navigation.
 *
 * Usage (Server Components, Server Actions, cron sync):
 *   const rate = await getCachedUsdSgdRate()
 *
 * Do NOT call clearFxCache() at the end of a page render — that forces a fresh
 * network fetch on every subsequent page load and defeats the cross-page
 * consistency this module exists for. Reserve it for callers that genuinely
 * need a guaranteed-fresh rate regardless of cache age (e.g. an explicit
 * "refresh now" action).
 */

const YF_HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]
const FALLBACK_RATE = 1.35

/** Fetch the live USD→SGD rate (uncached). Prefer getCachedUsdSgdRate(). */
export async function getUsdSgdRate(): Promise<number> {
  for (const host of YF_HOSTS) {
    try {
      const res = await fetch(
        `https://${host}/v8/finance/chart/USDSGD=X?interval=1d&range=1d`,
        { headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store" }
      )
      if (res.ok) {
        const d = await res.json()
        const rate = d?.chart?.result?.[0]?.meta?.regularMarketPrice
        if (rate && rate > 0) return rate
      }
    } catch {}
  }
  return FALLBACK_RATE
}

interface CachedRate {
  rate: number
  timestamp: number
}

let cachedRate: CachedRate | null = null
let pendingFetch: Promise<number> | null = null

// Cache duration: 5 minutes — long enough that ordinary navigation between pages shows a
// consistent rate, short enough that a genuinely stale rate self-heals without intervention.
const CACHE_DURATION_MS = 5 * 60 * 1000

/**
 * Get the USD/SGD exchange rate with caching.
 * Returns the cached rate if <5 seconds old, otherwise fetches a fresh rate.
 * Concurrent callers share a single in-flight fetch, so components rendered in
 * parallel within one page always see the same rate from one network call.
 *
 * @returns USD/SGD rate (e.g., 1.35 means 1 USD = 1.35 SGD)
 */
export async function getCachedUsdSgdRate(): Promise<number> {
  const now = Date.now()
  if (cachedRate && now - cachedRate.timestamp < CACHE_DURATION_MS) {
    return cachedRate.rate
  }
  if (pendingFetch) return pendingFetch
  pendingFetch = (async () => {
    try {
      const rate = await getUsdSgdRate()
      cachedRate = { rate, timestamp: Date.now() }
      return rate
    } finally {
      pendingFetch = null
    }
  })()
  return pendingFetch
}

/**
 * Clear the FX rate cache.
 * Call this at the end of a request to ensure fresh rates on the next request.
 */
export function clearFxCache(): void {
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
  pendingFetch = null
}
