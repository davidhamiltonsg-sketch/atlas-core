import { describe, it, expect } from "vitest"
import { FUND_SECTOR_WEIGHTS, FUND_COMPANY_WEIGHTS } from "@/lib/fund-weights"
import { ETF_SECTOR_WEIGHTS, computeLookThrough } from "@/lib/look-through"
import { computeSbrLookThrough } from "@/lib/sbr-look-through"

describe("fund-weights — single source of truth", () => {
  it("VWRA's technology weight is the sourced 35.1%, not either of the two hand-copied numbers that previously drifted apart (37 Atlas / 27 SBR)", () => {
    expect(FUND_SECTOR_WEIGHTS.VWRA.digital).toBe(35.1)
  })

  it("Atlas's look-through engine reads the canonical table (no local copy to drift)", () => {
    expect(ETF_SECTOR_WEIGHTS.VWRA.digital).toBe(35.1)
  })

  it("Atlas and SBR compute the same VWRA-only technology exposure from the same weight", () => {
    const atlas = computeLookThrough([{ ticker: "VWRA", actualPct: 100 }])
    const sbr = computeSbrLookThrough([{ ticker: "VWRA", actualPct: 100 }])
    const atlasDigital = atlas.sectors.find((s) => s.key === "digital")!.pct
    expect(atlasDigital).toBeCloseTo(35.1, 5)
    expect(sbr.technologyPct).toBeCloseTo(35.1, 5)
    expect(sbr.technologyPct).toBeCloseTo(atlasDigital, 5)
  })

  it("SMH's company table includes ASML/AMD (SBR's original superset), harmless for Atlas which only caps its own 8 mega-caps", () => {
    expect(FUND_COMPANY_WEIGHTS.SMH.ASML).toBe(7.0)
    expect(FUND_COMPANY_WEIGHTS.SMH.AMD).toBe(5.6)
  })
})
