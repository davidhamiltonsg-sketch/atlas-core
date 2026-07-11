/**
 * Atlas Core — Forecast math contract checks.
 *
 * Asserts the shared forecast module (lib/forecast.ts) blends growth-rate assumptions
 * correctly from actual portfolio composition, and that the compounding projection itself
 * is arithmetically correct. Pure function calls — no DB, no network.
 *
 * Run:  npx tsx scripts/check-forecast.ts   (or: npm run check:forecast)
 */
import { ASSET_EXPECTED_RETURNS, blendedGrowthRates, projectPortfolio } from "../lib/forecast"

let failures = 0
function expect(label: string, cond: boolean, detail?: string) {
  if (!cond) { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); failures++ }
  else console.log(`  ✓ ${label}`)
}
function close(a: number, b: number, eps = 1e-9) {
  return Math.abs(a - b) < eps
}

console.log("Atlas Core — forecast math checks\n")

// 1) 100% VWRA → blend equals VWRA's own assumption exactly, in all three scenarios.
{
  const { rates } = blendedGrowthRates({ VWRA: 100 }, 0.04)
  expect("100% VWRA → conservative matches VWRA", close(rates.conservative, ASSET_EXPECTED_RETURNS.VWRA.conservative))
  expect("100% VWRA → base matches VWRA", close(rates.base, ASSET_EXPECTED_RETURNS.VWRA.base))
  expect("100% VWRA → aggressive matches VWRA", close(rates.aggressive, ASSET_EXPECTED_RETURNS.VWRA.aggressive))
}

// 2) 100% SGOV (buffer) → blend equals the user's own risk-free-rate assumption everywhere.
{
  const { rates } = blendedGrowthRates({ SGOV: 100 }, 0.045)
  expect("100% SGOV → conservative = risk-free rate", close(rates.conservative, 0.045))
  expect("100% SGOV → base = risk-free rate", close(rates.base, 0.045))
  expect("100% SGOV → aggressive = risk-free rate", close(rates.aggressive, 0.045))
}

// 3) Mixed portfolio → each scenario's blend is bounded by the min/max of its held assets'
//    rates (a weighted average can never fall outside the range of its inputs).
{
  const alloc = { VWRA: 52, EQQQ: 23, SEMI: 10, VFEA: 8, BTC: 7 }
  const { rates } = blendedGrowthRates(alloc, 0.04)
  for (const key of ["conservative", "base", "aggressive"] as const) {
    const heldRates = Object.keys(alloc).map((t) => ASSET_EXPECTED_RETURNS[t][key])
    const lo = Math.min(...heldRates)
    const hi = Math.max(...heldRates)
    expect(`mixed portfolio — ${key} within [min, max] of held-asset rates`,
      rates[key] >= lo - 1e-9 && rates[key] <= hi + 1e-9,
      `got ${rates[key]}, range [${lo}, ${hi}]`)
  }
}

// 4) Heavier BTC allocation raises the aggressive rate (BTC.aggressive > VWRA.aggressive).
{
  const { rates: lightBtc } = blendedGrowthRates({ VWRA: 90, BTC: 10 }, 0.04)
  const { rates: heavyBtc }  = blendedGrowthRates({ VWRA: 60, BTC: 40 }, 0.04)
  expect("more BTC weight → higher aggressive rate", heavyBtc.aggressive > lightBtc.aggressive,
    `light=${lightBtc.aggressive} heavy=${heavyBtc.aggressive}`)
}

// 5) Changing the risk-free rate shifts the blend proportionally to the buffer weight.
{
  const alloc = { VWRA: 50, SGOV: 50 }
  const { rates: low }  = blendedGrowthRates(alloc, 0.02)
  const { rates: high } = blendedGrowthRates(alloc, 0.06)
  const expectedDelta = 0.5 * (0.06 - 0.02) // 50% weight on the buffer bucket
  expect("risk-free-rate change shifts the blend by its buffer weight",
    close(high.base - low.base, expectedDelta, 1e-6),
    `delta=${high.base - low.base}, expected=${expectedDelta}`)
}

// 6) Empty allocation (no holdings yet) → falls back to the prior static defaults
//    (5% / 10% / 15%), so a brand-new user sees the same numbers the old static version showed.
{
  const { rates } = blendedGrowthRates({}, 0.04)
  expect("no holdings → conservative fallback 5%", close(rates.conservative, 0.05))
  expect("no holdings → base fallback 10%", close(rates.base, 0.10))
  expect("no holdings → aggressive fallback 15%", close(rates.aggressive, 0.15))
}

// 7) Unknown ticker is excluded, not silently zeroed — a portfolio with one recognized and
//    one unrecognized ticker renormalizes over the known weight instead of understating it.
{
  const { rates, excludedTickers } = blendedGrowthRates({ VWRA: 50, ZZZZ: 50 }, 0.04)
  expect("unknown ticker excluded → blend equals the known ticker's own rate",
    close(rates.base, ASSET_EXPECTED_RETURNS.VWRA.base), `got ${rates.base}`)
  expect("unknown ticker reported in excludedTickers",
    excludedTickers.length === 1 && excludedTickers[0] === "ZZZZ",
    `got [${excludedTickers}]`)
}

// 8) projectPortfolio — no growth, no contributions: value never changes.
{
  const v = projectPortfolio(1000, 0, 0, 0, 5, 0)
  expect("no growth, no contributions → value unchanged", close(v, 1000), `got ${v}`)
}

// 9) projectPortfolio — pure contributions, zero growth, one year: 12 × monthly, no compounding.
{
  const v = projectPortfolio(0, 100, 0, 0, 1, 0)
  expect("zero growth, 1yr of $100/mo → exactly $1200", close(v, 1200), `got ${v}`)
}

// 10) projectPortfolio — annual lump sum applied every year including the first.
{
  const v = projectPortfolio(0, 0, 500, 0, 3, 0)
  expect("zero growth, $500 lump sum × 3yr → exactly $1500", close(v, 1500), `got ${v}`)
}

if (failures === 0) { console.log("\n  ✓ All forecast checks passed.\n"); process.exit(0) }
else { console.error(`\n${failures} forecast check(s) failed.\n`); process.exit(1) }
