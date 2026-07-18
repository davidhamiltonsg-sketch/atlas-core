import { describe, it, expect } from "vitest"
import { openPositionValuation, COST_BASIS_STALE_DAYS } from "@/lib/valuation"

describe("openPositionValuation — cost-basis staleness", () => {
  const now = new Date("2026-07-18T00:00:00Z")

  it("is not stale when confirmed recently", () => {
    const asOf = new Date(now.getTime() - 5 * 86_400_000)
    const v = openPositionValuation({ value: 1000, units: 10, snapshotCostBasis: 800, snapshotUnrealizedPnl: 200, reportingFxRate: 1, costBasisAsOf: asOf, now })
    expect(v.costBasisStale).toBe(false)
  })

  it(`is stale past ${COST_BASIS_STALE_DAYS} days since last IBKR confirmation`, () => {
    const asOf = new Date(now.getTime() - (COST_BASIS_STALE_DAYS + 5) * 86_400_000)
    const v = openPositionValuation({ value: 1000, units: 10, snapshotCostBasis: 800, snapshotUnrealizedPnl: 200, reportingFxRate: 1, costBasisAsOf: asOf, now })
    expect(v.costBasisStale).toBe(true)
  })

  it("is never stale for a reconstructed (non-IBKR) cost basis — staleness only applies to authoritative sources", () => {
    const asOf = new Date(now.getTime() - (COST_BASIS_STALE_DAYS + 5) * 86_400_000)
    const v = openPositionValuation({ value: 1000, units: 10, reconstructedCostBasis: 800, reportingFxRate: 1, costBasisAsOf: asOf, now })
    expect(v.source).toBe("reconstructed")
    expect(v.costBasisStale).toBe(false)
  })

  it("is not stale when no as-of date has ever been recorded", () => {
    const v = openPositionValuation({ value: 1000, units: 10, snapshotCostBasis: 800, snapshotUnrealizedPnl: 200, reportingFxRate: 1, now })
    expect(v.costBasisStale).toBe(false)
  })
})
