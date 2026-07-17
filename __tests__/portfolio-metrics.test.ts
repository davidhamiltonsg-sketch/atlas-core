import { describe, it, expect } from "vitest"
import { maxDrawdown, type TimelinePoint } from "@/lib/portfolio-metrics"

function tl(values: number[]): TimelinePoint[] {
  return values.map((value, i) => ({ date: `2026-01-${String(i + 1).padStart(2, "0")}`, value }))
}

describe("maxDrawdown", () => {
  it("returns null with too few points", () => {
    expect(maxDrawdown(tl([100, 90]))).toBeNull()
  })

  it("is zero for a monotonically rising timeline", () => {
    expect(maxDrawdown(tl([100, 110, 120]))).toBe(0)
  })

  it("finds the largest peak-to-trough decline, not just the first dip", () => {
    // peak 120 -> trough 90 is a 25% drawdown; peak 150 -> trough 140 is smaller
    const result = maxDrawdown(tl([100, 120, 90, 150, 140]))
    expect(result).toBeCloseTo((120 - 90) / 120, 6)
  })

  it("recovers and re-measures from a new peak", () => {
    // 100 -> 50 (50% dd) -> 200 -> 100 (50% dd) — both drawdowns equal, largest is 0.5
    expect(maxDrawdown(tl([100, 50, 200, 100]))).toBeCloseTo(0.5, 6)
  })
})
