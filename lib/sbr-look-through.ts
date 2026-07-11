// SBR v3.2 look-through. These fund-level coefficients are planning estimates and must
// carry an as-of date; actual portfolio weights always come from the owner account.
export const SBR_WEIGHTS_AS_OF = "2026-06-30"
export const SBR_TECHNOLOGY_LIMIT = 43
export const SBR_TECHNOLOGY_WATCH = 38
export const SBR_SEMICONDUCTOR_LIMIT = 22
export const SBR_SEMICONDUCTOR_WATCH = 18
export const SBR_SINGLE_COMPANY_LIMIT = 8
export const SBR_SINGLE_COMPANY_WATCH = 7
export const SBR_COUNTRY_LIMIT = 72
export const SBR_COUNTRY_WATCH = 68

const INDUSTRIES: Record<string, Record<string, number>> = {
  IMID: { Technology: 30.5, Financials: 16, Industrials: 11, Consumer: 15, Healthcare: 10, Other: 17.5 },
  EQAC: { Technology: 60, Communication: 12, Consumer: 13, Healthcare: 5, Industrials: 4, Other: 6 },
  SMH: { Semiconductors: 100 },
  IB01: { "Sovereign bills": 100 },
}
const COUNTRIES: Record<string, Record<string, number>> = {
  IMID: { "United States": 62.8, Japan: 6, "United Kingdom": 4, China: 3, Canada: 3, Taiwan: 2, Other: 19.2 },
  EQAC: { "United States": 97, Other: 3 },
  SMH: { "United States": 65, Taiwan: 18, Netherlands: 12, Other: 5 },
  IB01: { "United States": 100 },
}
const COMPANIES: Record<string, Record<string, number>> = {
  IMID: { Nvidia: 4.3, Apple: 4.0, Microsoft: 3.7, Amazon: 2.4, Alphabet: 2.1, Meta: 1.6, Broadcom: 1.1, TSMC: 1.0 },
  EQAC: { Nvidia: 8.0, Apple: 8.5, Microsoft: 7.8, Amazon: 5.5, Alphabet: 5.0, Meta: 4.5, Broadcom: 4.8 },
  SMH: { Nvidia: 19, Broadcom: 9, TSMC: 12, ASML: 8, AMD: 6 },
}
const ASSETS: Record<string, Record<string, number>> = {
  IMID: { Equity: 100 }, EQAC: { Equity: 100 }, SMH: { Equity: 100 }, IB01: { "Treasury bills": 100 },
}
const SEMICONDUCTORS: Record<string, number> = { IMID: 10, EQAC: 30, SMH: 100, IB01: 0 }

export interface ExposureLine { name: string; pct: number }
export interface SbrLookThrough {
  technologyPct: number
  semiconductorPct: number
  topCompany: ExposureLine
  topCountry: ExposureLine
  topIndustry: ExposureLine
  companies: ExposureLine[]
  countries: ExposureLine[]
  industries: ExposureLine[]
  assets: ExposureLine[]
  technologyOver: boolean
  singleCompanyOver: boolean
  countryOver: boolean
  semiconductorOver: boolean
  warnings: string[]
  ageDays: number
  stale: boolean
}

function aggregate(positions: Array<{ ticker: string; actualPct: number }>, table: Record<string, Record<string, number>>): ExposureLine[] {
  const totals: Record<string, number> = {}
  for (const p of positions) {
    const ticker = p.ticker === "SMH.L" ? "SMH" : p.ticker
    for (const [name, insidePct] of Object.entries(table[ticker] ?? {})) {
      totals[name] = (totals[name] ?? 0) + (p.actualPct / 100) * insidePct
    }
  }
  return Object.entries(totals).map(([name, pct]) => ({ name, pct })).sort((a, b) => b.pct - a.pct)
}

export function computeSbrLookThrough(positions: Array<{ ticker: string; actualPct: number }>, now = new Date()): SbrLookThrough {
  // No securities means no inferred target exposure.
  const invested = positions.filter((p) => p.actualPct > 0)
  const companies = aggregate(invested, COMPANIES)
  const countries = aggregate(invested, COUNTRIES)
  const industries = aggregate(invested, INDUSTRIES)
  const assets = aggregate(invested, ASSETS)
  const technologyPct = industries.filter((x) => ["Technology", "Communication", "Semiconductors"].includes(x.name)).reduce((s, x) => s + x.pct, 0)
  const semiconductorPct = invested.reduce((sum, p) => sum + (p.actualPct / 100) * (SEMICONDUCTORS[p.ticker === "SMH.L" ? "SMH" : p.ticker] ?? 0), 0)
  const topCompany = companies[0] ?? { name: "—", pct: 0 }
  const topCountry = countries[0] ?? { name: "—", pct: 0 }
  const topIndustry = industries[0] ?? { name: "—", pct: 0 }
  const ageDays = Math.max(0, Math.floor((now.getTime() - new Date(SBR_WEIGHTS_AS_OF).getTime()) / 86_400_000))
  const warnings: string[] = []
  if (topCompany.pct >= SBR_SINGLE_COMPANY_WATCH) warnings.push(`${topCompany.name} is ${topCompany.pct.toFixed(1)}% look-through`)
  if (technologyPct >= SBR_TECHNOLOGY_WATCH) warnings.push(`Technology-related industries are ${technologyPct.toFixed(1)}%`)
  if (semiconductorPct >= SBR_SEMICONDUCTOR_WATCH) warnings.push(`Semiconductors are ${semiconductorPct.toFixed(1)}% look-through`)
  if (topCountry.pct >= SBR_COUNTRY_WATCH) warnings.push(`${topCountry.name} is ${topCountry.pct.toFixed(1)}% economic exposure`)
  if (ageDays > 95) warnings.push(`Fund holdings data is ${ageDays} days old; concentration-led trades are blocked`)
  return {
    technologyPct, semiconductorPct, topCompany, topCountry, topIndustry, companies, countries, industries, assets,
    technologyOver: technologyPct >= SBR_TECHNOLOGY_LIMIT,
    singleCompanyOver: topCompany.pct >= SBR_SINGLE_COMPANY_LIMIT,
    countryOver: topCountry.pct >= SBR_COUNTRY_LIMIT,
    semiconductorOver: semiconductorPct >= SBR_SEMICONDUCTOR_LIMIT,
    warnings, ageDays, stale: ageDays > 95,
  }
}

export function sbrWeightsStale(now: Date, staleAfterDays = 95): boolean {
  return Math.floor((now.getTime() - new Date(SBR_WEIGHTS_AS_OF).getTime()) / 86_400_000) > staleAfterDays
}
