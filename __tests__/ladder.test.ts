import { describe, it, expect } from "vitest"
import { computeLadder, type PositionInput } from "@/lib/ladder"

function pos(overrides: Partial<PositionInput> & { ticker: string; actualPct: number }): PositionInput {
  return {
    name: overrides.ticker, color: "#000", value: overrides.actualPct * 1000,
    targetPct: overrides.actualPct, hardCapPct: null, toleranceBand: 2.5, latestPrice: 100,
    ...overrides,
  }
}

describe("computeLadder — governed alias exclusion from legacy migration", () => {
  it("does not classify EQQQ (EQAC's alias) as a legacy migration item", () => {
    const positions: PositionInput[] = [
      pos({ ticker: "VWRA", actualPct: 70 }),
      pos({ ticker: "EQQQ", actualPct: 10 }), // alternate exchange line of EQAC — governed, not legacy
      pos({ ticker: "SMH", actualPct: 5 }),
      pos({ ticker: "BTC", actualPct: 5 }),
      pos({ ticker: "DBMFE", actualPct: 10 }),
    ]
    const result = computeLadder(positions, 100_000)
    expect(result.steps.find(s => s.label === "Legacy-position migration")?.status).not.toBe("fired")
  })

  it("still flags a genuinely non-governed holding as legacy", () => {
    const positions: PositionInput[] = [
      pos({ ticker: "VWRA", actualPct: 70 }),
      pos({ ticker: "IMID", actualPct: 10 }), // retired legacy mandate ticker, not governed
      pos({ ticker: "SMH", actualPct: 5 }),
      pos({ ticker: "BTC", actualPct: 5 }),
      pos({ ticker: "DBMFE", actualPct: 10 }),
    ]
    const result = computeLadder(positions, 100_000)
    expect(result.steps.find(s => s.label === "Legacy-position migration")?.status).toBe("fired")
  })
})
