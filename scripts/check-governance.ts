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
import { CORE_DEFAULTS } from "../lib/core-holdings"

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
eq("target VWRA", TICKER_TARGETS.VWRA, 52)
eq("target EQQQ", TICKER_TARGETS.EQQQ, 23)
eq("target SEMI", TICKER_TARGETS.SEMI, 10)
eq("target VFEA", TICKER_TARGETS.VFEA, 8)
eq("target BTC",  TICKER_TARGETS.BTC,  5)

// ── Art. VII hard-drift triggers (v1.1) ──────────────────────────────────────
eq("hard VWRA", HARD_THRESHOLDS.VWRA, { low: 42, high: 60 })                    // Art. VII: cap 60%
eq("hard EQQQ", HARD_THRESHOLDS.EQQQ, { low: 15, high: 30 })
eq("hard SEMI", HARD_THRESHOLDS.SEMI, { low: 5,  high: 12, amberHigh: 11 })    // Art. VII: amber zone 11–12%
eq("hard VFEA", HARD_THRESHOLDS.VFEA, { low: 3,  high: 13 })
eq("hard BTC",  HARD_THRESHOLDS.BTC,  { high: 8 })

// ── §4.1 BTC halving-cycle caps ──────────────────────────────────────────────
// The bull phase holds the cap at 8% (target 7, soft 8), same as normal — it does not widen on the cycle.
eq("BTC bull  target/soft/hard", [BTC_CYCLE_MODIFIERS.post_halving_bull.target, BTC_CYCLE_MODIFIERS.post_halving_bull.softHigh, BTC_CYCLE_MODIFIERS.post_halving_bull.hardHigh], [5, 7, 8])
eq("BTC normal target/soft/hard", [BTC_CYCLE_MODIFIERS.normal.target, BTC_CYCLE_MODIFIERS.normal.softHigh, BTC_CYCLE_MODIFIERS.normal.hardHigh], [5, 7, 8])
eq("BTC bear  target/hard", [BTC_CYCLE_MODIFIERS.bear.target, BTC_CYCLE_MODIFIERS.bear.hardHigh], [5, 6])

// ── §4.3 combined tech ceiling ───────────────────────────────────────────────
eq("combined tech soft/hard", [COMBINED_TECH_RULE.softCeiling, COMBINED_TECH_RULE.hardCeiling], [38, 42])

// ── §4 look-through sector caps (soft/hard) ──────────────────────────────────
eq("sector semiconductor", [LOOKTHROUGH_SECTOR_CAPS.semiconductor.soft, LOOKTHROUGH_SECTOR_CAPS.semiconductor.hard], [16, 20])
eq("sector digital",       [LOOKTHROUGH_SECTOR_CAPS.digital.soft,       LOOKTHROUGH_SECTOR_CAPS.digital.hard],       [48, 54])
eq("sector us",            [LOOKTHROUGH_SECTOR_CAPS.us.soft,            LOOKTHROUGH_SECTOR_CAPS.us.hard],            [66, 70])  // Art. IX US look-through caps
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
  "VWRA Governance": 4, "EQQQ Governance": 4, "SEMI Governance": 2, "VFEA Governance": 3,
  "BTC Governance": 2, "Vehicle Transitions": 3, "Overlap & Concentration": 11,
  "Rebalancing": 2, "Behavioural Guards": 5, "Compliance": 4,
})
// The SEMI cap must read 12% (never 15%) anywhere it is stated in the register.
for (const r of GOVERNANCE_RULES) {
  if (/\b15%/.test(r.description) && /SEMI/i.test(r.title)) {
    console.error(`  ✗ stale SEMI 15% cap in rule "${r.title}"`); failures++
  }
}

// ── Rule-register text must match the derived bands (prose ↔ constants) ───────
// The 5 "Healthy Range NN–MM%" rules embed numbers; assert they equal getGovernanceBandRow().
for (const ticker of ["VWRA", "EQQQ", "SEMI", "VFEA", "BTC"]) {
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

// ── DB seed ↔ constitution parity ────────────────────────────────────────────
// CORE_DEFAULTS is what actually populates the live-DB hard caps (via ensureCoreHoldings /
// syncHoldingFromTrades), and next-best-move trims off that DB value. If it drifts from
// HARD_THRESHOLDS / TICKER_TARGETS, the engines would enforce a cap the constitution never
// set — the one seed that was previously outside the contract-test net.
for (const t of ["VWRA", "EQQQ", "SEMI", "VFEA", "BTC", "IBIT"] as const) {
  eq(`seed hardCap ${t}`, CORE_DEFAULTS[t]?.hardCapPct, HARD_THRESHOLDS[t]?.high)
}
for (const t of ["VWRA", "EQQQ", "SEMI", "VFEA", "BTC"] as const) {
  eq(`seed target ${t}`, CORE_DEFAULTS[t]?.targetPct, TICKER_TARGETS[t])
}

if (failures === 0) {
  console.log("  ✓ All governance constants match the v6.7 document.\n")
  process.exit(0)
} else {
  console.error(`\n${failures} mismatch(es) found — code has drifted from the governance document.\n`)
  process.exit(1)
}
