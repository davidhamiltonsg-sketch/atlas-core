/**
 * Silicon Brick Road — Constitution v2.3 contract check.
 *
 * SBR's numbers previously had no guard (unlike Atlas Core's check-governance/constitution).
 * This asserts the SILICON_BRICK_ROAD registry constants still match the v2.3 document:
 * fund targets/ranges/caps, the combined EQQQ+SEMI ceiling, total-equity ceiling, drawdown
 * trigger, skip-at-high threshold, and the phase value thresholds. Pure constant comparison —
 * no DB, no network.
 *
 * Run:  npx tsx scripts/check-sbr.ts   (or: npm run check:sbr)
 * Exit: 0 = all aligned · 1 = one or more mismatches (prints each).
 */
import { SILICON_BRICK_ROAD as SBR } from "../lib/constitutions"
import { computeSbrNextMove, computeSbrDca, type SbrPosition } from "../lib/sbr-engine"
import { computeSbrLookThrough, SBR_TECHNOLOGY_LIMIT, SBR_SINGLE_COMPANY_LIMIT } from "../lib/sbr-look-through"
import { sbrBlendedGrowthRate, monthsToTarget, SBR_ASSET_EXPECTED_RETURNS } from "../lib/sbr-forecast"

let failures = 0
let passes = 0
function eq(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) { console.error(`  ✗  ${label}\n       expected: ${e}\n       got:      ${a}`); failures++ }
  else { console.log(`  ✓  ${label}`); passes++ }
}

console.log("Silicon Brick Road — Constitution v2.3 contract check\n")

// ── Version pin ───────────────────────────────────────────────────────────────
eq("version", SBR.version, "2.3")
eq("currency", SBR.currency, "SGD")
eq("monthly contribution", SBR.monthlyContribution, 1000)
eq("target value (SGD)", SBR.targetValue, 120000)

// ── Fund targets / ranges / caps (Article VII) ────────────────────────────────
const fund = (t: string) => SBR.funds.find((f) => f.ticker === t)!
console.log("\nArt. VII — Funds")
eq("VWRA target/range/cap", [fund("VWRA").target, fund("VWRA").rangeLow, fund("VWRA").rangeHigh, fund("VWRA").hardCap], [50, 44, 56, 62])
eq("EQQQ target/range/cap", [fund("EQQQ").target, fund("EQQQ").rangeLow, fund("EQQQ").rangeHigh, fund("EQQQ").hardCap], [25, 20, 30, 30])
eq("SEMI target/range/cap", [fund("SEMI").target, fund("SEMI").rangeLow, fund("SEMI").rangeHigh, fund("SEMI").hardCap], [15, 11, 19, 20])
eq("A35  target/range/floor", [fund("A35").target, fund("A35").rangeLow, fund("A35").rangeHigh, fund("A35").hardCap, fund("A35").floor], [10, 7, 13, null, 7])

// ── Combined tech ceiling (Article IX) ────────────────────────────────────────
console.log("\nArt. IX — Combined EQQQ+SEMI ceiling")
eq("combined tickers", SBR.combined?.tickers, ["EQQQ", "SEMI"])
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
eq("Phase II  range", [phase("II")?.min,  phase("II")?.max],  [72000, 96000])
eq("Phase III range", [phase("III")?.min, phase("III")?.max], [96000, 114000])
eq("Phase IV  range", [phase("IV")?.min,  phase("IV")?.max],  [114000, null])
eq("Phase I selling",   phase("I")?.selling,   false)
eq("Phase III selling", phase("III")?.selling, true)
eq("Phase IV selling",  phase("IV")?.selling,  false)

// ── Two-engine routing characterization (Article VI) ──────────────────────────
// The headline instruction (computeSbrNextMove) and the money-split (computeSbrDca) encode
// the SAME ladder in two independently-written functions. This grid pins, for every ladder
// branch plus its boundaries and priority ties, which fund each engine routes to — so the two
// can never silently diverge, and so the planned unification behind a single decide() can be
// refactored UNDER this net (a merge that changes any routing fails here). Total is set per
// scenario to select the intended phase.
console.log("\nArt. VI — Two-engine routing characterization")
const TOTAL = 50_000 // Phase I default
// Build a position whose SGD value reflects `total` — computeSbrDca derives the phase from the
// sum of position values, so a phase scenario must scale values to that total, not just pass it
// to the headline engine. sp() defaults to the Phase-I total.
function spAt(total: number, ticker: string, actualPct: number, hi52 = 0): SbrPosition {
  const f = fund(ticker)
  return {
    ticker, name: ticker, color: "#000", value: (actualPct / 100) * total, actualPct,
    targetPct: f.target, rangeLow: f.rangeLow, rangeHigh: f.rangeHigh,
    hardCap: f.hardCap, floor: f.floor, latestPrice: 100, hi52,
  }
}
function sp(ticker: string, actualPct: number, hi52 = 0): SbrPosition {
  return spAt(TOTAL, ticker, actualPct, hi52)
}
// hi52 = 101 with latestPrice 100 → 0.99% below the 52-week high, inside the 3% skip band.
const NEAR_HIGH = 101
// Primary destination of the split = the fund receiving the most money.
function dcaPrimary(plan: { allocations: { ticker: string; amount: number }[] }): string {
  return plan.allocations.reduce((best, a) => (a.amount > (best?.amount ?? -1) ? a : best),
    null as { ticker: string; amount: number } | null)?.ticker ?? "?"
}
function nm(positions: SbrPosition[], total = TOTAL, opts: { drawdownPct?: number } = {}) {
  return computeSbrNextMove(positions, total, opts)
}
function primary(positions: SbrPosition[], opts: { drawdownPct?: number } = {}) {
  return dcaPrimary(computeSbrDca(positions, SBR.monthlyContribution, opts))
}
// Both engines route to `expected`, and the headline carries `severity`.
function agree(label: string, positions: SbrPosition[], total: number, opts: { drawdownPct?: number }, expected: string, severity: string) {
  const h = nm(positions, total, opts)
  eq(`${label} — headline ${expected}/${severity}`, [h.ticker, h.severity], [expected, severity])
  eq(`${label} — split → ${expected}`, primary(positions, opts), expected)
}

// ---- Every branch of the ladder, isolated so only the tested branch fires ----
// 1 — empty portfolio → headline is the first-contribution nudge (VWRA).
eq("empty → first contribution", [nm([sp("VWRA", 0)], 0).ticker, nm([sp("VWRA", 0)], 0).severity], ["VWRA", "none"])
// 2 — SEMI > 20% cap: headline SELLS SEMI (critical); the split must never buy MORE SEMI.
{
  const p = [sp("VWRA", 51), sp("EQQQ", 15), sp("SEMI", 22), sp("A35", 12)]
  eq("SEMI>20% — headline sells SEMI", [nm(p).ticker, nm(p).severity], ["SEMI", "critical"])
  eq("SEMI>20% — split never buys more SEMI", primary(p) !== "SEMI", true)
}
// 3 — combined EQQQ+SEMI over the 45% hard ceiling → both buy VWRA (critical).
agree("combined 46 (hard)", [sp("VWRA", 39), sp("EQQQ", 30), sp("SEMI", 16), sp("A35", 15)], TOTAL, {}, "VWRA", "critical")
// 4 — combined in the 40–45 warning band → both buy VWRA (medium).
agree("combined 42 (warning)", [sp("VWRA", 43), sp("EQQQ", 27), sp("SEMI", 15), sp("A35", 15)], TOTAL, {}, "VWRA", "medium")
// 5 — A35 below its 7% floor → both top up A35 (high).
agree("A35 below floor", [sp("VWRA", 61), sp("EQQQ", 22), sp("SEMI", 12), sp("A35", 5)], TOTAL, {}, "A35", "high")
// 6 — Phase III (SGD 102–114k) → both route to A35 (high). Values scaled to the phase total so
// the split engine (which reads the phase from summed position values) sees Phase III too.
agree("Phase III", [spAt(108_000, "VWRA", 50), spAt(108_000, "EQQQ", 22), spAt(108_000, "SEMI", 13), spAt(108_000, "A35", 15)], 108_000, {}, "A35", "high")
// 7 — Phase IV (above SGD 114k) → both route to A35 (high).
agree("Phase IV", [spAt(118_000, "VWRA", 50), spAt(118_000, "EQQQ", 22), spAt(118_000, "SEMI", 13), spAt(118_000, "A35", 15)], 118_000, {}, "A35", "high")
// 8 — drawdown past −15% (nothing higher firing) → both buy VWRA (high).
agree("drawdown −20", [sp("VWRA", 55), sp("EQQQ", 22), sp("SEMI", 12), sp("A35", 11)], TOTAL, { drawdownPct: -20 }, "VWRA", "high")
// 9 — a fund below its range → both fill that fund (medium).
agree("SEMI underweight", [sp("VWRA", 57), sp("EQQQ", 22), sp("SEMI", 8), sp("A35", 13)], TOTAL, {}, "SEMI", "medium")
// 9b — two funds under range → both fill the FURTHEST-below one (VWRA −4 beats EQQQ −2).
agree("furthest-underweight wins", [sp("VWRA", 40), sp("EQQQ", 18), sp("SEMI", 15), sp("A35", 27)], TOTAL, {}, "VWRA", "medium")

// ---- Known asymmetry the unification should resolve, pinned so it can't drift silently ----
// 10 — skip-at-high: EQQQ in range but within 3% of its high. The headline NAMES the skipped
// fund (EQQQ, low severity) while the split redirects the money to VWRA. Two different meanings
// of "the fund", pinned deliberately.
{
  const p = [sp("VWRA", 50), sp("EQQQ", 25, NEAR_HIGH), sp("SEMI", 13), sp("A35", 12)]
  eq("skip-at-high — headline names skipped EQQQ", [nm(p).ticker, nm(p).severity], ["EQQQ", "low"])
  eq("skip-at-high — split redirects to VWRA", primary(p), "VWRA")
}
// 11 — all in range, none near high, no drawdown → standard split. Headline is ALL (none);
// the proportional split's largest share is VWRA (target 50%).
{
  const p = [sp("VWRA", 50), sp("EQQQ", 25), sp("SEMI", 13), sp("A35", 12)]
  eq("standard — headline ALL/none", [nm(p).ticker, nm(p).severity], ["ALL", "none"])
  eq("standard — split largest is VWRA", primary(p), "VWRA")
}

// ---- Boundary conditions: the ≥ / > edges where two hand-written ladders most easily diverge ----
// combined exactly 40 → warning fires (≥). combined exactly 45 → still warning, NOT hard (>45).
agree("combined == 40 → warning", [sp("VWRA", 45), sp("EQQQ", 25), sp("SEMI", 15), sp("A35", 15)], TOTAL, {}, "VWRA", "medium")
agree("combined == 45 → warning not hard", [sp("VWRA", 40), sp("EQQQ", 30), sp("SEMI", 15), sp("A35", 15)], TOTAL, {}, "VWRA", "medium")
// A35 exactly 7 → NOT below floor (floor is <7, strict); A35=6 → floor fires.
eq("A35 == 7 → not floor branch", nm([sp("VWRA", 52), sp("EQQQ", 22), sp("SEMI", 12), sp("A35", 7)]).severity, "none")
agree("A35 == 6 → floor fires", [sp("VWRA", 59), sp("EQQQ", 22), sp("SEMI", 13), sp("A35", 6)], TOTAL, {}, "A35", "high")
// SEMI exactly 20 → NOT over cap (cap is >20).
eq("SEMI == 20 → no forced sell", nm([sp("VWRA", 52), sp("EQQQ", 16), sp("SEMI", 20), sp("A35", 12)]).ticker !== "SEMI", true)

// ---- Priority ties: when two conditions hold, the SAME higher rule wins in BOTH engines ----
// combined>45 beats drawdown → critical VWRA (not the drawdown's high).
agree("combined>45 beats drawdown", [sp("VWRA", 34), sp("EQQQ", 30), sp("SEMI", 16), sp("A35", 20)], TOTAL, { drawdownPct: -20 }, "VWRA", "critical")
// A35 floor beats drawdown → both A35 (high).
agree("A35 floor beats drawdown", [sp("VWRA", 61), sp("EQQQ", 22), sp("SEMI", 12), sp("A35", 5)], TOTAL, { drawdownPct: -20 }, "A35", "high")
// Drift beats skip-at-high on the SAME fund: EQQQ under range AND near its high → both FILL
// EQQQ (this is the "drift correction wins" reconciliation, the whole point of ladder step 6).
agree("drift beats skip on EQQQ", [sp("VWRA", 57), sp("EQQQ", 18, NEAR_HIGH), sp("SEMI", 13), sp("A35", 12)], TOTAL, {}, "EQQQ", "medium")

// ── Hidden-exposure look-through (Article XVII) ───────────────────────────────
console.log("\nArt. XVII — Hidden-exposure look-through")
eq("technology limit", SBR_TECHNOLOGY_LIMIT, 45)
eq("single-company limit", SBR_SINGLE_COMPANY_LIMIT, 10)
// A heavy tech tilt (lots of EQQQ + SEMI) must be flagged over both limits; the on-target mix
// must be clear. Positions carry only ticker + actualPct for the look-through.
const heavy = computeSbrLookThrough([{ ticker: "VWRA", actualPct: 30 }, { ticker: "EQQQ", actualPct: 35 }, { ticker: "SEMI", actualPct: 25 }, { ticker: "A35", actualPct: 10 }])
eq("heavy tilt → over technology limit", heavy.technologyOver, true)
eq("heavy tilt → biggest single company is Nvidia", heavy.topCompany.name, "Nvidia")
// The single-company 10% limit stays satisfied even on a heavy tilt — the SEMI 20% fund cap
// bounds the largest holding (Nvidia) below 10%, which is exactly what the limit guards.
eq("heavy tilt → single-company still within limit", heavy.singleCompanyOver, false)
const onTarget = computeSbrLookThrough([{ ticker: "VWRA", actualPct: 50 }, { ticker: "EQQQ", actualPct: 25 }, { ticker: "SEMI", actualPct: 15 }, { ticker: "A35", actualPct: 10 }])
eq("on-target → within technology limit", onTarget.technologyOver, false)
eq("on-target → within single-company limit", onTarget.singleCompanyOver, false)

// ── Time-to-goal forecast (lib/sbr-forecast.ts) ───────────────────────────────
console.log("\nTime-to-goal forecast")
{
  const vwra = sbrBlendedGrowthRate({ VWRA: 100 })
  eq("100% VWRA → base matches VWRA's own rate", vwra.base, SBR_ASSET_EXPECTED_RETURNS.VWRA.base)
  const a35 = sbrBlendedGrowthRate({ A35: 100 })
  eq("100% A35 → base matches A35's own rate", a35.base, SBR_ASSET_EXPECTED_RETURNS.A35.base)

  const mix = sbrBlendedGrowthRate({ VWRA: 50, EQQQ: 25, SEMI: 15, A35: 10 })
  const heldBase = ["VWRA", "EQQQ", "SEMI", "A35"].map((t) => SBR_ASSET_EXPECTED_RETURNS[t].base)
  eq("on-target mix → base within [min, max] of held funds' rates",
    mix.base >= Math.min(...heldBase) && mix.base <= Math.max(...heldBase), true)

  eq("already at target → 0 months", monthsToTarget(120000, 2000, 0.07, 120000), 0)
  eq("zero rate, exact arithmetic → 2 months for $2000 at $1000/mo", monthsToTarget(0, 1000, 0, 2000), 2)

  const slow = monthsToTarget(10000, 2000, 0.03, 120000)!
  const fast = monthsToTarget(10000, 2000, 0.12, 120000)!
  eq("higher growth rate → fewer (or equal) months to target", fast <= slow, true)
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(54)}`)
if (failures === 0) { console.log(`  All ${passes} checks passed. Silicon Brick Road v2.3 ✓`); process.exit(0) }
else { console.error(`  ${failures} check(s) failed, ${passes} passed.`); process.exit(1) }
