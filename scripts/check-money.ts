/**
 * Money contract check — the "no displayed string changed" guarantee for pillar 4.
 *
 * Asserts that:
 *   1. formatMoney({amount, ccy}) is byte-identical to the legacy formatCurrency(amount, ccy)
 *      across a grid of amounts and both currencies — so adopting Money changes no display.
 *   2. convert() is a no-op on matching currencies and applies the rate otherwise (the single
 *      reporting boundary).
 *   3. reportingCurrencyForConstitution() maps each portfolio to its reporting currency and
 *      defaults unknown ids to the USD base.
 * Pure functions — no DB, no network.
 *
 * Run:  npx tsx scripts/check-money.ts   (or: npm run check:money)
 */
import { formatMoney, convert, type Currency } from "../lib/money"
import { formatCurrency } from "../lib/utils"
import { reportingCurrencyForConstitution } from "../lib/portfolio-spec"

let failures = 0
let passes = 0
function eq(label: string, actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`  ✗  ${label}\n       expected: ${JSON.stringify(expected)}\n       got:      ${JSON.stringify(actual)}`)
    failures++
  } else { passes++ }
}

console.log("Money — single-formatter + reporting-boundary contract check\n")

// 1. formatMoney is byte-identical to the legacy formatCurrency across a representative grid.
const AMOUNTS = [0, 1, 999, 1000, 1999.4, 2000, 3000, -1500, 120000, 1234567.89]
const CCYS: Currency[] = ["USD", "SGD"]
for (const ccy of CCYS) {
  for (const a of AMOUNTS) {
    eq(`formatMoney == formatCurrency (${a} ${ccy})`, formatMoney({ amount: a, ccy }), formatCurrency(a, ccy))
  }
}

// 2. convert: no-op on matching currency; applies rate across the boundary.
eq("convert same-ccy is identity", convert({ amount: 2000, ccy: "SGD" }, "SGD", 1.35), { amount: 2000, ccy: "SGD" })
eq("convert applies rate", convert({ amount: 100, ccy: "USD" }, "SGD", 1.35), { amount: 135, ccy: "SGD" })

// 3. reporting currency is the single source for "USD base vs SGD".
eq("reporting ccy atlas-core", reportingCurrencyForConstitution("atlas-core"), "USD")
eq("reporting ccy silicon-brick-road", reportingCurrencyForConstitution("silicon-brick-road"), "SGD")
eq("reporting ccy unknown → USD base", reportingCurrencyForConstitution("something-else"), "USD")

console.log(`\n${"─".repeat(54)}`)
if (failures === 0) { console.log(`  All ${passes} checks passed. Money display is unchanged; currency has one boundary ✓`); process.exit(0) }
else { console.error(`  ${failures} check(s) failed, ${passes} passed.`); process.exit(1) }
