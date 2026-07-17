import { describe, it, expect } from "vitest"
import { projectPortfolio } from "@/lib/forecast"

describe("projectPortfolio — annual lump sum timing", () => {
  it("credits the first year's lump sum with a full year of growth", () => {
    // No monthly contribution or current value isolates the lump sum's own compounding.
    const withGrowth = projectPortfolio(0, 0, 20_000, 0.10, 1, 0)
    // A lump sum invested at the start of year 0 and compounded monthly for 12 months
    // at a 10% annual rate should end up meaningfully above the raw 20,000 contributed —
    // previously it earned exactly 0% (added after the loop, giving it 0 months of growth).
    expect(withGrowth).toBeGreaterThan(20_000 * 1.05)
  })

  it("every lump sum compounds, including the last one, over a multi-year horizon", () => {
    const oneYear = projectPortfolio(0, 0, 20_000, 0.10, 1, 0)
    const twoYear = projectPortfolio(0, 0, 20_000, 0.10, 2, 0)
    // Year 2 must reflect year 1's lump sum having compounded for a further year, on top
    // of year 2's own lump sum earning its own full year — not just "add 20k again".
    expect(twoYear).toBeGreaterThan(oneYear * 2)
  })
})
