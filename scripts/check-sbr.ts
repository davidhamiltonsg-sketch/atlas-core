/**
 * Silicon Brick Road — Constitution v2.2 contract check.
 *
 * SBR's numbers previously had no guard (unlike Atlas Core's check-governance/constitution).
 * This asserts the SILICON_BRICK_ROAD registry constants still match the v2.2 document:
 * fund targets/ranges/caps, the combined QQQM+SMH ceiling, total-equity ceiling, drawdown
 * trigger, skip-at-high threshold, and the phase value thresholds. Pure constant comparison —
 * no DB, no network.
 *
 * Run:  npx tsx scripts/check-sbr.ts   (or: npm run check:sbr)
 * Exit: 0 = all aligned · 1 = one or more mismatches (prints each).
 */
import { SILICON_BRICK_ROAD as SBR } from "../lib/constitutions"
import { computeSbrNextMove, computeSbrDca, type SbrPosition } from "../lib/sbr-engine"
import { computeSbrLookThrough, SBR_TECHNOLOGY_LIMIT, SBR_SINGLE_COMPANY_LIMIT } from "../lib/sbr-look-through"

let failures = 0
let passes = 0
function eq(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) { console.error(`  ✗  ${label}\n       expected: ${e}\n       got:      ${a}`); failures++ }
  else { console.log(`  ✓  ${label}`); passes++ }
}

console.log("Silicon Brick Road — Constitution v2.2 contract check\n")

// ── Version pin ───────────────────────────────────────────────────────────────
eq("version", SBR.version, "2.2")
eq("currency", SBR.currency, "SGD")
eq("monthly contribution", SBR.monthlyContribution, 2000)
eq("target value (SGD)", SBR.targetValue, 120000)

// ── Fund targets / ranges / caps (Article VII) ────────────────────────────────
const fund = (t: string) => SBR.funds.find((f) => f.ticker === t)!
console.log("\nArt. VII — Funds")
eq("VWRA target/range/cap", [fund("VWRA").target, fund("VWRA").rangeLow, fund("VWRA").rangeHigh, fund("VWRA").hardCap], [50, 44, 56, 62])
eq("QQQM target/range/cap", [fund("QQQM").target, fund("QQQM").rangeLow, fund("QQQM").rangeHigh, fund("QQQM").hardCap], [25, 20, 30, 30])
eq("SMH  target/range/cap", [fund("SMH").target,  fund("SMH").rangeLow,  fund("SMH").rangeHigh,  fund("SMH").hardCap],  [15, 11, 19, 20])
eq("A35  target/range/floor", [fund("A35").target, fund("A35").rangeLow, fund("A35").rangeHigh, fund("A35").hardCap, fund("A35").floor], [10, 7, 13, null, 7])

// ── Combined tech ceiling (Article IX) ────────────────────────────────────────
console.log("\nArt. IX — Combined QQQM+SMH ceiling")
eq("combined tickers", SBR.combined?.tickers, ["QQQM", "SMH"])
eq("combined warning/hard/resume", [SBR.combined?.warning, SBR.combined?.hard, SBR.combined?.resume], [40, 45, 42])

// ── Global limits ─────────────────────────────────────────────────────────────
console.log("\nGlobal limits")
eq("total equity max %", SBR.totalEquityMaxPct, 92)
eq("drawdown trigger %", SBR.drawdownTriggerPct, 15)
eq("skip-at-high %", SBR.skipAtHighPct, 3)

// ── Phase value thresholds (Article XII) ──────────────────────────────────────
console.log("\nArt. XII — Phase thresholds (SGD)")
const phase = (k: string) => SBR.phases?.find((p) => p.key === k)
eq("Phase I   range", [phase("I")?.min,   phase("I")?.max],   [0, 72000])
eq("Phase II  range", [phase("II")?.min,  phase("II")?.max],  [72000, 102000])
eq("Phase III range", [phase("III")?.min, phase("III")?.max], [102000, 114000])
eq("Phase IV  range", [phase("IV")?.min,  phase("IV")?.max],  [114000, null])
eq("Phase I selling",   phase("I")?.selling,   false)
eq("Phase III selling", phase("III")?.selling, true)
eq("Phase IV selling",  phase("IV")?.selling,  false)

// ── Two-engine agreement (Article VI) ─────────────────────────────────────────
// The headline instruction (computeSbrNextMove) and the money-split (computeSbrDca) must
// route to the same fund in the key ladder branches — otherwise Dami sees one fund named
// in the headline while the split sends the money somewhere else. Total is kept in Phase I.
console.log("\nArt. VI — Two-engine routing agreement")
const TOTAL = 50_000 // Phase I
function sp(ticker: string, actualPct: number): SbrPosition {
  const f = fund(ticker)
  return {
    ticker, name: ticker, color: "#000", value: (actualPct / 100) * TOTAL, actualPct,
    targetPct: f.target, rangeLow: f.rangeLow, rangeHigh: f.rangeHigh,
    hardCap: f.hardCap, floor: f.floor, latestPrice: 100, hi52: 0,
  }
}
// Primary destination of the split = the fund receiving the most money.
function dcaPrimary(plan: { allocations: { ticker: string; amount: number }[] }): string {
  return plan.allocations.reduce((best, a) => (a.amount > (best?.amount ?? -1) ? a : best),
    null as { ticker: string; amount: number } | null)?.ticker ?? "?"
}
function agree(label: string, positions: SbrPosition[], opts: { drawdownPct?: number }, expected: string) {
  const nm = computeSbrNextMove(positions, TOTAL, opts)
  const dc = computeSbrDca(positions, SBR.monthlyContribution, opts)
  const primary = dcaPrimary(dc)
  eq(`${label} — headline`, nm.ticker, expected)
  eq(`${label} — split matches headline`, primary, expected)
}
// Combined QQQM+SMH over the 45% hard ceiling → both buy VWRA.
agree("combined > 45%", [sp("VWRA", 39), sp("QQQM", 30), sp("SMH", 16), sp("A35", 15)], {}, "VWRA")
// A35 below its 7% floor (combined kept under the warning) → both top up A35.
agree("A35 below floor", [sp("VWRA", 61), sp("QQQM", 22), sp("SMH", 12), sp("A35", 5)], {}, "A35")
// Drawdown past 15% → both buy VWRA. Weights chosen so the drawdown branch fires FIRST:
// combined QQQM+SMH = 34% (under the 40% warning), A35 ≥ 7% floor, every fund in range —
// so nothing higher on the ladder pre-empts the drawdown routing this scenario is testing.
agree("drawdown > 15%", [sp("VWRA", 55), sp("QQQM", 22), sp("SMH", 12), sp("A35", 11)], { drawdownPct: -20 }, "VWRA")

// SMH over its 20% cap: the headline instruction is to SELL SMH (a sell is not something the
// contribution planner represents), and the money-split must never add MORE SMH. A sell and a
// buy are different flows, but they must not conflict on the same screen.
{
  const positions = [sp("VWRA", 51), sp("QQQM", 15), sp("SMH", 22), sp("A35", 12)]
  const nm = computeSbrNextMove(positions, TOTAL, {})
  const dc = computeSbrDca(positions, SBR.monthlyContribution, {})
  eq("SMH>20% — headline sells SMH", nm.ticker, "SMH")
  eq("SMH>20% — split never buys more SMH", dcaPrimary(dc) !== "SMH", true)
}

// ── Hidden-exposure look-through (Article XVII) ───────────────────────────────
console.log("\nArt. XVII — Hidden-exposure look-through")
eq("technology limit", SBR_TECHNOLOGY_LIMIT, 45)
eq("single-company limit", SBR_SINGLE_COMPANY_LIMIT, 10)
// A heavy tech tilt (lots of QQQM + SMH) must be flagged over both limits; the on-target mix
// must be clear. Positions carry only ticker + actualPct for the look-through.
const heavy = computeSbrLookThrough([{ ticker: "VWRA", actualPct: 30 }, { ticker: "QQQM", actualPct: 35 }, { ticker: "SMH", actualPct: 25 }, { ticker: "A35", actualPct: 10 }])
eq("heavy tilt → over technology limit", heavy.technologyOver, true)
eq("heavy tilt → biggest single company is Nvidia", heavy.topCompany.name, "Nvidia")
// The single-company 10% limit stays satisfied even on a heavy tilt — the SMH 20% fund cap
// bounds the largest holding (Nvidia) below 10%, which is exactly what the limit guards.
eq("heavy tilt → single-company still within limit", heavy.singleCompanyOver, false)
const onTarget = computeSbrLookThrough([{ ticker: "VWRA", actualPct: 50 }, { ticker: "QQQM", actualPct: 25 }, { ticker: "SMH", actualPct: 15 }, { ticker: "A35", actualPct: 10 }])
eq("on-target → within technology limit", onTarget.technologyOver, false)
eq("on-target → within single-company limit", onTarget.singleCompanyOver, false)

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(54)}`)
if (failures === 0) { console.log(`  All ${passes} checks passed. Silicon Brick Road v2.2 ✓`); process.exit(0) }
else { console.error(`  ${failures} check(s) failed, ${passes} passed.`); process.exit(1) }
