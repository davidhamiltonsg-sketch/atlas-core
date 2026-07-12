import { ATLAS_CORE, SILICON_BRICK_ROAD } from "../lib/constitutions"
import { decidePortfolio, type GovernedPosition } from "../lib/portfolio-engine-v2"
import { planWholeSharePurchases } from "../lib/dca-cash-bank"
import { ATLAS_SPEC, SBR_SPEC } from "../lib/portfolio-spec"
import { computeSbrLookThrough } from "../lib/sbr-look-through"
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
eq("Atlas approved tickers", ATLAS_SPEC.funds.map(f => f.ticker), ["VWRA", "EQAC", "SMH", "BTC", "DBMFE"])
eq("SBR approved tickers", SBR_SPEC.funds.map(f => f.ticker), ["VWRA", "EQAC", "SMH", "BTC", "DBMFE"])
eq("UCITS identities", ATLAS_SPEC.funds.filter(f => f.ticker !== "BTC").map(f => f.isin), ["IE00BK5BQT80", "IE00BFZXGZ54", "IE00BMC38736", "LU2951555403"])
eq("SBR has no fixed value target", [SBR_SPEC.hasFixedTarget, SBR_SPEC.phases.map(p => p.key)], [false, ["GROWTH"]])

let d = decidePortfolio(SILICON_BRICK_ROAD, [])
eq("SBR empty starts with VWRA", [d.state, d.move.ticker, d.contribution.allocations.find(a => a.amount > 0)?.ticker], ["unfunded", "VWRA", "VWRA"])

d = decidePortfolio(SILICON_BRICK_ROAD, [p("VWRA", 60), p("EQAC", 16), p("SMH", 5), p("BTC", 5), p("DBMFE", 14)])
eq("SBR routes to furthest-underweight VWRA", [d.state, d.move.ticker], ["invested", "VWRA"])

d = decidePortfolio(SILICON_BRICK_ROAD, [p("VWRA", 55), p("EQAC", 23), p("SMH", 7), p("BTC", 5), p("DBMFE", 10)])
eq("SBR hard cap pauses EQAC and routes core", [d.move.severity, d.move.ticker, d.contribution.allocations.find(a => a.amount > 0)?.ticker], ["critical", "EQAC", "VWRA"])

d = decidePortfolio(SILICON_BRICK_ROAD, [p("VWRA", 76), p("EQAC", 10), p("SMH", 4), p("BTC", 4), p("DBMFE", 6)])
eq("SBR capped core cannot receive contribution", [d.move.severity, d.move.ticker, d.contribution.allocations.find(a => a.amount > 0)?.ticker], ["critical", "VWRA", "EQAC"])

d = decidePortfolio(ATLAS_CORE, [p("VT", 40), p("QQQM", 30), p("VWO", 15), p("SMH_US", 10), p("BTC", 5)])
eq("Atlas legacy holdings enter transition", [d.state, d.legacyTickers], ["transition", ["VT", "QQQM", "VWO", "SMH_US"]])

d = decidePortfolio(ATLAS_CORE, [p("VWRA", 70), p("EQAC", 10), p("SMH", 5), p("BTC", 5), p("DBMFE", 10)])
eq("Atlas target state remains contribution-first", [d.state, d.move.severity, d.move.ticker], ["invested", "none", "VWRA"])

d = decidePortfolio(ATLAS_CORE, [p("VWRA", 60), p("EQAC", 24), p("SMH", 5), p("BTC", 5), p("DBMFE", 6)])
eq("Atlas hard cap pauses EQAC and routes core", [d.move.severity, d.move.ticker, d.contribution.allocations.find(a => a.amount > 0)?.ticker], ["critical", "EQAC", "VWRA"])

d = decidePortfolio(ATLAS_CORE, [p("VWRA", 73), p("EQAC", 14), p("SMH", 6), p("BTC", 5), p("DBMFE", 2)])
eq("Atlas DBMFE floor takes contribution priority", [d.move.severity, d.move.ticker, d.contribution.allocations.find(a => a.amount > 0)?.ticker], ["high", "DBMFE", "DBMFE"])

const whole = planWholeSharePurchases(d.contribution, [{ ticker: "DBMFE", price: 100, fxToBank: 1.5, commission: 5 }], 120, 3000)
eq("whole-share bank reserves commission and carries remainder", [whole.instructions[0]?.units, whole.closingBank], [20, 115])

const tooSmall = planWholeSharePurchases(d.contribution, [{ ticker: "DBMFE", price: 1000, fxToBank: 1.5, commission: 5 }], 20, 100)
eq("insufficient cash buys zero and carries all", [tooSmall.instructions.length, tooSmall.closingBank], [0, 120])

const emptyLt = computeSbrLookThrough([])
eq("empty SBR has no phantom look-through", [emptyLt.topCompany.pct, emptyLt.topCountry.pct, emptyLt.assets.length], [0, 0, 0])
const targetPositions = [p("VWRA", 65), p("EQAC", 15), p("SMH", 5), p("BTC", 5), p("DBMFE", 10)]
const targetLt = computeSbrLookThrough(targetPositions)
eq("SBR target look-through has four lenses", [targetLt.companies.length > 0, targetLt.countries.length > 0, targetLt.industries.length > 0, targetLt.assets.length > 0], [true, true, true, true])
eq("US SMH identity stays separate", instrumentIdentity({ symbol: "SMH", cusip: "92189F676", exchange: "NASDAQ" }).ticker, "SMH.US")
eq("UCITS SMH uses governed canonical key", instrumentIdentity({ symbol: "SMH", isin: "IE00BMC38736", exchange: "LSE" }).ticker, "SMH")
eq("IBIT identity remains the instrument", instrumentIdentity({ symbol: "IBIT", cusip: "46438F101", exchange: "NASDAQ" }).ticker, "IBIT")

if (failures) { console.error(`\n${failures} v2 routing check(s) failed.`); process.exit(1) }
console.log("\nAll portfolio v2 routing checks passed ✓")
