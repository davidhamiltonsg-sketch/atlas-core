/**
 * Atlas Core — Art. XIII Ladder engine scenario checks (Constitution v1.5).
 *
 * Validates the 8-step ladder's precedence order and skip-rule placement.
 * Key test: skip rule fires at step 7 ONLY — not at step 2.
 *
 * Run:  npx tsx scripts/check-ladder.ts   (or: npm run check:ladder)
 * Exit: 0 = all pass · 1 = one or more failures
 */

import { computeLadder, type PositionInput, type LiveMarketPos } from "../lib/ladder"

let failures = 0
let passes   = 0

function expect(label: string, cond: boolean, detail?: string | null) {
  if (!cond) { console.error(`  ✗  ${label}${detail != null ? ` — ${detail}` : ""}`); failures++ }
  else       { console.log(`  ✓  ${label}`); passes++ }
}

// ─── Position factory ─────────────────────────────────────────────────────────
function pos(
  ticker: string,
  actualPct: number,
  targetPct: number,
  hardCapPct: number | null,
  toleranceBand = 5,
): PositionInput {
  return {
    ticker, name: ticker, color: "#000",
    value: actualPct * 100, actualPct, targetPct, hardCapPct,
    toleranceBand, latestPrice: 100,
  }
}

// ─── Market helpers ───────────────────────────────────────────────────────────
// mid: price at −8% of 52w high (neither overbought nor dip)
// top: price within 3% of 52w high (overbought — skip rule applies)
const mid: LiveMarketPos = { price: 92, lo52: 60, hi52: 100 }
const top: LiveMarketPos = { price: 99, lo52: 60, hi52: 100 }

function market(overrides: Record<string, LiveMarketPos> = {}): Record<string, LiveMarketPos> {
  const base: Record<string, LiveMarketPos> = {}
  for (const t of ["VT", "QQQM", "SMH", "VWO", "IBIT"]) base[t] = { ...mid }
  return { ...base, ...overrides }
}

// ─── Base healthy portfolio ───────────────────────────────────────────────────
const BASE = [
  pos("VT",   52, 52, 60),
  pos("QQQM", 23, 23, 30),
  pos("SMH",  10, 10, 12),
  pos("VWO",   8,  8, 13),
  pos("IBIT",  7,  7,  8),  // Bitcoin accumulation vehicle
  pos("SGOV",  8,  0, null), // buffer — targetPct 0 so step 2 never fires for it
]
const TOTAL = 100_000

console.log("Atlas Core — Art. XIII Ladder scenario checks (v1.5)\n")

// ─── 1. Healthy portfolio → Step 7, standard DCA ─────────────────────────────
{
  console.log("Step 7 — Standard DCA (healthy)")
  const r = computeLadder(BASE, TOTAL, { market: market() })
  expect("healthy → step 7", r.firedStep === 7, `got step ${r.firedStep}`)
  expect("healthy → no critical severity", r.severity === "none", r.severity)
  expect("healthy → isTerminal", r.isTerminal === true)
  expect("healthy → headline mentions DCA", r.headline.toLowerCase().includes("dca"))
  expect("step 1 passed", r.steps[0].status === "passed")
  expect("step 2 passed", r.steps[1].status === "passed")
  expect("step 5 passed", r.steps[4].status === "passed")
}

// ─── 2. VT underweight → Step 2, fill VT (skip rule does NOT block) ──────────
{
  console.log("\nStep 2 — Underweight redirect (skip rule must NOT block)")
  const positions = BASE.map(p =>
    p.ticker === "VT" ? { ...p, actualPct: 46, targetPct: 52 } : p
  )
  // VT is near its 52w high — in old engine, skip rule would have skipped VT.
  // In v1.1, step 2 fires and buys VT anyway (drift correction > entry timing).
  const r = computeLadder(positions, TOTAL, { market: market({ VT: top }) })
  expect("underweight → step 2 fires", r.firedStep === 2, `got step ${r.firedStep}`)
  expect("underweight → ticker is VT", r.ticker === "VT", r.ticker)
  expect("underweight → NOT step 7", r.firedStep !== 7)
  // Exception should be logged because VT is near 52w high
  expect("underweight + at high → exception logged", r.exceptions.length > 0, "no exception logged")
  expect("step 1 passed", r.steps[0].status === "passed")
}

// ─── 3. Skip rule fires at step 7 — QQQM at 52w high, VT is the redirect ────
{
  console.log("\nStep 7 — Skip rule fires for QQQM-at-high")
  // All positions exactly at target (step 2 does NOT fire)
  const r = computeLadder(BASE, TOTAL, { market: market({ QQQM: top }) })
  expect("skip → step 7 fires", r.firedStep === 7, `got step ${r.firedStep}`)
  expect("skip → ticker is VT (redirect)", r.ticker === "VT", r.ticker ?? "null")
  expect("skip → headline mentions DCA", r.headline.toLowerCase().includes("dca"))
  expect("skip → exception logged for QQQM", r.exceptions.some(e => e.includes("QQQM")))
  expect("skip → isTerminal", r.isTerminal)
}

// ─── 4. SMH over 12% hard cap → Step 1, TRIM ─────────────────────────────────
{
  console.log("\nStep 1 — SMH over 12% hard cap")
  const positions = BASE.map(p =>
    p.ticker === "SMH" ? { ...p, actualPct: 14 } : p
  )
  const r = computeLadder(positions, TOTAL, { market: market() })
  expect("SMH cap → step 1 fires", r.firedStep === 1, `got step ${r.firedStep}`)
  expect("SMH cap → severity critical", r.severity === "critical")
  expect("SMH cap → ticker SMH", r.ticker === "SMH", r.ticker)
  // Step 2 must NOT be reached
  expect("SMH cap → step 2 not_reached", r.steps[1].status === "not_reached")
}

// ─── 5. QQQM over 30% hard cap → Step 1, TRIM ────────────────────────────────
{
  console.log("\nStep 1 — QQQM over 30% hard cap")
  const positions = BASE.map(p =>
    p.ticker === "QQQM" ? { ...p, actualPct: 32 } : p
  )
  const r = computeLadder(positions, TOTAL, { market: market() })
  expect("QQQM cap → step 1 fires", r.firedStep === 1, `got step ${r.firedStep}`)
  expect("QQQM cap → severity critical", r.severity === "critical")
  expect("QQQM cap → ticker QQQM", r.ticker === "QQQM", r.ticker)
}

// ─── 6. Combined tech ≥ 42% → Step 1, TRIM SMH ───────────────────────────────
{
  console.log("\nStep 1 — Combined tech ≥ 42%")
  const positions = BASE.map(p => {
    if (p.ticker === "QQQM") return { ...p, actualPct: 30 }
    if (p.ticker === "SMH")  return { ...p, actualPct: 12 }
    return p
  })
  const r = computeLadder(positions, TOTAL, { market: market() })
  expect("combined tech → step 1 fires", r.firedStep === 1, `got step ${r.firedStep}`)
  expect("combined tech → severity critical", r.severity === "critical")
  expect("combined tech → trim SMH", r.ticker === "SMH", r.ticker)
}

// ─── 7. Look-through hard breach → Step 1, TRIM ──────────────────────────────
{
  console.log("\nStep 1 — Look-through hard breach (NVIDIA)")
  const r = computeLadder(BASE, TOTAL, {
    market: market(),
    lookThroughHardBreach: { label: "NVIDIA exposure", pct: 14.2, hard: 13, trimTicker: "SMH" },
  })
  expect("look-through → step 1 fires", r.firedStep === 1, `got step ${r.firedStep}`)
  expect("look-through → severity critical", r.severity === "critical")
  expect("look-through → trim SMH", r.ticker === "SMH", r.ticker)
}

// ─── 8. SGOV below 8% floor → Step 5, build SGOV ─────────────────────────────
{
  console.log("\nStep 5 — SGOV below floor")
  // All positions at exact target (step 2 doesn't fire), SGOV < 8%
  const positions = BASE.map(p =>
    p.ticker === "SGOV" ? { ...p, actualPct: 5 } : p
  )
  const r = computeLadder(positions, TOTAL, { market: market() })
  expect("SGOV low → step 5 fires", r.firedStep === 5, `got step ${r.firedStep}`)
  expect("SGOV low → severity high", r.severity === "high")
  expect("SGOV low → ticker SGOV", r.ticker === "SGOV", r.ticker)
  expect("step 2 passed", r.steps[1].status === "passed")
  expect("step 3 passed", r.steps[2].status === "passed")
}

// ─── 9. Portfolio drawdown > 25% → Step 6, crash protocol ───────────────────
{
  console.log("\nStep 6 — Portfolio drawdown")
  const r = computeLadder(BASE, TOTAL, {
    market: market(),
    portfolioDrawdownPct: -30,
  })
  expect("drawdown → step 6 fires", r.firedStep === 6, `got step ${r.firedStep}`)
  expect("drawdown → severity high", r.severity === "high")
  expect("drawdown → ticker null", r.ticker === null, r.ticker)
  expect("step 5 passed", r.steps[4].status === "passed")
}

// ─── 10. BTC sleeve over cycle cap → Step 1, TRIM ────────────────────────────
{
  console.log("\nStep 1 — BTC sleeve over cycle cap")
  // Normal phase: cap = 8%. BTC=5%, IBIT=5% → sleeve = 10% → over cap
  const positions = BASE.map(p => {
    if (p.ticker === "IBIT") return { ...p, actualPct: 9 }  // sleeve = 9%
    return p
  })
  const r = computeLadder(positions, TOTAL, { market: market() })
  expect("BTC sleeve → step 1 fires", r.firedStep === 1, `got step ${r.firedStep}`)
  expect("BTC sleeve → severity critical", r.severity === "critical")
}

// Note: SMH at 16% IS over its 12% hard cap, so step 1 fires — not step 3.
// Step 3 is only reachable when a position is above its soft band but under its hard cap.
// Test with QQQM soft overweight (29% is above target+band=28% but under 30% cap).
{
  console.log("\nStep 3 — Overweight redirect (QQQM soft overweight)")
  const positions = [
    pos("VT",   52, 52, 60),
    pos("QQQM", 29, 23, 30, 5),  // 29% is above target+band=28% but under 30% cap
    pos("SMH",  10, 10, 12),
    pos("VWO",   8,  8, 13),
    pos("IBIT",  7,  7,  8),
    pos("SGOV",  8,  0, null),
  ]
  const r = computeLadder(positions, TOTAL, { market: market() })
  expect("QQQM soft overweight → step 3 fires", r.firedStep === 3, `got step ${r.firedStep}`)
  expect("QQQM overweight → redirect away from QQQM", r.ticker !== "QQQM", r.ticker)
  expect("step 1 passed", r.steps[0].status === "passed")
  expect("step 2 passed", r.steps[1].status === "passed")
}

// ─── 12. Zero balance → step 8 terminal ──────────────────────────────────────
{
  console.log("\nStep 8 — Zero balance")
  const r = computeLadder(BASE, 0)
  expect("zero balance → step 8 fires", r.firedStep === 8, `got step ${r.firedStep}`)
  expect("zero balance → isTerminal", r.isTerminal)
  expect("zero balance → severity none", r.severity === "none")
}

// ─── 13. Look-through soft warning — non-terminal, DCA continues ─────────────
{
  console.log("\nStep 4 — Look-through soft warning (non-terminal)")
  const r = computeLadder(BASE, TOTAL, {
    market: market(),
    lookThroughSoftWarning: { label: "Broadcom exposure", pct: 5.8, soft: 5 },
  })
  expect("soft warning → does NOT fire step 1", r.firedStep !== 1)
  expect("soft warning → continues to step 7", r.firedStep === 7, `got step ${r.firedStep}`)
  expect("soft warning → step 4 is warning", r.steps[3].status === "warning")
  expect("soft warning → exception logged", r.exceptions.some(e => e.includes("Broadcom")))
  expect("soft warning → standard DCA continues", r.headline.toLowerCase().includes("dca"))
}

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(54)}`)
if (failures === 0) {
  console.log(`  All ${passes} checks passed. Art. XIII Ladder v1.5 ✓`)
  process.exit(0)
} else {
  console.error(`  ${failures} check(s) failed, ${passes} passed.`)
  process.exit(1)
}
