import { describe, it, expect } from "vitest"
import { evaluateSbrGovernance } from "@/lib/sbr-governance"
import { computeSbrLookThrough } from "@/lib/sbr-look-through"
import type { SbrPosition } from "@/lib/sbr-engine"

// SBR's combined EQAC+SMH hard cap is 25% (lib/portfolio-spec.ts SBR_SPEC.combined.hard).
// If IBKR reports the same economic position under EQAC's alternate exchange line (EQQQ),
// a hard-cap check that keys purely off literal ticker "EQAC" would miss it entirely and
// read the sleeve as compliant while the real combined exposure is over cap.
function pos(overrides: Partial<SbrPosition> & { ticker: string; actualPct: number }): SbrPosition {
  return {
    name: overrides.ticker, color: "#000", value: overrides.actualPct * 1000,
    targetPct: 0, rangeLow: 0, rangeHigh: 100, hardCap: null, latestPrice: 100, hi52: 100,
    ...overrides,
  }
}

describe("SBR alias consolidation — governance", () => {
  it("rolls an EQQQ line into the EQAC sleeve for the combined-satellite hard cap", () => {
    const positions = [
      pos({ ticker: "EQQQ", actualPct: 12 }), // alias for EQAC — reported under its alternate exchange line
      pos({ ticker: "EQAC", actualPct: 15 }), // combined 27% > 25% hard cap
      pos({ ticker: "VWRA", actualPct: 73 }),
    ]
    const result = evaluateSbrGovernance(positions, 100_000)
    const satellites = result.checks.find((c) => c.id === "satellites")
    expect(satellites?.status).toBe("breach")
  })

  it("stays ok when the consolidated sleeve is genuinely under cap", () => {
    const positions = [
      pos({ ticker: "EQAC", actualPct: 10 }),
      pos({ ticker: "VWRA", actualPct: 90 }),
    ]
    const result = evaluateSbrGovernance(positions, 100_000)
    const satellites = result.checks.find((c) => c.id === "satellites")
    expect(satellites?.status).toBe("ok")
  })
})

describe("SBR alias consolidation — look-through", () => {
  it("attributes an EQQQ line's semiconductor/company exposure through the EQAC coefficients", () => {
    const aliased = computeSbrLookThrough([{ ticker: "EQQQ", actualPct: 20 }, { ticker: "VWRA", actualPct: 80 }])
    const direct = computeSbrLookThrough([{ ticker: "EQAC", actualPct: 20 }, { ticker: "VWRA", actualPct: 80 }])
    expect(aliased.technologyPct).toBeCloseTo(direct.technologyPct, 5)
    expect(aliased.unclassifiedPct).toBe(0)
  })
})
