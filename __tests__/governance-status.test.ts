import { describe, it, expect } from "vitest"
import { evaluateGovernance } from "@/lib/governance-status"
import type { LookThroughResult } from "@/lib/look-through"

const EMPTY_LT: LookThroughResult = {
  companies: [], sectors: [], geographies: [], assets: [],
  unclassifiedPct: 0, managedFuturesPct: 0, cryptoPct: 0,
  ageDays: 0, freshness: "fresh", stale: false, estimated: true,
  hardSignalsActionable: true, warnings: [],
}

function positions(overrides: Partial<Record<string, number>>) {
  const base = { VWRA: 70, EQAC: 10, SMH: 5, BTC: 5, DBMFE: 10 }
  const merged = { ...base, ...overrides }
  return Object.entries(merged).map(([ticker, actualPct]) => ({ ticker, actualPct, targetPct: base[ticker as keyof typeof base] }))
}

describe("evaluateGovernance — hard-cap boundary", () => {
  it("treats a sleeve sitting exactly on its hard cap as a breach, not a pass", () => {
    // SMH hard cap is 10 (see lib/constants.ts HARD_THRESHOLDS.SMH)
    const result = evaluateGovernance({ positions: positions({ SMH: 10, VWRA: 65 }), bufferPct: 0, lookThrough: EMPTY_LT })
    const drift = result.checks.find(c => c.id === "drift")
    expect(drift?.status).toBe("breach")
  })

  it("still passes comfortably inside the cap", () => {
    const result = evaluateGovernance({ positions: positions({}), bufferPct: 0, lookThrough: EMPTY_LT })
    const drift = result.checks.find(c => c.id === "drift")
    expect(drift?.status).toBe("ok")
  })
})

describe("evaluateGovernance — Bitcoin sleeve threshold", () => {
  it("breaches exactly at the 8% hard cap", () => {
    const result = evaluateGovernance({ positions: positions({ BTC: 8, VWRA: 67 }), bufferPct: 0, lookThrough: EMPTY_LT })
    expect(result.checks.find(c => c.id === "bitcoin")?.status).toBe("breach")
  })

  it("watches between target+band (6.25%) and the hard cap", () => {
    const result = evaluateGovernance({ positions: positions({ BTC: 7, VWRA: 68 }), bufferPct: 0, lookThrough: EMPTY_LT })
    expect(result.checks.find(c => c.id === "bitcoin")?.status).toBe("watch")
  })

  it("is ok within the healthy band", () => {
    const result = evaluateGovernance({ positions: positions({}), bufferPct: 0, lookThrough: EMPTY_LT })
    expect(result.checks.find(c => c.id === "bitcoin")?.status).toBe("ok")
  })
})

describe("evaluateGovernance — estate-tax two-tier trigger", () => {
  it("is ok below the warn threshold", () => {
    const result = evaluateGovernance({ positions: positions({}), bufferPct: 0, lookThrough: EMPTY_LT, usSitedValueUsd: 10_000 })
    expect(result.checks.find(c => c.id === "estate")?.status).toBe("ok")
  })

  it("has no estate check at all when there is no US-sited exposure", () => {
    const result = evaluateGovernance({ positions: positions({}), bufferPct: 0, lookThrough: EMPTY_LT, usSitedValueUsd: 0 })
    expect(result.checks.find(c => c.id === "estate")).toBeUndefined()
  })

  it("watches between the warn (60k) and mandatory-review (100k) thresholds", () => {
    const result = evaluateGovernance({ positions: positions({}), bufferPct: 0, lookThrough: EMPTY_LT, usSitedValueUsd: 75_000 })
    expect(result.checks.find(c => c.id === "estate")?.status).toBe("watch")
  })

  it("escalates to breach at the mandatory-review threshold (100k)", () => {
    const result = evaluateGovernance({ positions: positions({}), bufferPct: 0, lookThrough: EMPTY_LT, usSitedValueUsd: 100_000 })
    expect(result.checks.find(c => c.id === "estate")?.status).toBe("breach")
  })
})
