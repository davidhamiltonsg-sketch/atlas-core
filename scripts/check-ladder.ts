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
  for (const t of ["VWRA", "EQQQ", "SEMI", "VFEA", "IBIT"]) base[t] = { ...mid }
  return { ...base, ...overrides }
}

// ─── Base healthy portfolio ───────────────────────────────────────────────────
const BASE = [
  pos("VWRA", 52, 52, 60),
  pos("EQQQ", 23, 23, 30),
  pos("SEMI", 10, 10, 12),
  pos("VFEA",  8,  8, 13),
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

// ─── 2. VWRA underweight → Step 2, fill VWRA (skip rule does NOT block) ──────────
{
  console.log("\nStep 2 — Underweight redirect (skip rule must NOT block)")
  const positions = BASE.map(p =>
    p.ticker === "VWRA" ? { ...p, actualPct: 46, targetPct: 52 } : p
  )
  // VWRA is near its 52w high — in old engine, skip rule would have skipped VWRA.
  // In v1.1, step 2 fires and buys VWRA anyway (drift correction > entry timing).
  const r = computeLadder(positions, TOTAL, { market: market({ VWRA: top }) })
  expect("underweight → step 2 fires", r.firedStep === 2, `got step ${r.firedStep}`)
  expect("underweight → ticker is VWRA", r.ticker === "VWRA", r.ticker)
  expect("underweight → NOT step 7", r.firedStep !== 7)
  // Exception should be logged because VWRA is near 52w high
  expect("underweight + at high → exception logged", r.exceptions.length > 0, "no exception logged")
  expect("step 1 passed", r.steps[0].status === "passed")
}

// ─── 3. Skip rule fires at step 7 — EQQQ at 52w high, VWRA is the redirect ────
{
  console.log("\nStep 7 — Skip rule fires for EQQQ-at-high")
  // All positions exactly at target (step 2 does NOT fire)
  const r = computeLadder(BASE, TOTAL, { market: market({ EQQQ: top }) })
  expect("skip → step 7 fires", r.firedStep === 7, `got step ${r.firedStep}`)
  expect("skip → ticker is VWRA (redirect)", r.ticker === "VWRA", r.ticker ?? "null")
  expect("skip → headline mentions DCA", r.headline.toLowerCase().includes("dca"))
  expect("skip → exception logged for EQQQ", r.exceptions.some(e => e.includes("EQQQ")))
  expect("skip → isTerminal", r.isTerminal)
}

// ─── 4. SEMI over 12% hard cap → Step 1, TRIM ─────────────────────────────────
{
  console.log("\nStep 1 — SEMI over 12% hard cap")
  const positions = BASE.map(p =>
    p.ticker === "SEMI" ? { ...p, actualPct: 14 } : p
  )
  const r = computeLadder(positions, TOTAL, { market: market() })
  expect("SEMI cap → step 1 fires", r.firedStep === 1, `got step ${r.firedStep}`)
  expect("SEMI cap → severity critical", r.severity === "critical")
  expect("SEMI cap → ticker SEMI", r.ticker === "SEMI", r.ticker)
  // Step 2 must NOT be reached
  expect("SEMI cap → step 2 not_reached", r.steps[1].status === "not_reached")
}

// ─── 5. EQQQ over 30% hard cap → Step 1, TRIM ────────────────────────────────
{
  console.log("\nStep 1 — EQQQ over 30% hard cap")
  const positions = BASE.map(p =>
    p.ticker === "EQQQ" ? { ...p, actualPct: 32 } : p
  )
  const r = computeLadder(positions, TOTAL, { market: market() })
  expect("EQQQ cap → step 1 fires", r.firedStep === 1, `got step ${r.firedStep}`)
  expect("EQQQ cap → severity critical", r.severity === "critical")
  expect("EQQQ cap → ticker EQQQ", r.ticker === "EQQQ", r.ticker)
}

// ─── 6. Combined tech ≥ 42% → Step 1, TRIM SEMI ───────────────────────────────
{
  console.log("\nStep 1 — Combined tech ≥ 42%")
  const positions = BASE.map(p => {
    if (p.ticker === "EQQQ") return { ...p, actualPct: 30 }
    if (p.ticker === "SEMI") return { ...p, actualPct: 12 }
    return p
  })
  const r = computeLadder(positions, TOTAL, { market: market() })
  expect("combined tech → step 1 fires", r.firedStep === 1, `got step ${r.firedStep}`)
  expect("combined tech → severity critical", r.severity === "critical")
  expect("combined tech → trim SEMI", r.ticker === "SEMI", r.ticker)
}

// ─── 7. Look-through hard breach → Step 1, TRIM ──────────────────────────────
{
  console.log("\nStep 1 — Look-through hard breach (NVIDIA)")
  const r = computeLadder(BASE, TOTAL, {
    market: market(),
    lookThroughHardBreach: { label: "NVIDIA exposure", pct: 14.2, hard: 13, trimTicker: "SEMI" },
  })
  expect("look-through → step 1 fires", r.firedStep === 1, `got step ${r.firedStep}`)
  expect("look-through → severity critical", r.severity === "critical")
  expect("look-through → trim SEMI", r.ticker === "SEMI", r.ticker)
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

// Note: SEMI at 16% IS over its 12% hard cap, so step 1 fires — not step 3.
// Step 3 is only reachable when a position is above its soft band but under its hard cap.
// Test with EQQQ soft overweight (29% is above target+band=28% but under 30% cap).
{
  console.log("\nStep 3 — Overweight redirect (EQQQ soft overweight)")
  const positions = [
    pos("VWRA", 52, 52, 60),
    pos("EQQQ", 29, 23, 30, 5),  // 29% is above target+band=28% but under 30% cap
    pos("SEMI", 10, 10, 12),
    pos("VFEA",  8,  8, 13),
    pos("IBIT",  7,  7,  8),
    pos("SGOV",  8,  0, null),
  ]
  const r = computeLadder(positions, TOTAL, { market: market() })
  expect("EQQQ soft overweight → step 3 fires", r.firedStep === 3, `got step ${r.firedStep}`)
  expect("EQQQ overweight → redirect away from EQQQ", r.ticker !== "EQQQ", r.ticker)
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

// ─── 14. VWRA over 60% hard cap → Step 1, TRIM VWRA ──────────────────────────────
{
  console.log("\nStep 1 — VWRA over 60% hard cap")
  const positions = BASE.map(p => p.ticker === "VWRA" ? { ...p, actualPct: 62 } : p)
  const r = computeLadder(positions, TOTAL, { market: market() })
  expect("VWRA cap → step 1 fires", r.firedStep === 1, `got step ${r.firedStep}`)
  expect("VWRA cap → severity critical", r.severity === "critical")
  expect("VWRA cap → ticker VWRA", r.ticker === "VWRA", r.ticker)
  expect("VWRA cap → step 2 not_reached", r.steps[1].status === "not_reached")
}

// ─── 15. VFEA over 13% hard cap → Step 1, TRIM VFEA ────────────────────────────
{
  console.log("\nStep 1 — VFEA over 13% hard cap")
  const positions = BASE.map(p => p.ticker === "VFEA" ? { ...p, actualPct: 14 } : p)
  const r = computeLadder(positions, TOTAL, { market: market() })
  expect("VFEA cap → step 1 fires", r.firedStep === 1, `got step ${r.firedStep}`)
  expect("VFEA cap → severity critical", r.severity === "critical")
  expect("VFEA cap → ticker VFEA", r.ticker === "VFEA", r.ticker)
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
