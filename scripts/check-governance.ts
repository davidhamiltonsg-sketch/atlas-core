/**
 * Atlas Core — governance contract check.
 *
 * Asserts that the code constants still match the Governance Document v6.7. This is the
 * guard against the exact failure this codebase had: the same cap/band number living in
 * several places and silently drifting apart. Pure constant comparison — no DB, no network.
 *
 * Run:  npx tsx scripts/check-governance.ts   (or: npm run check:governance)
 * Exit: 0 = all aligned · 1 = one or more mismatches (prints each).
 */
import {
  TICKER_TARGETS, HARD_THRESHOLDS, BTC_CYCLE_MODIFIERS, COMBINED_TECH_RULE,
  BEHAVIORAL_RULES, DCA_PARAMS, GOVERNANCE_VERSION, getGovernanceBandRow,
} from "../lib/constants"
import { LOOKTHROUGH_COMPANY_CAPS, LOOKTHROUGH_SECTOR_CAPS } from "../lib/look-through"
import { GOVERNANCE_RULES } from "../prisma/governance-data"

let failures = 0
function eq(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) { console.error(`  ✗ ${label}: expected ${e}, got ${a}`); failures++ }
}

console.log(`Atlas Core — governance contract check (Constitution v1.5)\n`)

// ── Version ──────────────────────────────────────────────────────────────────
eq("GOVERNANCE_VERSION", GOVERNANCE_VERSION, "6.7")  // legacy version string retained

// ── §1/§3 target weights ─────────────────────────────────────────────────────
eq("target VT",   TICKER_TARGETS.VT,   52)
eq("target QQQM", TICKER_TARGETS.QQQM, 23)
eq("target SMH",  TICKER_TARGETS.SMH,  10)
eq("target VWO",  TICKER_TARGETS.VWO,  8)
eq("target BTC",  TICKER_TARGETS.BTC,  7)

// ── Art. VII hard-drift triggers (v1.1) ──────────────────────────────────────
eq("hard VT",   HARD_THRESHOLDS.VT,   { low: 42, high: 60 })                    // Art. VII: cap 60%
eq("hard QQQM", HARD_THRESHOLDS.QQQM, { low: 15, high: 31 })
eq("hard SMH",  HARD_THRESHOLDS.SMH,  { low: 5,  high: 12, amberHigh: 11 })    // Art. VII: amber zone 11–12%
eq("hard VWO",  HARD_THRESHOLDS.VWO,  { low: 3,  high: 13 })
eq("hard BTC",  HARD_THRESHOLDS.BTC,  { high: 8 })

// ── §4.1 BTC halving-cycle caps ──────────────────────────────────────────────
// v1.5: bull phase no longer widens the cap — it holds at 8% (target 7, soft 8), same as normal.
eq("BTC bull  target/soft/hard", [BTC_CYCLE_MODIFIERS.post_halving_bull.target, BTC_CYCLE_MODIFIERS.post_halving_bull.softHigh, BTC_CYCLE_MODIFIERS.post_halving_bull.hardHigh], [7, 8, 8])
eq("BTC normal target/soft/hard", [BTC_CYCLE_MODIFIERS.normal.target, BTC_CYCLE_MODIFIERS.normal.softHigh, BTC_CYCLE_MODIFIERS.normal.hardHigh], [7, 8, 8])
eq("BTC bear  target/hard", [BTC_CYCLE_MODIFIERS.bear.target, BTC_CYCLE_MODIFIERS.bear.hardHigh], [5, 6])

// ── §4.3 combined tech ceiling ───────────────────────────────────────────────
eq("combined tech soft/hard", [COMBINED_TECH_RULE.softCeiling, COMBINED_TECH_RULE.hardCeiling], [38, 42])

// ── §4 look-through sector caps (soft/hard) ──────────────────────────────────
eq("sector semiconductor", [LOOKTHROUGH_SECTOR_CAPS.semiconductor.soft, LOOKTHROUGH_SECTOR_CAPS.semiconductor.hard], [16, 20])
eq("sector digital",       [LOOKTHROUGH_SECTOR_CAPS.digital.soft,       LOOKTHROUGH_SECTOR_CAPS.digital.hard],       [48, 54])
eq("sector us",            [LOOKTHROUGH_SECTOR_CAPS.us.soft,            LOOKTHROUGH_SECTOR_CAPS.us.hard],            [66, 70])  // v1.5: tightened from 70/78
eq("sector ai",            [LOOKTHROUGH_SECTOR_CAPS.ai.soft,            LOOKTHROUGH_SECTOR_CAPS.ai.hard],            [38, 46])

// ── §4 look-through company caps (soft/hard) ─────────────────────────────────
const COMPANY_EXPECTED: Record<string, [number, number]> = {
  Nvidia: [10, 13], Microsoft: [10, 13], Apple: [8, 11], Amazon: [7, 9],
  Meta: [6, 8], Alphabet: [6, 8], Broadcom: [5, 7], TSMC: [5, 7],
}
for (const [co, [soft, hard]] of Object.entries(COMPANY_EXPECTED)) {
  eq(`company ${co}`, [LOOKTHROUGH_COMPANY_CAPS[co]?.soft, LOOKTHROUGH_COMPANY_CAPS[co]?.hard], [soft, hard])
}

// ── §7 behavioural constants ─────────────────────────────────────────────────
eq("hold period days", BEHAVIORAL_RULES.holdPeriodDays, 90)
eq("dip tranches", [BEHAVIORAL_RULES.dipTranches.first, BEHAVIORAL_RULES.dipTranches.second, BEHAVIORAL_RULES.dipTranches.third], [0.30, 0.40, 0.30])
eq("near-high threshold", BEHAVIORAL_RULES.nearHighThreshold, 0.03)

// ── §5 DCA params ────────────────────────────────────────────────────────────
eq("monthly contribution", DCA_PARAMS.monthlyContribution, 3000)
eq("annual January boost", DCA_PARAMS.annualJanuaryBoost, 20000)
eq("horizon year", DCA_PARAMS.horizonYear, 2045)

// ── §11 rule register: 40 rules across 10 categories ─────────────────────────
eq("rule count", GOVERNANCE_RULES.length, 40)
const catCounts: Record<string, number> = {}
for (const r of GOVERNANCE_RULES) catCounts[r.category] = (catCounts[r.category] ?? 0) + 1
eq("category counts", catCounts, {
  "VT Governance": 4, "QQQM Governance": 4, "SMH Governance": 2, "VWO Governance": 3,
  "BTC Governance": 2, "Vehicle Transitions": 3, "Overlap & Concentration": 11,
  "Rebalancing": 2, "Behavioural Guards": 5, "Compliance": 4,
})
// The SMH cap must read 12% (never 15%) anywhere it is stated in the register.
for (const r of GOVERNANCE_RULES) {
  if (/\b15%/.test(r.description) && /SMH/i.test(r.title)) {
    console.error(`  ✗ stale SMH 15% cap in rule "${r.title}"`); failures++
  }
}

// ── Rule-register text must match the derived bands (prose ↔ constants) ───────
// The 5 "Healthy Range NN–MM%" rules embed numbers; assert they equal getGovernanceBandRow().
for (const ticker of ["VT", "QQQM", "SMH", "VWO", "BTC"]) {
  const band = getGovernanceBandRow(ticker)!
  const rule = GOVERNANCE_RULES.find((r) => r.title.startsWith(`${ticker} — Healthy Range`))
  if (!rule) { console.error(`  ✗ no "Healthy Range" rule for ${ticker}`); failures++; continue }
  const m = rule.title.match(/Healthy Range\s+(\d+)[–-](\d+)%/)
  if (!m) { console.error(`  ✗ ${ticker} healthy-range rule title not parseable: "${rule.title}"`); failures++; continue }
  eq(`${ticker} rule-title healthy band`, [Number(m[1]), Number(m[2])], [band.healthyLow, band.healthyHigh])
  // The hard-high number must appear in the rule description.
  if (!new RegExp(`\\b${band.hardHigh}%`).test(rule.description)) {
    console.error(`  ✗ ${ticker} rule description omits hard high ${band.hardHigh}%`); failures++
  }
}

if (failures === 0) {
  console.log("  ✓ All governance constants match the v6.7 document.\n")
  process.exit(0)
} else {
  console.error(`\n${failures} mismatch(es) found — code has drifted from the governance document.\n`)
  process.exit(1)
}
