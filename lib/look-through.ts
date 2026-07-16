// ─────────────────────────────────────────────────────────────────────────────
// Atlas Core — Look-Through Concentration (§4)
//
// Computes EFFECTIVE exposure to individual companies and sectors after looking
// through every ETF to its underlying holdings, so the §4 caps are enforceable —
// not just documented. Caps here match the Governance Document (§4).
//
// Effective exposure for X = Σ over holdings of  (holding's % of NAV) × (ETF's % in X)
// ─────────────────────────────────────────────────────────────────────────────

// As-of date for the hand-entered ETF weight tables below. These are fact-sheet
// approximations that drift as funds rebalance; they feed the §4 look-through caps (the
// "highest law"), so a staleness signal matters. Update this date whenever the weights are
// refreshed from the latest fact sheets. Consumed by lookThroughWeightsAgeDays() below.
export const ETF_WEIGHTS_AS_OF = "2026-07-16"

/** Age (days) of the ETF weight tables relative to `now`, and whether they are stale
 *  (older than `staleAfterDays`, default one quarter). Lets the UI flag §4 exposure as
 *  "based on weights last refreshed N days ago" instead of implying live precision. */
export const LOOKTHROUGH_FRESH_DAYS = 35
export const LOOKTHROUGH_STALE_DAYS = 75
export function lookThroughWeightsAge(now: Date, staleAfterDays = LOOKTHROUGH_STALE_DAYS): { ageDays: number; stale: boolean } {
  const ageDays = Math.max(0, Math.floor((now.getTime() - new Date(ETF_WEIGHTS_AS_OF).getTime()) / 86400000))
  return { ageDays, stale: ageDays > staleAfterDays }
}

// Approximate % of each ETF made up by each mega-cap (fund fact-sheet level).
// GOVERNED FUNDS ONLY (plus the EQQQ/SEMI legacy aliases of EQAC/SMH). A ticker
// missing from these tables lands in unclassifiedPct with an explicit warning —
// that is the correct behaviour for non-governed strays, not a silent zero.
// Baselines refreshed 2026-07-16 from: Vanguard VWRA fact sheet (31 May 2026),
// Invesco EQQQ holdings (Q2 2026), VanEck SMH holdings (July 2026). The daily
// cron's Yahoo refresh (lib/look-through-refresh.ts) supersedes these at runtime.
export const ETF_COMPANY_WEIGHTS: Record<string, Record<string, number>> = {
  VWRA: { Nvidia: 4.7, Microsoft: 3.2, Apple: 4.3, Amazon: 2.5, Meta: 1.5, Alphabet: 2.1, Broadcom: 1.5, TSMC: 1.2 },
  EQAC: { Nvidia: 8.6, Microsoft: 5.4, Apple: 7.4, Amazon: 5.0, Meta: 3.4, Alphabet: 4.8, Broadcom: 4.6, TSMC: 0.0 },
  EQQQ: { Nvidia: 8.6, Microsoft: 5.4, Apple: 7.4, Amazon: 5.0, Meta: 3.4, Alphabet: 4.8, Broadcom: 4.6, TSMC: 0.0 },
  SMH:  { Nvidia: 19.0, Microsoft: 0.0, Apple: 0.0, Amazon: 0.0, Meta: 0.0, Alphabet: 0.0, Broadcom: 5.6, TSMC: 9.4 },
  SEMI: { Nvidia: 19.0, Microsoft: 0.0, Apple: 0.0, Amazon: 0.0, Meta: 0.0, Alphabet: 0.0, Broadcom: 5.6, TSMC: 9.4 },
  BTC:  {},
  DBMFE: {},
  IBIT: {},
}

// Approximate sector / geography make-up of each ETF (% of the ETF).
export const ETF_SECTOR_WEIGHTS: Record<string, { semiconductor: number; digital: number; us: number; ai: number }> = {
  VWRA: { semiconductor: 10,  digital: 37, us: 63,  ai: 18 },
  EQAC: { semiconductor: 32,  digital: 62, us: 97,  ai: 35 },
  EQQQ: { semiconductor: 32,  digital: 62, us: 97,  ai: 35 },
  SMH:  { semiconductor: 100, digital: 90, us: 66,  ai: 70 },
  SEMI: { semiconductor: 100, digital: 90, us: 66,  ai: 70 },
  BTC:  { semiconductor: 0,   digital: 0,  us: 0,   ai: 0 },
  DBMFE:{ semiconductor: 0,   digital: 0,  us: 0,   ai: 0 },
  IBIT: { semiconductor: 0,   digital: 0,  us: 0,   ai: 0 },
}

// Geographic make-up of each ETF (% of the ETF): US / Intl-Developed / Emerging / Crypto.
export const ETF_GEO_WEIGHTS: Record<string, { us: number; intlDev: number; emerging: number; crypto: number }> = {
  VWRA: { us: 63,  intlDev: 28, emerging: 9,   crypto: 0 },
  EQAC: { us: 97,  intlDev: 3,  emerging: 0,   crypto: 0 },
  EQQQ: { us: 97,  intlDev: 3,  emerging: 0,   crypto: 0 },
  SMH:  { us: 66,  intlDev: 20, emerging: 14,  crypto: 0 },
  SEMI: { us: 66,  intlDev: 20, emerging: 14,  crypto: 0 },
  BTC:  { us: 0,   intlDev: 0,  emerging: 0,   crypto: 100 },
  DBMFE:{ us: 0,   intlDev: 0,  emerging: 0,   crypto: 0 },
  IBIT: { us: 0,   intlDev: 0,  emerging: 0,   crypto: 100 },
}

// Caps as written in the Governance Document (§4). Whole-number percent of NAV.
export const LOOKTHROUGH_COMPANY_CAPS: Record<string, { soft: number; hard: number }> = {
  Nvidia:{soft:7,hard:9},Microsoft:{soft:7,hard:9},Apple:{soft:7,hard:9},Amazon:{soft:7,hard:9},
  Meta:{soft:7,hard:9},Alphabet:{soft:7,hard:9},Broadcom:{soft:7,hard:9},TSMC:{soft:7,hard:9},
}

// Cross-portfolio look-through review/hard limits. These classify estimated exposure;
// they do not authorise an automatic sale (see hardSignalsActionable below).
const SECTOR_LABELS: Record<string, string> = {
  semiconductor: "Semiconductor", digital: "Digital Economy", us: "US Market", ai: "AI Infrastructure",
}
export const LOOKTHROUGH_SECTOR_CAPS: Record<string, { label: string; soft: number; hard: number }> = {
  semiconductor: { label: "Semiconductor", soft: 25, hard: 30 },
  digital: { label: "Technology", soft: 45, hard: 50 },
  us: { label: "US Market", soft: 70, hard: 75 },
  ai: { label: SECTOR_LABELS.ai, soft: 45, hard: 50 },
}

export type CapStatus = "ok" | "watch" | "breach"

export interface ExposureLine {
  key: string
  label: string
  pct: number
  soft: number
  hard: number
  status: CapStatus
  contributors: Array<{ ticker: string; portfolioWeightPct: number; underlyingWeightPct: number; contributionPct: number }>
}

export interface LookThroughResult {
  companies: ExposureLine[]
  sectors: ExposureLine[]
  geographies: ExposureLine[]
  assets: ExposureLine[]
  unclassifiedPct: number
  managedFuturesPct: number
  cryptoPct: number
  ageDays: number
  freshness: "fresh" | "review" | "stale"
  stale: boolean
  estimated: boolean
  hardSignalsActionable: boolean
  warnings: string[]
}

export interface FundLookThroughWeights {
  companyWeights?: Record<string, number>
  sectorWeights?: { semiconductor?: number; digital?: number; us?: number; ai?: number }
  geoWeights?: { us?: number; intlDev?: number; emerging?: number; crypto?: number }
}

function statusFor(pct: number, soft: number, hard: number): CapStatus {
  if (pct >= hard) return "breach"
  if (pct >= soft) return "watch"
  return "ok"
}

/** Compute effective company + sector exposure for the live portfolio. */
export function computeLookThrough(
  positions: Array<{ ticker: string; actualPct: number }>,
  now = new Date(),
  sourceUpdatedAt?: Record<string, Date | string | null | undefined>,
  refreshedWeights?: Record<string, FundLookThroughWeights>,
): LookThroughResult {
  const companyTotals: Record<string, number> = {}
  const sectorTotals: Record<string, number> = { semiconductor: 0, digital: 0, us: 0, ai: 0 }
  const companyContributors:Record<string,ExposureLine["contributors"]>={},sectorContributors:Record<string,ExposureLine["contributors"]>={}
  const geoTotals:Record<string,number>={us:0,intlDev:0,emerging:0,crypto:0},geoContributors:Record<string,ExposureLine["contributors"]>={}

  let unclassifiedPct = 0, managedFuturesPct = 0, cryptoPct = 0
  const requiredDates: Date[] = []
  for (const p of positions) {
    const ticker = p.ticker.toUpperCase() === "SMH.L" ? "SMH" : p.ticker.toUpperCase()
    const w = p.actualPct / 100
    if (ticker === "DBMFE") managedFuturesPct += p.actualPct
    else if (ticker === "BTC" || ticker === "IBIT") cryptoPct += p.actualPct
    else if (!ETF_SECTOR_WEIGHTS[ticker]) unclassifiedPct += p.actualPct
    const supplied = sourceUpdatedAt?.[ticker]
    if (p.actualPct > 0 && ticker !== "BTC" && ticker !== "IBIT" && ticker !== "DBMFE") {
      // When a DB freshness map is supplied, a missing required fund is not silently
      // replaced with today's/static estimate: it makes the set stale until refreshed.
      const d = supplied ? new Date(supplied) : sourceUpdatedAt ? new Date(0) : new Date(ETF_WEIGHTS_AS_OF)
      if (Number.isFinite(d.getTime())) requiredDates.push(d)
    }
    const cw = refreshedWeights?.[ticker]?.companyWeights ?? ETF_COMPANY_WEIGHTS[ticker] ?? {}
    for (const [co, pct] of Object.entries(cw)) {
      companyTotals[co] = (companyTotals[co] ?? 0) + w * pct
      if(pct>0)(companyContributors[co]??=[]).push({ticker,portfolioWeightPct:p.actualPct,underlyingWeightPct:pct,contributionPct:w*pct})
    }
    const sw = refreshedWeights?.[ticker]?.sectorWeights ?? ETF_SECTOR_WEIGHTS[ticker]
    if (sw) {
      sectorTotals.semiconductor += w * (sw.semiconductor ?? 0)
      sectorTotals.digital       += w * (sw.digital ?? 0)
      sectorTotals.us            += w * (sw.us ?? 0)
      sectorTotals.ai            += w * (sw.ai ?? 0)
      for(const key of ["semiconductor","digital","us","ai"] as const){const inside=sw[key]??0;if(inside>0)(sectorContributors[key]??=[]).push({ticker,portfolioWeightPct:p.actualPct,underlyingWeightPct:inside,contributionPct:w*inside})}
    }
    const gw=refreshedWeights?.[ticker]?.geoWeights??ETF_GEO_WEIGHTS[ticker]
    if(gw)for(const key of ["us","intlDev","emerging","crypto"] as const){const inside=gw[key]??0;geoTotals[key]+=w*inside;if(inside>0)(geoContributors[key]??=[]).push({ticker,portfolioWeightPct:p.actualPct,underlyingWeightPct:inside,contributionPct:w*inside})}
  }

  const companies: ExposureLine[] = Object.keys(LOOKTHROUGH_COMPANY_CAPS).map((co) => {
    const cap = LOOKTHROUGH_COMPANY_CAPS[co]
    const pct = companyTotals[co] ?? 0
    return { key: co, label: co, pct, soft: cap.soft, hard: cap.hard, status: statusFor(pct, cap.soft, cap.hard), contributors:companyContributors[co]??[] }
  }).sort((a, b) => b.pct - a.pct)

  const sectors: ExposureLine[] = Object.keys(LOOKTHROUGH_SECTOR_CAPS).map((k) => {
    const cap = LOOKTHROUGH_SECTOR_CAPS[k]
    const pct = sectorTotals[k] ?? 0
    return { key: k, label: cap.label, pct, soft: cap.soft, hard: cap.hard, status: statusFor(pct, cap.soft, cap.hard), contributors:sectorContributors[k]??[] }
  }).sort((a, b) => b.pct - a.pct)
  const geoLabels:Record<string,string>={us:"United States",intlDev:"International developed",emerging:"Emerging markets",crypto:"Global / Bitcoin"}
  const geographies=Object.keys(geoLabels).map(key=>({key,label:geoLabels[key],pct:geoTotals[key]??0,soft:key==="us"?70:100,hard:key==="us"?75:100,status:statusFor(geoTotals[key]??0,key==="us"?70:100,key==="us"?75:100),contributors:geoContributors[key]??[]})).sort((a,b)=>b.pct-a.pct)
  const assetDefs=[{key:"equity",label:"Equity",tickers:new Set(["VWRA","EQAC","EQQQ","SMH","SEMI"])},{key:"managed",label:"Managed futures",tickers:new Set(["DBMFE"])},{key:"crypto",label:"Bitcoin",tickers:new Set(["BTC","IBIT"])},{key:"unclassified",label:"Unclassified",tickers:new Set<string>()}]
  const assets=assetDefs.map(def=>{const rows=positions.filter(p=>def.key==="unclassified"?!assetDefs.slice(0,3).some(x=>x.tickers.has(p.ticker.toUpperCase())):def.tickers.has(p.ticker.toUpperCase())).map(p=>({ticker:p.ticker.toUpperCase(),portfolioWeightPct:p.actualPct,underlyingWeightPct:100,contributionPct:p.actualPct}));const pct=rows.reduce((s,r)=>s+r.contributionPct,0);return {key:def.key,label:def.label,pct,soft:100,hard:100,status:"ok" as CapStatus,contributors:rows}})

  const oldest = requiredDates.length ? new Date(Math.min(...requiredDates.map(d => d.getTime()))) : now
  const ageDays = Math.max(0, Math.floor((now.getTime() - oldest.getTime()) / 86_400_000))
  const freshness = ageDays > LOOKTHROUGH_STALE_DAYS ? "stale" : ageDays > LOOKTHROUGH_FRESH_DAYS ? "review" : "fresh"
  const warnings: string[] = []
  if (unclassifiedPct > 0) warnings.push(`${unclassifiedPct.toFixed(1)}% of NAV is unclassified; concentration totals are incomplete.`)
  if (managedFuturesPct > 0) warnings.push(`${managedFuturesPct.toFixed(1)}% is managed futures and is reported separately from equity sectors.`)
  if (freshness !== "fresh") warnings.push(`Oldest required source is ${ageDays} days old; refresh before a concentration-led allocation change.`)
  warnings.push("Look-through values are estimates. They may pause or redirect contributions, but never create an automatic sell signal.")
  return { companies, sectors, geographies, assets, unclassifiedPct, managedFuturesPct, cryptoPct, ageDays, freshness, stale: freshness === "stale", estimated: true, hardSignalsActionable: false, warnings }
}

/** The single worst look-through breach (hard cap exceeded), if any — for the engine. */
export function worstLookThroughBreach(lt: LookThroughResult): ExposureLine | null {
  if (!lt.hardSignalsActionable || lt.stale || lt.unclassifiedPct > 0) return null
  const breaches = [...lt.companies, ...lt.sectors]
    .filter((l) => l.status === "breach")
    .sort((a, b) => (b.pct - b.hard) - (a.pct - a.hard))
  return breaches[0] ?? null
}

/** The single worst look-through APPROACH (over soft, under hard) — for the ladder's Step-4
 *  "review, don't sell" warning. Returns null when something is already in hard breach (that
 *  is a higher-priority Step-1 trim, not a soft warning). */
export function worstLookThroughApproach(lt: LookThroughResult): ExposureLine | null {
  const all = [...lt.companies, ...lt.sectors]
  if (all.some((l) => l.status === "breach") && lt.hardSignalsActionable) return null
  const watching = all
    .filter((l) => l.status === "watch" || l.status === "breach")
    .sort((a, b) => (b.pct - b.soft) - (a.pct - a.soft))
  return watching[0] ?? null
}

/** Which holding contributes most to a given company/sector — the one to trim. */
export function largestContributor(
  exposureKey: string,
  kind: "company" | "sector",
  positions: Array<{ ticker: string; actualPct: number }>
): string | null {
  let best: { ticker: string; contrib: number } | null = null
  for (const p of positions) {
    const t = p.ticker.toUpperCase()
    const contrib = kind === "company"
      ? (ETF_COMPANY_WEIGHTS[t]?.[exposureKey] ?? 0) * (p.actualPct / 100)
      : ((ETF_SECTOR_WEIGHTS[t] as Record<string, number> | undefined)?.[exposureKey] ?? 0) * (p.actualPct / 100)
    if (contrib > 0 && (!best || contrib > best.contrib)) best = { ticker: p.ticker, contrib }
  }
  return best?.ticker ?? null
}
