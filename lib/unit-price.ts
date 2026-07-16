// ─────────────────────────────────────────────────────────────────────────────
// Per-unit price discipline — Snapshot.price carries NO currency guarantee.
//
// Writers store different things in Snapshot.price: the IBKR sync writes the
// instrument-currency mark (USD/EUR/GBp), the Yahoo refresh writes the trading-
// currency quote, manual entry stores whatever was typed, and the screenshot
// importer has historically written SGD-converted figures (the "$190 VWRA =
// US$141 × 1.35" incident). Snapshot.value, by contrast, is always SGD and is
// the authoritative figure everywhere.
//
// Two rules follow (pure functions, safe for client and server components):
//   DISPLAY — derive, don't trust: show value/units as an S$ per-unit price.
//   WRITE   — keep value authoritative: if the price being written cannot
//             reproduce the SGD value under either currency reading, store the
//             value-consistent figure instead (valueConsistentPrice).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SGD per-unit price derived from the SAME snapshot's value/units — the only
 * per-unit figure that is safe to display with an S$ label. Returns null when
 * derivation is impossible (no units / no value); callers then fall back to the
 * raw stored price with an honest, currency-neutral label.
 */
export function sgdUnitPrice(units?: number | null, valueSgd?: number | null): number | null {
  if (!units || !valueSgd || units <= 0 || valueSgd <= 0) return null
  return valueSgd / units
}

/** Tolerance for accepting a written price as consistent with the SGD value. */
const PRICE_VALUE_TOLERANCE = 0.2

/**
 * Write-path guard: Snapshot.value (SGD) is authoritative. A written price is
 * accepted if EITHER currency reading reproduces the value within 20% —
 *   units × price × usdSgdRate ≈ value  (trading-currency price; EUR sits within
 *   the band of the USD rate, GBp is ~100× off and correctly fails), or
 *   units × price ≈ value               (price already SGD).
 * Otherwise the price is misread/conflated (e.g. a double-converted OCR figure)
 * and the value-consistent SGD per-unit figure is stored instead, so price and
 * value in one snapshot can never disagree wildly again.
 */
export function valueConsistentPrice(units: number, price: number, valueSgd: number, usdSgdRate: number): number {
  if (!(units > 0) || !(valueSgd > 0)) return price
  if (!(price > 0)) return valueSgd / units
  const within = (x: number) => Math.abs(x - valueSgd) / valueSgd <= PRICE_VALUE_TOLERANCE
  if (within(units * price * usdSgdRate) || within(units * price)) return price
  return valueSgd / units
}
