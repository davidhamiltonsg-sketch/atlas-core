// Pure maths/types for the outside-Atlas award pipeline — no db/network imports,
// so contract checks (scripts/check-forecast-governance.ts) can import it directly.

export interface ExternalAwardTranche {
  date: string // ISO yyyy-mm-dd (vest/payout date)
  units: number
}

export interface ExternalAward {
  ticker: string // e.g. "BK" — display + live-quote symbol, never a holding
  label: string // e.g. "BNY employer RSUs"
  tranches: ExternalAwardTranche[]
  taxRatePct: number // assumed combined tax drag applied at vest (0–60)
  priceUsd?: number // manual fallback price when no live quote is available
  asOf: string // ISO date the owner last confirmed the schedule
}

export interface UpcomingVest {
  date: Date
  units: number
  grossUsd: number
  afterTaxUsd: number
  monthsFromNow: number
}

/** Future tranches valued at `priceUsd`, with the assumed tax drag applied. */
export function upcomingVests(award: ExternalAward, priceUsd: number, now: Date): UpcomingVest[] {
  if (!(priceUsd > 0)) return []
  const keep = 1 - award.taxRatePct / 100
  return award.tranches
    .map((t) => ({ t, date: new Date(t.date) }))
    .filter(({ date }) => date.getTime() > now.getTime())
    .map(({ t, date }) => {
      const gross = t.units * priceUsd
      const monthsFromNow = Math.max(
        0,
        (date.getFullYear() - now.getFullYear()) * 12 + (date.getMonth() - now.getMonth()),
      )
      return { date, units: t.units, grossUsd: gross, afterTaxUsd: gross * keep, monthsFromNow }
    })
    .sort((a, b) => a.date.getTime() - b.date.getTime())
}
