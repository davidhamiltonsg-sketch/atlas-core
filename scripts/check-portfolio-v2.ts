import { ATLAS_CORE, SILICON_BRICK_ROAD } from "../lib/constitutions"
import { decidePortfolio, type GovernedPosition } from "../lib/portfolio-engine-v2"
import { planWholeSharePurchases } from "../lib/dca-cash-bank"
import { ATLAS_SPEC, SBR_SPEC } from "../lib/portfolio-spec"
import { computeSbrLookThrough } from "../lib/sbr-look-through"
import { evaluateSbrGovernance } from "../lib/sbr-governance"
import { instrumentIdentity } from "../lib/instrument-identity"

let failures = 0
function eq(label: string, got: unknown, expected: unknown) {
  if (JSON.stringify(got) !== JSON.stringify(expected)) {
    failures++; console.error(`  ✗ ${label}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(got)}`)
  } else console.log(`  ✓ ${label}`)
}
function p(ticker: string, pct: number): GovernedPosition {
  return { ticker, name: ticker, color: "#fff", value: pct * 1000, actualPct: pct }
}

console.log("Portfolio v2 — constitutional routing checks\n")

eq("Atlas target weights sum to 100", ATLAS_SPEC.funds.reduce((s, f) => s + f.target, 0), 100)
eq("SBR target weights sum to 100", SBR_SPEC.funds.reduce((s, f) => s + f.target, 0), 100)
eq("Atlas approved tickers", ATLAS_SPEC.funds.map(f => f.ticker), ["IMID", "EQAC", "SMH", "BTC", "IB01"])
eq("SBR approved tickers", SBR_SPEC.funds.map(f => f.ticker), ["IMID", "EQAC", "SMH", "IB01"])
eq("UCITS identities", ATLAS_SPEC.funds.filter(f => f.ticker !== "BTC").map(f => f.isin), ["IE00B3YLTY66", "IE00BFZXGZ54", "IE00BMC38736", "IE00BGSF1X88"])
eq("SBR has no fixed value target", [SBR_SPEC.hasFixedTarget, SBR_SPEC.phases.map(p => p.key)], [false, ["GROWTH"]])

let d = decidePortfolio(SILICON_BRICK_ROAD, [])
eq("SBR empty starts with IMID", [d.state, d.move.ticker, d.contribution.allocations.find(a => a.amount > 0)?.ticker], ["unfunded", "IMID", "IMID"])

d = decidePortfolio(SILICON_BRICK_ROAD, [p("IMID", 78), p("EQAC", 11), p("SMH", 6), p("IB01", 5)])
eq("SBR routes to furthest-underweight IMID", [d.state, d.move.ticker], ["invested", "IMID"])

d = decidePortfolio(SILICON_BRICK_ROAD, [p("IMID", 74), p("EQAC", 16), p("SMH", 5), p("IB01", 5)])
eq("SBR hard cap pauses EQAC and routes core", [d.move.severity, d.move.ticker, d.contribution.allocations.find(a => a.amount > 0)?.ticker], ["critical", "EQAC", "IMID"])

d = decidePortfolio(ATLAS_CORE, [p("VT", 40), p("QQQM", 30), p("VWO", 15), p("SMH_US", 10), p("BTC", 5)])
eq("Atlas legacy holdings enter transition", [d.state, d.legacyTickers], ["transition", ["VT", "QQQM", "VWO", "SMH_US"]])

d = decidePortfolio(ATLAS_CORE, [p("IMID", 67.5), p("EQAC", 15), p("SMH", 7.5), p("BTC", 5), p("IB01", 5)])
eq("Atlas target state remains contribution-first", [d.state, d.move.severity, d.move.ticker], ["invested", "none", "IMID"])

d = decidePortfolio(ATLAS_CORE, [p("IMID", 64), p("EQAC", 21), p("SMH", 6), p("BTC", 4), p("IB01", 5)])
eq("Atlas hard cap pauses EQAC and routes core", [d.move.severity, d.move.ticker, d.contribution.allocations.find(a => a.amount > 0)?.ticker], ["critical", "EQAC", "IMID"])

const whole = planWholeSharePurchases(d.contribution, [{ ticker: "IMID", price: 100, fxToBank: 1.5, commission: 5 }], 120, 3000)
eq("whole-share bank reserves commission and carries remainder", [whole.instructions[0]?.units, whole.closingBank], [20, 115])

const tooSmall = planWholeSharePurchases(d.contribution, [{ ticker: "IMID", price: 1000, fxToBank: 1.5, commission: 5 }], 20, 100)
eq("insufficient cash buys zero and carries all", [tooSmall.instructions.length, tooSmall.closingBank], [0, 120])

const emptyLt = computeSbrLookThrough([])
eq("empty SBR has no phantom look-through", [emptyLt.topCompany.pct, emptyLt.topCountry.pct, emptyLt.assets.length], [0, 0, 0])
const targetPositions = [p("IMID", 80), p("EQAC", 10), p("SMH", 5), p("IB01", 5)]
const targetLt = computeSbrLookThrough(targetPositions)
eq("SBR target look-through has four lenses", [targetLt.companies.length > 0, targetLt.countries.length > 0, targetLt.industries.length > 0, targetLt.assets.length > 0], [true, true, true, true])
const sbrGovPositions = targetPositions.map(x => ({ ...x, targetPct: x.actualPct, rangeLow: 0, rangeHigh: 100, hardCap: 100, latestPrice: 0, hi52: 0 }))
eq("SBR target governance has no hard breach", evaluateSbrGovernance(sbrGovPositions, 100000).breaches, 0)

eq("US SMH identity stays separate", instrumentIdentity({ symbol: "SMH", cusip: "92189F676", exchange: "NASDAQ" }).ticker, "SMH.US")
eq("UCITS SMH identity stays separate", instrumentIdentity({ symbol: "SMH", isin: "IE00BMC38736", exchange: "LSE" }).ticker, "SMH.L")

if (failures) { console.error(`\n${failures} v2 routing check(s) failed.`); process.exit(1) }
console.log("\nAll portfolio v2 routing checks passed ✓")
