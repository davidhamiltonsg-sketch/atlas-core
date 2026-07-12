/**
 * Unit tests for fx-cache.ts
 * Tests FX rate caching and TTL behavior
 */

import {
  getCachedUsdSgdRate,
  clearFxCache,
  getCacheState,
  _testResetCache,
} from "@/lib/fx-cache"

// Mock for getUsdSgdRate from finnhub
let mockFxRateValue = 1.35
let mockFxRateCallCount = 0

jest.mock("@/lib/finnhub", () => ({
  getUsdSgdRate: jest.fn(async () => {
    mockFxRateCallCount++
    return mockFxRateValue
  }),
}))

describe("fx-cache", () => {
  beforeEach(() => {
    _testResetCache()
    mockFxRateCallCount = 0
    mockFxRateValue = 1.35
  })

  describe("getCachedUsdSgdRate", () => {
    it("should fetch rate on first call", async () => {
      mockFxRateValue = 1.35
      const rate = await getCachedUsdSgdRate()

      expect(rate).toBe(1.35)
      expect(mockFxRateCallCount).toBe(1)
    })

    it("should cache rate for subsequent calls within TTL", async () => {
      mockFxRateValue = 1.35
      const rate1 = await getCachedUsdSgdRate()

      // Change the mock value to simulate market movement
      mockFxRateValue = 1.36

      // But the cache should still return the old value
      const rate2 = await getCachedUsdSgdRate()

      expect(rate1).toBe(1.35)
      expect(rate2).toBe(1.35) // Same as rate1, not 1.36
      expect(mockFxRateCallCount).toBe(1) // Only called once
    })

    it("should invalidate cache after clearFxCache()", async () => {
      mockFxRateValue = 1.35
      const rate1 = await getCachedUsdSgdRate()

      clearFxCache()

      mockFxRateValue = 1.36
      const rate2 = await getCachedUsdSgdRate()

      expect(rate1).toBe(1.35)
      expect(rate2).toBe(1.36) // New value after cache clear
      expect(mockFxRateCallCount).toBe(2)
    })

    it("should handle multiple rapid calls efficiently", async () => {
      mockFxRateValue = 1.35
      const rates = await Promise.all([
        getCachedUsdSgdRate(),
        getCachedUsdSgdRate(),
        getCachedUsdSgdRate(),
        getCachedUsdSgdRate(),
        getCachedUsdSgdRate(),
      ])

      // All should be 1.35
      rates.forEach((rate) => expect(rate).toBe(1.35))
      // But only fetched once due to caching
      expect(mockFxRateCallCount).toBe(1)
    })
  })

  describe("clearFxCache", () => {
    it("should clear the cache", async () => {
      mockFxRateValue = 1.35
      await getCachedUsdSgdRate()

      const cacheState1 = getCacheState()
      expect(cacheState1).not.toBeNull()

      clearFxCache()

      const cacheState2 = getCacheState()
      expect(cacheState2).toBeNull()
    })

    it("should allow fresh fetch after clear", async () => {
      mockFxRateValue = 1.35
      const rate1 = await getCachedUsdSgdRate()

      clearFxCache()
      mockFxRateValue = 1.37

      const rate2 = await getCachedUsdSgdRate()

      expect(rate1).toBe(1.35)
      expect(rate2).toBe(1.37)
      expect(mockFxRateCallCount).toBe(2)
    })
  })

  describe("getCacheState", () => {
    it("should return null when cache is empty", () => {
      const state = getCacheState()
      expect(state).toBeNull()
    })

    it("should return cache state after fetch", async () => {
      mockFxRateValue = 1.35
      await getCachedUsdSgdRate()

      const state = getCacheState()
      expect(state).not.toBeNull()
      expect(state?.rate).toBe(1.35)
      expect(typeof state?.timestamp).toBe("number")
    })
  })

  describe("Integration with Server Components", () => {
    it("should maintain consistent rate across component renders", async () => {
      mockFxRateValue = 1.35

      // Simulate two components fetching FX rate in parallel
      const [rate1, rate2] = await Promise.all([
        getCachedUsdSgdRate(),
        getCachedUsdSgdRate(),
      ])

      expect(rate1).toBe(rate2)
      expect(mockFxRateCallCount).toBe(1) // Fetched only once
    })

    it("should support page-render pattern with cache clear", async () => {
      mockFxRateValue = 1.35

      // Simulate page render with multiple components
      const rates = await Promise.all([
        getCachedUsdSgdRate(),
        getCachedUsdSgdRate(),
        getCachedUsdSgdRate(),
      ])

      // All rates should be consistent
      expect(rates.every((r) => r === rates[0])).toBe(true)

      // Clear at end of render
      clearFxCache()

      // Next page render starts fresh
      mockFxRateValue = 1.36
      const freshRate = await getCachedUsdSgdRate()
      expect(freshRate).toBe(1.36)
    })
  })

  describe("Edge cases", () => {
    it("should handle fallback rate from Finnhub", async () => {
      mockFxRateValue = 1.35
      const rate = await getCachedUsdSgdRate()

      expect(rate).toBeGreaterThan(1.0)
      expect(rate).toBeLessThan(2.0)
    })

    it("should not interfere with other calls", async () => {
      mockFxRateValue = 1.35

      const rate1 = await getCachedUsdSgdRate()
      // Cache is still active

      // Clear for next request
      clearFxCache()

      mockFxRateValue = 1.40
      const rate2 = await getCachedUsdSgdRate()

      expect(rate1).not.toBe(rate2)
    })
  })

  describe("Consistency guarantees", () => {
    it("should guarantee same rate for all renders within page load", async () => {
      mockFxRateValue = 1.35

      // Simulate page components calling FX rate in order
      const dashboardRate = await getCachedUsdSgdRate()
      const portfolioRate = await getCachedUsdSgdRate()
      const reportsRate = await getCachedUsdSgdRate()

      expect(dashboardRate).toBe(portfolioRate)
      expect(portfolioRate).toBe(reportsRate)
      expect(mockFxRateCallCount).toBe(1)
    })

    it("should fetch fresh rate between page renders", async () => {
      // First page render
      mockFxRateValue = 1.35
      const rate1 = await getCachedUsdSgdRate()
      clearFxCache()

      // Second page render (user navigates away and back)
      mockFxRateValue = 1.40
      const rate2 = await getCachedUsdSgdRate()
      clearFxCache()

      // Third page render
      mockFxRateValue = 1.42
      const rate3 = await getCachedUsdSgdRate()

      expect(rate1).toBe(1.35)
      expect(rate2).toBe(1.40)
      expect(rate3).toBe(1.42)
      expect(mockFxRateCallCount).toBe(3)
    })
  })
})

// Mock jest if not available
if (typeof jest === "undefined") {
  global.jest = {
    fn: (implementation?: any) => {
      const mockFn = implementation || (() => {})
      return mockFn as any
    },
    mock: () => {},
  } as any
}
