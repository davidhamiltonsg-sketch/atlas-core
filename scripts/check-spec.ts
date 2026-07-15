/**
 * Portfolio Spec contract check — the single-source guarantee.
 *
 * Asserts that every consumer of a governed rule number matches lib/portfolio-spec.ts:
 *   Atlas  — TICKER_TARGETS / HARD_THRESHOLDS / COMBINED_TECH_RULE / look-through caps and the
 *            DB seed (CORE_DEFAULTS) are DERIVED from ATLAS_SPEC (this pins the derivation).
 *   SBR    — the SILICON_BRICK_ROAD registry numbers are PINNED to SBR_SPEC.
 * If any of them drift from the spec, this fails. Pure constant comparison — no DB, no network.
 *
 * Run:  npx tsx scripts/check-spec.ts   (or: npm run check:spec)
 */
import { ATLAS_SPEC, SBR_SPEC } from "../lib/portfolio-spec"
import { TICKER_TARGETS, HARD_THRESHOLDS, COMBINED_TECH_RULE, DCA_PARAMS } from "../lib/constants"
import { LOOKTHROUGH_SECTOR_CAPS } from "../lib/look-through"
import { CORE_DEFAULTS } from "../lib/core-holdings"
import { SILICON_BRICK_ROAD as SBR, ATLAS_CORE } from "../lib/constitutions"

let failures = 0
let passes = 0
function eq(label: string, actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`  ✗  ${label}\n       spec: ${JSON.stringify(expected)}\n       got:  ${JSON.stringify(actual)}`)
    failures++
  } else { passes++ }
}

console.log("Portfolio Spec — single-source contract check\n")

// ── Atlas Core: constants + seed derive from ATLAS_SPEC ───────────────────────
console.log("Atlas Core — derived from ATLAS_SPEC")
for (const f of ATLAS_SPEC.funds) {
  // DB seed carries every governed ticker incl. SGOV
  eq(`seed ${f.ticker} target`, CORE_DEFAULTS[f.ticker]?.targetPct, f.target)
  eq(`seed ${f.ticker} hardCap`, CORE_DEFAULTS[f.ticker]?.hardCapPct, f.hardCap)
  eq(`seed ${f.ticker} band`, CORE_DEFAULTS[f.ticker]?.toleranceBand, f.band)
  if (f.ticker === "SGOV") continue // SGOV is a buffer, not a target/threshold row
  eq(`target ${f.ticker}`, TICKER_TARGETS[f.ticker], f.target)
  eq(`hard-cap ${f.ticker}`, HARD_THRESHOLDS[f.ticker]?.high, f.hardCap)
  eq(`drift-low ${f.ticker}`, HARD_THRESHOLDS[f.ticker]?.low, f.driftLow)
  eq(`amber-high ${f.ticker}`, HARD_THRESHOLDS[f.ticker]?.amberHigh, f.amberHigh)
}
eq("Atlas registry tickers", ATLAS_CORE.funds.map(f => f.ticker), ATLAS_SPEC.funds.map(f => f.ticker))
for (const f of ATLAS_SPEC.funds) {
  const r = ATLAS_CORE.funds.find(x => x.ticker === f.ticker)
  eq(`Atlas ${f.ticker} registry`, [r?.target, r?.rangeLow, r?.rangeHigh, r?.hardCap, r?.floor ?? null], [f.target, f.target-f.band, f.target+f.band, f.hardCap, f.hardFloor ?? null])
  eq(`Atlas ${f.ticker} identity`, [f.isin ?? null, f.cusip ?? null], [f.ticker === "BTC" ? null : ({VWRA:"IE00BK5BQT80",EQAC:"IE00BFZXGZ54",SMH:"IE00BMC38736",DBMFE:"LU2951555403"} as Record<string,string>)[f.ticker], f.ticker === "BTC" ? "46438F101" : null])
}
eq("combined tech soft", COMBINED_TECH_RULE.softCeiling, ATLAS_SPEC.combinedTech.soft)
eq("combined tech hard", COMBINED_TECH_RULE.hardCeiling, ATLAS_SPEC.combinedTech.hard)
eq("Atlas currency (DCA)", DCA_PARAMS.currency, ATLAS_SPEC.currency)
eq("Atlas currency (registry)", ATLAS_CORE.currency, ATLAS_SPEC.currency)
eq("Atlas monthly", DCA_PARAMS.monthlyContribution, ATLAS_SPEC.monthlyContribution)
eq("Atlas January boost", DCA_PARAMS.annualJanuaryBoost, ATLAS_SPEC.annualJanuaryBoost)
eq("Atlas horizon", DCA_PARAMS.horizonYear, ATLAS_SPEC.horizonYear)
for (const [k, v] of Object.entries(ATLAS_SPEC.lookThroughSectors)) {
  eq(`look-through ${k}`, [LOOKTHROUGH_SECTOR_CAPS[k]?.soft, LOOKTHROUGH_SECTOR_CAPS[k]?.hard], [v.soft, v.hard])
}

// ── Silicon Brick Road: registry pinned to SBR_SPEC ───────────────────────────
console.log("\nSilicon Brick Road — pinned to SBR_SPEC")
const sbrFund = (t: string) => SBR.funds.find((f) => f.ticker === t)
for (const f of SBR_SPEC.funds) {
  const r = sbrFund(f.ticker)
  eq(`SBR ${f.ticker} target/range/cap/floor`,
    [r?.target, r?.rangeLow, r?.rangeHigh, r?.hardCap, r?.floor ?? null],
    [f.target, f.rangeLow, f.rangeHigh, f.hardCap, f.floor ?? null])
}
eq("SBR identities", SBR_SPEC.funds.map(f => [f.ticker, f.isin ?? null, f.cusip ?? null]), [
  ["VWRA","IE00BK5BQT80",null],["EQAC","IE00BFZXGZ54",null],["SMH","IE00BMC38736",null],["BTC",null,"46438F101"],["DBMFE","LU2951555403",null],["A35","SG1S08926457",null],
])
eq("SBR monthly", SBR.monthlyContribution, SBR_SPEC.monthlyContribution)
eq("SBR target value", SBR.targetValue, SBR_SPEC.hasFixedTarget ? SBR_SPEC.targetValue : null)
eq("SBR currency", SBR.currency, SBR_SPEC.currency)
eq("SBR combined", [SBR.combined?.warning, SBR.combined?.hard, SBR.combined?.resume],
  [SBR_SPEC.combined.warning, SBR_SPEC.combined.hard, SBR_SPEC.combined.resume])
eq("SBR total-equity max", SBR.totalEquityMaxPct, SBR_SPEC.totalEquityMaxPct)
eq("SBR drawdown trigger", SBR.drawdownTriggerPct, SBR_SPEC.drawdownTriggerPct)
eq("SBR skip-at-high", SBR.skipAtHighPct, SBR_SPEC.skipAtHighPct)
for (const p of SBR_SPEC.phases) {
  const rp = SBR.phases?.find((x) => x.key === p.key)
  eq(`SBR phase ${p.key} range`, [rp?.min, rp?.max], [p.min, p.max])
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(54)}`)
if (failures === 0) { console.log(`  All ${passes} checks passed. Portfolio spec is the single source ✓`); process.exit(0) }
else { console.error(`  ${failures} check(s) failed, ${passes} passed — a rule number has drifted from lib/portfolio-spec.ts.`); process.exit(1) }
