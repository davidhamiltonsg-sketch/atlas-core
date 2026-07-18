import { describe, it, expect } from "vitest"
import { sbrRoute, type SbrPosition } from "@/lib/sbr-engine"

function pos(overrides: Partial<SbrPosition> & { ticker: string }): SbrPosition {
  return {
    name: overrides.ticker, color: "#000", value: 0, actualPct: 0, targetPct: 0,
    rangeLow: 0, rangeHigh: 100, hardCap: null, latestPrice: 100, hi52: 100,
    ...overrides,
  }
}

// route() decides where a contribution goes — it must never route toward a fund the
// compliance check (evaluateFundLimits) already calls a breach. Both must agree on the
// same inclusive (>=/<=) boundary, or money could keep flowing into an already-capped fund.
describe("sbrRoute — inclusive hard cap / floor boundary", () => {
  it("routes to hard_cap when a fund sits exactly at its hard cap", () => {
    const positions = [
      pos({ ticker: "SMH", actualPct: 10, hardCap: 10, targetPct: 5, rangeLow: 3.75, rangeHigh: 6.25 }),
      pos({ ticker: "VWRA", actualPct: 90, targetPct: 65, hardCap: 75, rangeLow: 60, rangeHigh: 70 }),
    ]
    const branch = sbrRoute(positions, 100_000)
    expect(branch.tag).toBe("hard_cap")
  })

  it("routes to floor when a fund sits exactly at its floor", () => {
    const positions = [
      pos({ ticker: "BTC", actualPct: 2, floor: 2, hardCap: 8, targetPct: 5, rangeLow: 3.75, rangeHigh: 6.25 }),
      pos({ ticker: "VWRA", actualPct: 68, targetPct: 65, hardCap: 75, rangeLow: 60, rangeHigh: 70 }),
      pos({ ticker: "EQAC", actualPct: 10, targetPct: 10, hardCap: 15, rangeLow: 7.5, rangeHigh: 12.5 }),
      pos({ ticker: "DBMFE", actualPct: 10, targetPct: 10, hardCap: 15, rangeLow: 7.5, rangeHigh: 12.5 }),
    ]
    const branch = sbrRoute(positions, 100_000)
    expect(branch.tag).toBe("floor")
  })
})
