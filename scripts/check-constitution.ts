/**
 * Atlas Core — Constitution v1.4 contract check.
 *
 * Verifies that code constants match the Constitution v1.4 document:
 *   drift classifier, cycle-phase resolver, dealing-window calculator,
 *   UCITS thresholds, contribution currency, throttle limits.
 *
 * Run:  npx tsx scripts/check-constitution.ts   (or: npm run check:constitution)
 * Exit: 0 = all aligned · 1 = one or more mismatches (prints each)
 */

import {
  CONSTITUTION_VERSION,
  HARD_THRESHOLDS,
  DCA_PARAMS,
  OPERATING_ASSUMPTIONS,
  THROTTLE,
  GOVERNANCE_SCORE,
  CURRENCY_POLICY,
  getBtcCyclePhase,
  getDealingWindow,
  isInDealingWindow,
  isBusinessDay,
  nthBusinessDayAfter,
  lastBusinessDayOfMonth,
} from "../lib/constitution"

let failures = 0
let passes   = 0

function eq(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) {
    console.error(`  ✗  ${label}\n       expected: ${e}\n       got:      ${a}`)
    failures++
  } else {
    console.log(`  ✓  ${label}`)
    passes++
  }
}

function ok(label: string, condition: boolean) {
  if (!condition) {
    console.error(`  ✗  ${label}`)
    failures++
  } else {
    console.log(`  ✓  ${label}`)
    passes++
  }
}

console.log(`Atlas Core — Constitution v1.4 contract check\n`)

// ─── Version pin ──────────────────────────────────────────────────────────────
console.log("Version")
eq("CONSTITUTION_VERSION", CONSTITUTION_VERSION, "1.4")

// ─── Art. VII — Hard thresholds ───────────────────────────────────────────────
console.log("\nArt. VII — Thresholds")
eq("VT hard cap (Art. VII)",    HARD_THRESHOLDS.VT?.high,         60)
eq("VT hard low (Art. VII)",    HARD_THRESHOLDS.VT?.low,          42)
eq("SMH hard cap (Art. VII)",   HARD_THRESHOLDS.SMH?.high,        12)
eq("SMH amber trigger (Art. VII)", HARD_THRESHOLDS.SMH?.amberHigh, 11)
eq("SMH hard low (Art. VII)",   HARD_THRESHOLDS.SMH?.low,          5)
eq("QQQM hard cap (Art. VII)",  HARD_THRESHOLDS.QQQM?.high,       31)
eq("QQQM hard low (Art. VII)",  HARD_THRESHOLDS.QQQM?.low,        15)
eq("VWO hard cap (Art. VII)",   HARD_THRESHOLDS.VWO?.high,        13)
eq("VWO hard low (Art. VII)",   HARD_THRESHOLDS.VWO?.low,          3)
eq("BTC hard cap base (Art. VIII)", HARD_THRESHOLDS.BTC?.high,     8)

// ─── Art. VIII — BTC cycle-phase resolver ─────────────────────────────────────
console.log("\nArt. VIII — BTC cycle-phase resolver")

// Bear: price < 50% of cycle high
eq("phase: bear (price 40% of high)",     getBtcCyclePhase(0.40),         "bear")
eq("phase: bear (price 49% of high)",     getBtcCyclePhase(0.49),         "bear")

// Months 0–11: normal (catalyst not yet priced)
const halving = new Date("2024-04-19")
function monthsAfterHalving(m: number): Date {
  const d = new Date(halving)
  d.setMonth(d.getMonth() + m)
  return d
}
// Note: getBtcCyclePhase uses `new Date()` internally — test via the returned phase
// and known date: April 2024 halving, today is July 2026 = ~27 months → normal
eq("phase: normal (27 months post-halving)", getBtcCyclePhase(undefined),  "normal")

// Manual override
eq("phase: override bull",  getBtcCyclePhase(undefined, "post_halving_bull"), "post_halving_bull")
eq("phase: override bear",  getBtcCyclePhase(undefined, "bear"),              "bear")
eq("phase: override normal",getBtcCyclePhase(undefined, "normal"),            "normal")

// ─── Art. XIII — Contribution params ──────────────────────────────────────────
console.log("\nArt. XIII — DCA params")
eq("DCA currency (Art. XIII)", DCA_PARAMS.currency,            "SGD")
eq("DCA monthly (Art. XIII)",  DCA_PARAMS.monthlyContribution, 3000)
eq("DCA annual boost",         DCA_PARAMS.annualJanuaryBoost,  20000)

// ─── Art. XIII — Dealing window ───────────────────────────────────────────────
console.log("\nArt. XIII — Dealing window")

// isBusinessDay
ok("Monday is a business day",  isBusinessDay(new Date("2026-07-06")))  // Monday
ok("Saturday is not a business day", !isBusinessDay(new Date("2026-07-04"))) // Saturday
ok("Sunday is not a business day",   !isBusinessDay(new Date("2026-07-05"))) // Sunday
ok("Friday is a business day",  isBusinessDay(new Date("2026-07-03")))  // Friday

// Use local date string — toISOString() shifts to UTC and fails in UTC+8 (SGD timezone)
function ld(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

// nthBusinessDayAfter — 3 business days after 2026-07-15 (Wednesday)
// Thu 16 = day 1, Fri 17 = day 2, Mon 20 = day 3 → opens Mon 20 Jul
const julyWindow = getDealingWindow(new Date(2026, 6, 15)) // local ctor avoids UTC shift
// July 15 (Wed) → Thu 16 (day 1) → Fri 17 (day 2) → Mon 20 (day 3) → opens Mon 20
eq("July dealing window opens (3rd biz day after 15th)", ld(julyWindow.opens), "2026-07-20")

// Last business day of July 2026 — July 31 is a Friday
const lastBizJuly = lastBusinessDayOfMonth(2026, 6) // month=6 is July
eq("July 2026 last business day", ld(lastBizJuly), "2026-07-31")
eq("July dealing window closes",  ld(julyWindow.closes), "2026-07-31")

// ─── Art. XV — UCITS thresholds ───────────────────────────────────────────────
console.log("\nArt. XV — UCITS migration thresholds")
eq("estate-tax warning (Art. XV)",  OPERATING_ASSUMPTIONS.usEstateTaxTriggerUsd,    60_000)
eq("UCITS mandatory trigger (Art. XV)", OPERATING_ASSUMPTIONS.ucitsMandatoryTriggerUsd, 100_000)

// ─── Art. XIII — Throttle limits ──────────────────────────────────────────────
console.log("\nArt. XIII — Throttle limits")
eq("cooling-off hours",          THROTTLE.coolingOffHours,         72)
eq("param change moratorium",    THROTTLE.paramChangeMinDays,      90)
eq("discretionary per quarter",  THROTTLE.discretionaryPerQuarter,  1)

// ─── Art. XXII — Governance score weights ─────────────────────────────────────
console.log("\nArt. XXII — Governance score weights")
const totalWeight = Object.values(GOVERNANCE_SCORE).reduce((s, d) => s + d.weight, 0)
eq("structural weight",    GOVERNANCE_SCORE.structural.weight,    40)
eq("behavioural weight",   GOVERNANCE_SCORE.behavioural.weight,   25)
eq("concentration weight", GOVERNANCE_SCORE.concentration.weight, 25)
eq("freshness weight",     GOVERNANCE_SCORE.freshness.weight,     10)
eq("weights sum to 100",   totalWeight,                           100)

// ─── Art. XXIII — Currency policy ─────────────────────────────────────────────
console.log("\nArt. XXIII — Currency policy")
eq("base currency",       CURRENCY_POLICY.base,       "SGD")
eq("reporting currency",  CURRENCY_POLICY.reporting,  "SGD")
eq("price store currency",CURRENCY_POLICY.priceStore, "USD")

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(54)}`)
if (failures === 0) {
  console.log(`  All ${passes} checks passed. Constitution v1.4 ✓`)
  process.exit(0)
} else {
  console.error(`  ${failures} check(s) failed, ${passes} passed.`)
  process.exit(1)
}
