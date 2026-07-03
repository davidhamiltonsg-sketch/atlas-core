// ─────────────────────────────────────────────────────────────────────────────
// Money — a value that carries its own currency, plus the single place currency is
// formatted or converted.
//
// Migration pillar 4 ("money is a type; currency is a boundary"): an amount should not
// travel through the app as a bare `number` whose currency is inferred from context
// (`isSbr ? "SGD" : "USD"`). A `Money` carries its own `ccy`; `formatMoney` renders it;
// `convert` is the ONE declared reporting boundary where a rate is applied.
//
// `formatMoney` is byte-identical to the legacy `formatCurrency(value, ccy)` — adopting it
// changes no displayed string. scripts/check-money.ts asserts that equality across a grid,
// so the foundation can land and be adopted incrementally without a render regression.
// ─────────────────────────────────────────────────────────────────────────────

export type Currency = "USD" | "SGD"

export interface Money {
  amount: number
  ccy: Currency
}

/** Construct a Money value. */
export function money(amount: number, ccy: Currency): Money {
  return { amount, ccy }
}

/** Format a Money for display. Identical output to the legacy formatCurrency(amount, ccy). */
export function formatMoney(m: Money): string {
  return new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency: m.ccy,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(m.amount)
}

/** The ONE reporting boundary: convert a Money into another currency at an explicit rate.
 *  `rate` is units of `to` per one unit of `m.ccy`. A same-currency convert is a no-op, so
 *  callers can convert unconditionally without smuggling a wrong rate onto matching currencies. */
export function convert(m: Money, to: Currency, rate: number): Money {
  if (m.ccy === to) return m
  return { amount: m.amount * rate, ccy: to }
}
