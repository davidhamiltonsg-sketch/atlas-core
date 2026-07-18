import { describe, it, expect } from "vitest"
import { evaluateFundLimits, evaluateCombinedSleeve, sleeveActuals } from "@/lib/governance-engine"
import type { ConstitutionFund, Constitution } from "@/lib/constitutions"

const FUNDS: ConstitutionFund[] = [
  { ticker: "VWRA", name: "VWRA", role: "", target: 70, rangeLow: 65, rangeHigh: 75, hardCap: 80, color: "#000" },
  { ticker: "EQAC", name: "EQAC", role: "", target: 10, rangeLow: 7.5, rangeHigh: 12.5, hardCap: 15, floor: 5, color: "#000" },
  { ticker: "SMH", name: "SMH", role: "", target: 5, rangeLow: 3.75, rangeHigh: 6.25, hardCap: 10, floor: 2, color: "#000" },
  { ticker: "BTC", name: "BTC", role: "", target: 5, rangeLow: 3.75, rangeHigh: 6.25, hardCap: 8, floor: 2, color: "#000" },
  { ticker: "DBMFE", name: "DBMFE", role: "", target: 10, rangeLow: 7.5, rangeHigh: 12.5, hardCap: 15, floor: 5, color: "#000" },
]

function pos(overrides: Record<string, number>) {
  const base = { VWRA: 70, EQAC: 10, SMH: 5, BTC: 5, DBMFE: 10 }
  return Object.entries({ ...base, ...overrides }).map(([ticker, actualPct]) => ({ ticker, actualPct }))
}

describe("evaluateFundLimits — boundary inclusivity", () => {
  it("treats a sleeve sitting exactly on its hard cap as a breach", () => {
    const result = evaluateFundLimits(FUNDS, pos({ SMH: 10, VWRA: 65 }))
    expect(result.status).toBe("breach")
  })
  it("treats a sleeve sitting exactly on its floor as a breach", () => {
    const result = evaluateFundLimits(FUNDS, pos({ SMH: 2, VWRA: 73 }))
    expect(result.status).toBe("breach")
  })
  it("passes comfortably inside the band", () => {
    const result = evaluateFundLimits(FUNDS, pos({}))
    expect(result.status).toBe("ok")
  })
  it("watches a fund outside its soft band but inside hard limits", () => {
    const result = evaluateFundLimits(FUNDS, pos({ EQAC: 13, VWRA: 67 }))
    expect(result.status).toBe("watch")
  })
})

describe("evaluateFundLimits — unheld floor fund", () => {
  it("flags a floor breach for a governed fund entirely absent from positions", () => {
    // BTC sold to zero (or never bought) — the fund isn't in the positions array at all,
    // not merely at 0%. The engine iterates constitution.funds, not the positions array,
    // so this is caught; a position-keyed loop would silently skip it.
    const positions = [
      { ticker: "VWRA", actualPct: 75 },
      { ticker: "EQAC", actualPct: 10 },
      { ticker: "SMH", actualPct: 5 },
      { ticker: "DBMFE", actualPct: 10 },
    ]
    const result = evaluateFundLimits(FUNDS, positions)
    expect(result.status).toBe("breach")
    expect(result.detail).toContain("BTC")
  })
})

describe("evaluateFundLimits — alias consolidation", () => {
  it("rolls EQQQ (EQAC's alternate exchange line) into the EQAC sleeve", () => {
    const positions = [
      { ticker: "EQQQ", actualPct: 8 },
      { ticker: "EQAC", actualPct: 7 }, // combined 15% == hard cap
      { ticker: "VWRA", actualPct: 65 },
      { ticker: "SMH", actualPct: 5 },
      { ticker: "BTC", actualPct: 5 },
      { ticker: "DBMFE", actualPct: 10 },
    ]
    const result = evaluateFundLimits(FUNDS, positions)
    expect(result.status).toBe("breach")
  })
})

describe("evaluateCombinedSleeve", () => {
  const combined: NonNullable<Constitution["combined"]> = { tickers: ["EQAC", "SMH"], warning: 18.75, hard: 25, resume: 18.75, label: "Combined EQAC + SMH ceiling" }
  it("breaches exactly at the hard ceiling", () => {
    const result = evaluateCombinedSleeve(combined, pos({ EQAC: 20, SMH: 5, VWRA: 65 }))
    expect(result.status).toBe("breach")
  })
  it("watches between warning and hard", () => {
    const result = evaluateCombinedSleeve(combined, pos({ EQAC: 15, SMH: 5, VWRA: 70 }))
    expect(result.status).toBe("watch")
  })
  it("ok comfortably under warning", () => {
    const result = evaluateCombinedSleeve(combined, pos({}))
    expect(result.status).toBe("ok")
  })
})

describe("sleeveActuals", () => {
  it("sums IBIT into BTC and SMH.L into SMH", () => {
    const m = sleeveActuals([{ ticker: "IBIT", actualPct: 3 }, { ticker: "BTC", actualPct: 2 }, { ticker: "SMH.L", actualPct: 5 }])
    expect(m.get("BTC")).toBeCloseTo(5, 5)
    expect(m.get("SMH")).toBeCloseTo(5, 5)
  })
})
