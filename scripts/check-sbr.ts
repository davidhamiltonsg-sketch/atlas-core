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

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(54)}`)
if (failures === 0) { console.log(`  All ${passes} checks passed. Silicon Brick Road v2.2 ✓`); process.exit(0) }
else { console.error(`  ${failures} check(s) failed, ${passes} passed.`); process.exit(1) }
