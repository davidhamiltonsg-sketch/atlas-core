import { effectiveMonthlyRate, projectPortfolio, yearsToHorizon } from "../lib/forecast"
import { upcomingVests } from "../lib/external-award-math"
import { sbrBlendedGrowthRate } from "../lib/sbr-forecast"
import { SBR_SPEC } from "../lib/portfolio-spec"
import { computeSbrHealth, type SbrPosition } from "../lib/sbr-engine"
import { evaluateSbrGovernance } from "../lib/sbr-governance"

let failures = 0
function near(label: string, actual: number, expected: number, epsilon = 1e-8) {
  if (Math.abs(actual - expected) > epsilon) { console.error(`FAIL ${label}: ${actual} != ${expected}`); failures++ }
}
function ok(label: string, value: boolean) { if (!value) { console.error(`FAIL ${label}`); failures++ } }

near("12 monthly periods equal the effective annual rate", Math.pow(1 + effectiveMonthlyRate(.12), 12), 1.12)
near("one-year lump sum compounds effectively", projectPortfolio(100, 0, 0, .12, 1, 0), 112)
near("horizon uses current year", yearsToHorizon(2045, 2026), 19)
near("past horizon clamps to zero", yearsToHorizon(2045, 2046), 0)

// Outside-Atlas RSU vests as planned contributions: an inflow strictly raises the
// projection, an empty schedule is exactly the old maths, and a vest scheduled
// beyond the horizon must not count (the money hasn't arrived inside the window).
const noVests = projectPortfolio(100, 0, 0, .12, 2, 0)
const withVest = projectPortfolio(100, 0, 0, .12, 2, 0, [{ monthsFromNow: 6, amount: 50 }])
ok("a scheduled vest strictly raises the projection", withVest > noVests + 50)
near("an empty vest schedule changes nothing", projectPortfolio(100, 0, 0, .12, 2, 0, []), noVests)
near("a vest beyond the horizon is ignored", projectPortfolio(100, 0, 0, .12, 2, 0, [{ monthsFromNow: 36, amount: 50 }]), noVests)

// upcomingVests: past tranches drop out, the tax drag applies, ordering is by date.
const award = { ticker: "BK", label: "t", taxRatePct: 30, asOf: "2026-07-16", tranches: [
  { date: "2025-02-15", units: 10 }, { date: "2028-02-15", units: 57 }, { date: "2027-02-15", units: 57 },
] }
const vests = upcomingVests(award, 100, new Date("2026-07-16T00:00:00Z"))
ok("past tranches are excluded", vests.length === 2)
ok("vests are ordered by date", vests[0].date < vests[1].date)
near("tax drag applies at vest", vests[0].afterTaxUsd, 57 * 100 * 0.7)

const emptyRates = sbrBlendedGrowthRate({})
const targetBase = SBR_SPEC.funds.reduce((s, f) => s + f.target / 100 * (f.expectedReturn?.base ?? 0), 0)
near("empty SBR uses canonical target blend", emptyRates.base, targetBase)

const positions: SbrPosition[] = SBR_SPEC.funds.map(f => ({
  ticker:f.ticker,name:f.ticker,color:"#000",value:f.target,actualPct:f.target,targetPct:f.target,
  rangeLow:f.rangeLow,rangeHigh:f.rangeHigh,hardCap:f.hardCap,floor:f.floor,latestPrice:1,hi52:1,
}))
const unverified = computeSbrHealth(positions, 100, 0)
const verified = computeSbrHealth(positions, 100, 0, undefined, true)
near("managed futures earns no liquidity credit", unverified.liquidity, 0)
near("external reserve verification earns liquidity credit", verified.liquidity, 100)

const now = new Date("2026-07-12T00:00:00Z")
const stale = evaluateSbrGovernance(positions, 100, new Date("2026-04-01T00:00:00Z"), now)
const fresh = evaluateSbrGovernance(positions, 100, new Date("2026-07-01T00:00:00Z"), now)
ok("75-day stale source breaches governance", stale.checks.find(c => c.id === "freshness")?.status === "breach")
ok("fresh source passes governance", fresh.checks.find(c => c.id === "freshness")?.status === "ok")

if (failures) process.exit(1)
console.log("Forecast and SBR governance checks passed")
