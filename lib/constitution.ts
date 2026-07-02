/**
 * Atlas Core — Constitution v1.1 (July 2026)
 *
 * Single version-pinned governance module. All Phase 2+ code imports from HERE.
 * lib/constants.ts remains the raw source of record; this file re-exports everything
 * and adds v1.1 additions (dealing window, throttle, risk register seeds, currency
 * policy, succession, governance-score dimensions).
 *
 * Source documents:
 *   Atlas-Core-Constitution-v1_1_1.html
 *   atlas-core-cockpit-mockup.html
 */

export const CONSTITUTION_VERSION = '1.1' as const
export const CONSTITUTION_UPDATED = '2026-07' as const

// ─── Re-export all constants from lib/constants.ts ────────────────────────────
// Art. VI  — allocation targets
// Art. VII — hard drift thresholds (VT=60%, SMH amberHigh=11%)
// Art. VIII — BTC halving cycle (bull = months 12–24 post-halving)
// Art. IX  — combined tech ceiling, SMH soft bands
// Art. XII — behavioural rules
// Art. XIII — DCA params (contribution SGD 3,000/mo)
// Art. XV  — UCITS mandate (warn 60k, require 100k)
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
// Weights (must sum to 100). Matches lib/health.ts HEALTH_DIMENSIONS.
export const GOVERNANCE_SCORE = {
  structural:    { weight: 40, citation: 'Art. VI–IX'    },
  behavioural:   { weight: 25, citation: 'Art. XII–XIV'  },
  concentration: { weight: 25, citation: 'Art. IX'       },
  execution:     { weight: 10, citation: 'Art. XIII'     },
} as const satisfies Record<string, { weight: number; citation: string }>

// ─── Art. XXIII — CURRENCY POLICY ────────────────────────────────────────────
export const CURRENCY_POLICY = {
  base:       'SGD',   // portfolio base currency
  reporting:  'SGD',   // all outputs in SGD unless dual-display toggled
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
