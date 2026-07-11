// ─────────────────────────────────────────────────────────────────────────────
// Silicon Brick Road — Hidden-Exposure Look-Through (Article XVII)
//
// Dami's four funds overlap: VWRA, EQQQ and SEMI all hold the same big technology
// companies. This looks THROUGH the funds to the real underlying exposure, so the
// constitution's two hidden limits — no more than 45% in technology and no more than
// 10% in any single company — can actually be checked, not just written down.
//
// Self-contained and isolated: no Atlas Core funds or logic. A35 (Singapore bonds)
// has no technology or single-company exposure, so it does not appear below.
// ─────────────────────────────────────────────────────────────────────────────

// As-of date for the hand-entered weights below (fund fact-sheet level). Refresh from the
// latest fact sheets and bump this date; lookThroughStale() flags when it is old.
export const SBR_WEIGHTS_AS_OF = "2026-06-30"

// Article XVII limits.
export const SBR_TECHNOLOGY_LIMIT = 45      // %
export const SBR_SINGLE_COMPANY_LIMIT = 10  // %

// Approximate technology-sector weight of each fund (GICS Information Technology +
// Communication Services, the way the constitution defines "technology").
const FUND_TECHNOLOGY_PCT: Record<string, number> = {
  VWRA: 26,   // FTSE All-World — a quarter is tech
  EQQQ: 50,   // Invesco NASDAQ-100 UCITS — half is tech
  SEMI: 100,  // VanEck Semiconductor UCITS — all tech
}

// Approximate % of each fund made up by each big company (fact-sheet level).
const FUND_COMPANY_PCT: Record<string, Record<string, number>> = {
  VWRA: { Nvidia: 4.8, Apple: 4.3, Microsoft: 4.0, Amazon: 2.6, Alphabet: 2.2, Meta: 1.7, Broadcom: 1.2, TSMC: 1.3 },
  EQQQ: { Nvidia: 8.0, Apple: 9.0, Microsoft: 8.0, Amazon: 5.5, Alphabet: 5.0, Meta: 4.5, Broadcom: 5.0, TSMC: 0.0 },
  SEMI: { Nvidia: 20.0, Apple: 0.0, Microsoft: 0.0, Amazon: 0.0, Alphabet: 0.0, Meta: 0.0, Broadcom: 8.0, TSMC: 12.0 },
}

export interface SbrLookThrough {
  technologyPct: number
  topCompany: { name: string; pct: number }
  companies: Array<{ name: string; pct: number }>
  technologyOver: boolean
  singleCompanyOver: boolean
}

/** Look through the funds to real technology + single-company exposure. */
export function computeSbrLookThrough(positions: Array<{ ticker: string; actualPct: number }>): SbrLookThrough {
  let technologyPct = 0
  const companyTotals: Record<string, number> = {}

  for (const p of positions) {
    const w = p.actualPct / 100
    technologyPct += w * (FUND_TECHNOLOGY_PCT[p.ticker] ?? 0)
    const cw = FUND_COMPANY_PCT[p.ticker]
    if (cw) for (const [co, pct] of Object.entries(cw)) companyTotals[co] = (companyTotals[co] ?? 0) + w * pct
  }

  const companies = Object.entries(companyTotals)
    .map(([name, pct]) => ({ name, pct }))
    .sort((a, b) => b.pct - a.pct)
  const topCompany = companies[0] ?? { name: "—", pct: 0 }

  return {
    technologyPct,
    topCompany,
    companies,
    technologyOver: technologyPct > SBR_TECHNOLOGY_LIMIT,
    singleCompanyOver: topCompany.pct > SBR_SINGLE_COMPANY_LIMIT,
  }
}

/** Whether the weight tables are older than one quarter as of `now`. */
export function sbrWeightsStale(now: Date, staleAfterDays = 92): boolean {
  return Math.floor((now.getTime() - new Date(SBR_WEIGHTS_AS_OF).getTime()) / 86400000) > staleAfterDays
}
