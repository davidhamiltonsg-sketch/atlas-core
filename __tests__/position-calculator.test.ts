/**
 * Unit tests for position-calculator.ts
 * Tests unified allocation calculation and Bitcoin sleeve consolidation
 */

import { describe, it, expect } from "vitest"
import {
  calculateAllocationPercentages,
  calculateBitcoinSleevePercent,
  getConsolidatedBitcoinPosition,
} from "@/lib/position-calculator"

type TestHolding = {
  ticker: string
  name: string
  value: number
  units?: number
  price?: number
  color?: string
}

describe("position-calculator", () => {
  describe("calculateAllocationPercentages", () => {
    it("should calculate percentages correctly for simple holdings", () => {
      // A portfolio exactly on the Atlas v10.5 targets (lib/portfolio-spec.ts):
      // VWRA 70%, EQAC 10%, SMH 5%, BTC 5%, DBMFE 10%
      const holdings: TestHolding[] = [
        { ticker: "VWRA", name: "VWRA", value: 7000 },
        { ticker: "EQAC", name: "EQAC", value: 1000 },
        { ticker: "SMH", name: "SMH", value: 500 },
        { ticker: "BTC", name: "Bitcoin", value: 500 },
        { ticker: "DBMFE", name: "DBMFE", value: 1000 },
      ]

      const allocations = calculateAllocationPercentages(holdings)

      expect(allocations.get("VWRA")).toBeCloseTo(70, 1)
      expect(allocations.get("EQAC")).toBeCloseTo(10, 1)
      expect(allocations.get("SMH")).toBeCloseTo(5, 1)
      expect(allocations.get("BTC")).toBeCloseTo(5, 1)
      expect(allocations.get("DBMFE")).toBeCloseTo(10, 1)
    })

    it("should consolidate Bitcoin holdings (BTC + IBIT)", () => {
      const holdings: TestHolding[] = [
        { ticker: "BTC", name: "Bitcoin", value: 500 },
        { ticker: "IBIT", name: "iShares Bitcoin ETF", value: 200 },
        { ticker: "VWRA", name: "VWRA", value: 9300 },
      ]

      const allocations = calculateAllocationPercentages(holdings)

      // BTC + IBIT = 700 / 10000 = 7%
      expect(allocations.get("BTC")).toBeCloseTo(7, 1)
      expect(allocations.get("VWRA")).toBeCloseTo(93, 1)
      // IBIT should not appear in consolidated allocations
      expect(allocations.has("IBIT")).toBe(false)
    })

    it("should consolidate Bitcoin holdings (BTC + IBIT + GBTC)", () => {
      const holdings: TestHolding[] = [
        { ticker: "BTC", name: "Bitcoin", value: 300 },
        { ticker: "IBIT", name: "iShares Bitcoin ETF", value: 200 },
        { ticker: "GBTC", name: "Grayscale Bitcoin", value: 100 },
        { ticker: "VWRA", name: "VWRA", value: 9400 },
      ]

      const allocations = calculateAllocationPercentages(holdings)

      // BTC + IBIT + GBTC = 600 / 10000 = 6%
      expect(allocations.get("BTC")).toBeCloseTo(6, 1)
      expect(allocations.get("VWRA")).toBeCloseTo(94, 1)
      // Individual Bitcoin holdings should not appear
      expect(allocations.has("IBIT")).toBe(false)
      expect(allocations.has("GBTC")).toBe(false)
    })

    it("should handle empty holdings", () => {
      const holdings: TestHolding[] = []
      const allocations = calculateAllocationPercentages(holdings)
      expect(allocations.size).toBe(0)
    })

    it("should handle zero-value holdings", () => {
      const holdings: TestHolding[] = [
        { ticker: "VWRA", name: "VWRA", value: 10000 },
        { ticker: "EQAC", name: "EQAC", value: 0 },
        { ticker: "SMH", name: "SMH", value: 0 },
      ]

      const allocations = calculateAllocationPercentages(holdings)

      expect(allocations.get("VWRA")).toBeCloseTo(100, 1)
      expect(allocations.get("EQAC")).toBeCloseTo(0, 1)
      expect(allocations.get("SMH")).toBeCloseTo(0, 1)
    })
  })

  describe("calculateBitcoinSleevePercent", () => {
    it("should return 0 when no Bitcoin holdings exist", () => {
      const holdings: TestHolding[] = [
        { ticker: "VWRA", name: "VWRA", value: 10000 },
      ]

      const btcPct = calculateBitcoinSleevePercent(holdings)
      expect(btcPct).toBe(0)
    })

    it("should calculate Bitcoin sleeve percentage correctly", () => {
      const holdings: TestHolding[] = [
        { ticker: "BTC", name: "Bitcoin", value: 500 },
        { ticker: "IBIT", name: "iShares Bitcoin ETF", value: 200 },
        { ticker: "VWRA", name: "VWRA", value: 9300 },
      ]

      const btcPct = calculateBitcoinSleevePercent(holdings)
      expect(btcPct).toBeCloseTo(7, 1)
    })

    it("should handle single Bitcoin holding", () => {
      const holdings: TestHolding[] = [
        { ticker: "BTC", name: "Bitcoin", value: 700 },
        { ticker: "VWRA", name: "VWRA", value: 9300 },
      ]

      const btcPct = calculateBitcoinSleevePercent(holdings)
      expect(btcPct).toBeCloseTo(7, 1)
    })

    it("should handle empty holdings", () => {
      const holdings: TestHolding[] = []
      const btcPct = calculateBitcoinSleevePercent(holdings)
      expect(btcPct).toBe(0)
    })
  })

  describe("getConsolidatedBitcoinPosition", () => {
    it("should return null when no Bitcoin holdings exist", () => {
      const holdings: TestHolding[] = [
        { ticker: "VWRA", name: "VWRA", value: 10000 },
      ]

      const btcPos = getConsolidatedBitcoinPosition(holdings)
      expect(btcPos).toBeNull()
    })

    it("should return consolidated Bitcoin position", () => {
      const holdings: TestHolding[] = [
        { ticker: "BTC", name: "Bitcoin", value: 500, color: "#F7931A" },
        { ticker: "IBIT", name: "iShares Bitcoin ETF", value: 200 },
        { ticker: "VWRA", name: "VWRA", value: 9300 },
      ]

      const btcPos = getConsolidatedBitcoinPosition(holdings)
      expect(btcPos).not.toBeNull()
      expect(btcPos?.ticker).toBe("BTC")
      expect(btcPos?.value).toBe(700)
      expect(btcPos?.name).toContain("Bitcoin sleeve")
      expect(btcPos?.name).toContain("BTC")
      expect(btcPos?.name).toContain("IBIT")
    })

    it("should include all Bitcoin tickers in consolidated name", () => {
      const holdings: TestHolding[] = [
        { ticker: "BTC", name: "Bitcoin", value: 300, color: "#F7931A" },
        { ticker: "IBIT", name: "iShares Bitcoin ETF", value: 200 },
        { ticker: "GBTC", name: "Grayscale Bitcoin", value: 100 },
        { ticker: "VWRA", name: "VWRA", value: 9400 },
      ]

      const btcPos = getConsolidatedBitcoinPosition(holdings)
      expect(btcPos?.value).toBe(600)
      expect(btcPos?.name).toContain("BTC")
      expect(btcPos?.name).toContain("IBIT")
      expect(btcPos?.name).toContain("GBTC")
    })
  })

  describe("Consistency across functions", () => {
    it("should ensure allocations sum to 100%", () => {
      const holdings: TestHolding[] = [
        { ticker: "BTC", name: "Bitcoin", value: 500 },
        { ticker: "IBIT", name: "iShares Bitcoin ETF", value: 200 },
        { ticker: "VWRA", name: "VWRA", value: 5000 },
        { ticker: "EQAC", name: "EQAC", value: 2000 },
        { ticker: "SMH", name: "SMH", value: 1000 },
        { ticker: "DBMFE", name: "DBMFE", value: 1300 },
      ]

      const allocations = calculateAllocationPercentages(holdings)
      const sum = Array.from(allocations.values()).reduce((s, pct) => s + pct, 0)
      expect(sum).toBeCloseTo(100, 1)
    })

    it("calculateBitcoinSleevePercent should match consolidated position value", () => {
      const holdings: TestHolding[] = [
        { ticker: "BTC", name: "Bitcoin", value: 500, color: "#F7931A" },
        { ticker: "IBIT", name: "iShares Bitcoin ETF", value: 200 },
        { ticker: "VWRA", name: "VWRA", value: 9300 },
      ]

      const btcPct = calculateBitcoinSleevePercent(holdings)
      const btcPos = getConsolidatedBitcoinPosition(holdings)
      const totalValue = holdings.reduce((sum, h) => sum + h.value, 0)

      if (btcPos) {
        const positionPct = (btcPos.value / totalValue) * 100
        expect(btcPct).toBeCloseTo(positionPct, 1)
      }
    })
  })
})
