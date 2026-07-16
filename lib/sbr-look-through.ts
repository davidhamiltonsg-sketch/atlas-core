// SBR look-through. These fund-level coefficients are planning estimates and must
// carry an as-of date; actual portfolio weights always come from the owner account.
// Governed funds only (VWRA/EQAC/SMH/BTC/DBMFE/A35). Baselines refreshed 2026-07-16
// from the same fact sheets as lib/look-through.ts; the daily Yahoo refresh
// (lib/look-through-refresh.ts) supersedes them at runtime for the equity funds.
export const SBR_WEIGHTS_AS_OF = "2026-07-16"
export const SBR_TECHNOLOGY_LIMIT = 50
export const SBR_TECHNOLOGY_WATCH = 45
export const SBR_SEMICONDUCTOR_LIMIT = 30
export const SBR_SEMICONDUCTOR_WATCH = 25
export const SBR_SINGLE_COMPANY_LIMIT = 9
export const SBR_SINGLE_COMPANY_WATCH = 7
export const SBR_COUNTRY_LIMIT = 75
export const SBR_COUNTRY_WATCH = 70
export const SBR_FRESH_DAYS = 35
export const SBR_STALE_DAYS = 75

const INDUSTRIES: Record<string, Record<string, number>> = {
  EQAC: { Technology: 62, Communication: 12, Consumer: 12, Healthcare: 4, Industrials: 4, Other: 6 },
  SMH: { Semiconductors: 100 },
  VWRA: { Technology: 27, Financials: 16, Industrials: 11, Consumer: 15, Healthcare: 9, Other: 22 },
  BTC: { Crypto: 100 },
  DBMFE: { "Managed futures": 100 },
  A35: { "Singapore government bonds": 100 },
}
const COUNTRIES: Record<string, Record<string, number>> = {
  EQAC: { "United States": 97, Other: 3 },
  SMH: { "United States": 66, Taiwan: 14, Netherlands: 12, Other: 8 },
  VWRA: { "United States": 63, Japan: 6, "United Kingdom": 3.5, China: 3, Canada: 3, Other: 21.5 },
  BTC: { Global: 100 },
  DBMFE: { Global: 100 },
  A35: { Singapore: 100 },
}
const COMPANIES: Record<string, Record<string, number>> = {
  EQAC: { Nvidia: 8.6, Apple: 7.4, Microsoft: 5.4, Amazon: 5.0, Alphabet: 4.8, Broadcom: 4.6, Meta: 3.4 },
  SMH: { Nvidia: 19, TSMC: 9.4, ASML: 7, Broadcom: 5.6, AMD: 5.6 },
  VWRA: { Nvidia: 4.7, Apple: 4.3, Microsoft: 3.2, Amazon: 2.5, Alphabet: 2.1, Meta: 1.5, Broadcom: 1.5, TSMC: 1.2 },
}
const ASSETS: Record<string, Record<string, number>> = {
  EQAC: { Equity: 100 }, SMH: { Equity: 100 },
  VWRA: { Equity: 100 }, BTC: { Crypto: 100 }, DBMFE: { "Managed futures": 100 },
  A35: { "SGD government bonds": 100 },
}
const SEMICONDUCTORS: Record<string, number> = { EQAC: 32, SMH: 100, VWRA: 10, BTC: 0, DBMFE: 0, A35: 0 }

export interface ExposureLine { name: string; pct: number; contributors?: Array<{ticker:string;portfolioWeightPct:number;underlyingWeightPct:number;contributionPct:number}> }
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
  freshness: "fresh" | "review" | "stale"
  unclassifiedPct: number
  managedFuturesPct: number
  cryptoPct: number
  estimated: boolean
  hardSignalsActionable: boolean
}

function aggregate(positions: Array<{ ticker: string; actualPct: number }>, table: Record<string, Record<string, number>>): ExposureLine[] {
  const totals: Record<string, number> = {}
  const contributors:Record<string,NonNullable<ExposureLine["contributors"]>>={}
  for (const p of positions) {
    const raw = p.ticker.toUpperCase()
    const ticker = raw === "SMH.L" ? "SMH" : raw
    for (const [name, insidePct] of Object.entries(table[ticker] ?? {})) {
      totals[name] = (totals[name] ?? 0) + (p.actualPct / 100) * insidePct
      if(insidePct>0)(contributors[name]??=[]).push({ticker,portfolioWeightPct:p.actualPct,underlyingWeightPct:insidePct,contributionPct:(p.actualPct/100)*insidePct})
    }
  }
  return Object.entries(totals).map(([name, pct]) => ({ name, pct,contributors:contributors[name]??[] })).sort((a, b) => b.pct - a.pct)
}

export function computeSbrLookThrough(positions: Array<{ ticker: string; actualPct: number }>, now = new Date(), weightsAsOf = new Date(SBR_WEIGHTS_AS_OF), refreshedWeights?: Record<string,{companyWeights?:Record<string,number>;sectorWeights?:Record<string,number>;geoWeights?:Record<string,number>}>): SbrLookThrough {
  // No securities means no inferred target exposure.
  const invested = positions.filter((p) => p.actualPct > 0)
  const companyTable={...COMPANIES},countryTable={...COUNTRIES},industryTable={...INDUSTRIES}
  for(const [ticker,row] of Object.entries(refreshedWeights??{})){
    // A35's mandate is fixed (iBoxx ABF Singapore Bond Index). The refreshed rows use the
    // Atlas geo schema, which would relabel Singapore as generic "International developed";
    // the static Singapore/SGD-bond rows are more truthful, so never override them.
    if(ticker==="A35")continue
    if(row.companyWeights)companyTable[ticker]=row.companyWeights
    if(row.geoWeights){const g=row.geoWeights;countryTable[ticker]={"United States":g.us??0,"International developed":g.intlDev??0,"Emerging markets":g.emerging??0,"Global / crypto":g.crypto??0}}
    if(row.sectorWeights){const s=row.sectorWeights;industryTable[ticker]={Technology:s.digital??0,Semiconductors:s.semiconductor??0,"Other / overlapping themes":Math.max(0,100-(s.digital??0))}}
  }
  const companies = aggregate(invested, companyTable)
  const countries = aggregate(invested, countryTable)
  const industries = aggregate(invested, industryTable)
  const assets = aggregate(invested, ASSETS)
  const technologyPct = invested.reduce((sum,p)=>{const t=p.ticker.toUpperCase()==="SMH.L"?"SMH":p.ticker.toUpperCase();return sum+(p.actualPct/100)*(refreshedWeights?.[t]?.sectorWeights?.digital??(t==="SMH"?90:INDUSTRIES[t]?.Technology??0))},0)
  const semiconductorPct = invested.reduce((sum, p) => { const t=p.ticker.toUpperCase()==="SMH.L"?"SMH":p.ticker.toUpperCase(); return sum + (p.actualPct / 100) * (refreshedWeights?.[t]?.sectorWeights?.semiconductor??SEMICONDUCTORS[t]??0) }, 0)
  const topCompany = companies[0] ?? { name: "—", pct: 0 }
  const topCountry = countries[0] ?? { name: "—", pct: 0 }
  const topIndustry = industries[0] ?? { name: "—", pct: 0 }
  const ageDays = Math.max(0, Math.floor((now.getTime() - weightsAsOf.getTime()) / 86_400_000))
  const known = new Set(Object.keys(ASSETS))
  const unclassifiedPct = invested.filter(p => !known.has(p.ticker === "SMH.L" ? "SMH" : p.ticker.toUpperCase())).reduce((s,p)=>s+p.actualPct,0)
  const managedFuturesPct = assets.find(x => x.name === "Managed futures")?.pct ?? 0
  const cryptoPct = assets.find(x => x.name === "Crypto")?.pct ?? 0
  const freshness = ageDays > SBR_STALE_DAYS ? "stale" : ageDays > SBR_FRESH_DAYS ? "review" : "fresh"
  const warnings: string[] = []
  if (topCompany.pct >= SBR_SINGLE_COMPANY_WATCH) warnings.push(`${topCompany.name} is ${topCompany.pct.toFixed(1)}% look-through`)
  if (technologyPct >= SBR_TECHNOLOGY_WATCH) warnings.push(`Technology-related industries are ${technologyPct.toFixed(1)}%`)
  if (semiconductorPct >= SBR_SEMICONDUCTOR_WATCH) warnings.push(`Semiconductors are ${semiconductorPct.toFixed(1)}% look-through`)
  if (topCountry.pct >= SBR_COUNTRY_WATCH) warnings.push(`${topCountry.name} is ${topCountry.pct.toFixed(1)}% economic exposure`)
  if (unclassifiedPct > 0) warnings.push(`${unclassifiedPct.toFixed(1)}% of NAV is unclassified; concentration totals are incomplete`)
  if (managedFuturesPct > 0) warnings.push(`${managedFuturesPct.toFixed(1)}% is managed futures and is shown separately from equity sectors`)
  if (freshness !== "fresh") warnings.push(`Oldest required fund source is ${ageDays} days old; concentration-led allocation changes are blocked`)
  warnings.push("Look-through values are estimates: they may pause or redirect contributions, but never create an automatic sell signal")
  return {
    technologyPct, semiconductorPct, topCompany, topCountry, topIndustry, companies, countries, industries, assets,
    technologyOver: technologyPct >= SBR_TECHNOLOGY_LIMIT,
    singleCompanyOver: topCompany.pct >= SBR_SINGLE_COMPANY_LIMIT,
    countryOver: topCountry.pct >= SBR_COUNTRY_LIMIT,
    semiconductorOver: semiconductorPct >= SBR_SEMICONDUCTOR_LIMIT,
    warnings, ageDays, stale: freshness === "stale", freshness, unclassifiedPct, managedFuturesPct, cryptoPct,
    estimated: true, hardSignalsActionable: false,
  }
}

export function sbrWeightsStale(now: Date, staleAfterDays = SBR_STALE_DAYS): boolean {
  return Math.floor((now.getTime() - new Date(SBR_WEIGHTS_AS_OF).getTime()) / 86_400_000) > staleAfterDays
}
