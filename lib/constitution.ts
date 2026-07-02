/**
 * Atlas Core — Constitution v1.5 (July 2026)
 *
 * Single version-pinned governance module. All Phase 2+ code imports from HERE.
 * lib/constants.ts remains the raw source of record; this file re-exports everything
 * and adds the dealing window, throttle, risk register seeds, currency policy,
 * succession, and governance-score dimensions.
 *
 * v1.5 (following an independent critical review) carries the framework's first
 * SUBSTANTIVE rule changes since the constitutional format: the US look-through cap
 * tightened to 66/70 (Art. IX) and the Bitcoin cap de-cyclicalised to a constant 8%,
 * tightening to 6% only in a >50% drawdown (Art. X). It also corrects the SMH pullback
 * band (≤12% cap) and adds Art. XXX (Crisis Protocol) + Art. XXI A5 (deep-drawdown
 * review). These changes are logged as operator-directed amendments in Appendix F / Art.
 * XXIX (they did not arise from a standard Art. V trigger). Earlier v1.1→v1.4 were
 * editorial/doctrinal only. The 4th governance dimension is Freshness (Art. XXII).
 *
 * Source document:
 *   AtlasCoreConstitutionv1_5.html  (public/atlas-core-constitution.html)
 */

export const CONSTITUTION_VERSION = '1.5' as const
export const CONSTITUTION_UPDATED = '2026-07' as const

// ─── Re-export all constants from lib/constants.ts ────────────────────────────
// Art. VI   — allocation targets
// Art. VII  — position hard caps (VT=60%); Art. VIII drift bands (SMH amberHigh=11%)
// Art. X    — BTC halving cycle (bull = months 12–24 post-halving)
// Art. XI   — SMH dynamic buy zone / soft bands
// Art. XII  — combined tech ceiling (QQQM+SMH)
// Art. XIV  — behavioural rules
// Art. XIII — DCA params (contribution USD 3,000/mo)
// Art. XV   — UCITS mandate (warn 60k, require 100k)
export * from '@/lib/constants'

// ─── Art. XIII — DEALING WINDOW ─────────────────────────────────────────────
// The dealing window opens on the 3rd business day after the 15th and closes on
// the last business day of the month. Contribution day remains the 15th.

export function isBusinessDay(date: Date): boolean {
  const d = date.getDay()
  return d !== 0 && d !== 6
}

export function nthBusinessDayAfter(from: Date, n: number): Date {
  const d = new Date(from)
  let count = 0
  while (count < n) {
    d.setDate(d.getDate() + 1)
    if (isBusinessDay(d)) count++
  }
  return d
}

export function lastBusinessDayOfMonth(year: number, month: number): Date {
  // month is 0-indexed (JS Date convention)
  const last = new Date(year, month + 1, 0)
  while (!isBusinessDay(last)) last.setDate(last.getDate() - 1)
  return last
}

export interface DealingWindow {
  contributionDay: Date
  opens: Date
  closes: Date
}

export function getDealingWindow(forDate?: Date): DealingWindow {
  const ref = forDate ?? new Date()
  const year = ref.getFullYear()
  const month = ref.getMonth()
  const contributionDay = new Date(year, month, 15)
  return {
    contributionDay,
    opens:  nthBusinessDayAfter(contributionDay, 3),
    closes: lastBusinessDayOfMonth(year, month),
  }
}

export function isInDealingWindow(date?: Date): boolean {
  const d = date ?? new Date()
  const { opens, closes } = getDealingWindow(d)
  return d >= opens && d <= closes
}

// ─── Art. XIII — THROTTLE LIMITS ────────────────────────────────────────────
// 72-hr cooling-off after any trade; 90-day moratorium for parameter changes;
// max 1 discretionary ad-hoc move per calendar quarter.
export const THROTTLE = {
  coolingOffHours:         72,   // lock-out after any trade
  paramChangeMinDays:      90,   // moratorium after any parameter amendment
  discretionaryPerQuarter: 1,    // max ad-hoc moves per quarter
} as const

// ─── Art. XX–XXI — RISK REGISTER SEED DATA ───────────────────────────────────
// Seeds for prisma/seed.ts. Titles and levels only — descriptions in seed.ts.
export const RISK_REGISTER_SEEDS = [
  { key: 'ucits-migration',       title: 'US Estate Tax — UCITS Migration',    level: 'high'   as const },
  { key: 'single-broker',         title: 'Single-Broker Concentration (IBKR)',  level: 'medium' as const },
  { key: 'sgd-depreciation',      title: 'SGD Depreciation vs USD',             level: 'low'    as const },
  { key: 'tech-concentration',    title: 'Tech Sector Concentration',           level: 'medium' as const },
] as const

// ─── Art. XXII — GOVERNANCE SCORE DIMENSIONS ─────────────────────────────────
// Weights (must sum to 100). Matches lib/health.ts PortfolioHealth.
// v1.4: 4th dimension renamed Execution → Freshness.
export const GOVERNANCE_SCORE = {
  structural:    { weight: 40, citation: 'Art. VI–IX'   },
  behavioural:   { weight: 25, citation: 'Art. XII–XIV' },
  concentration: { weight: 25, citation: 'Art. IX'      },
  freshness:     { weight: 10, citation: 'Art. XXII'    },
} as const satisfies Record<string, { weight: number; citation: string }>

// ─── Art. XXIII — CURRENCY POLICY ────────────────────────────────────────────
// The portfolio accumulates in USD (masthead "Base Currency USD"; Art. XIII contributions
// are "USD 3,000 per month"). Progress is JUDGED in SGD — the 2045 target is an SGD number
// (Art. XXIII) — so all app outputs report in SGD. ETF prices are stored in USD.
export const CURRENCY_POLICY = {
  base:       'USD',   // accumulation / base currency (Art. XXIII; masthead "Base Currency USD")
  reporting:  'SGD',   // all outputs in SGD — progress judged in SGD (Art. XXIII)
  priceStore: 'USD',   // ETF prices stored as USD in Snapshot.price
  fxFallback: 1.35,    // USDSGD fallback when Yahoo Finance unavailable
} as const

// ─── Art. XXIV — SUCCESSION ──────────────────────────────────────────────────
// Review triggers and schedule. Documented here; not enforced by the app.
export const SUCCESSION = {
  annualReviewMonth:    1,        // January (1-indexed)
  reviewTriggers:       ['annual January review', 'documented emergency'] as const,
  overridePolicy:       'overrides only at annual January review or documented emergency — logged with reason',
} as const
