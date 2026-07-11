"use server"

import { db } from "@/lib/db"
import { getSession } from "@/lib/session"
import { revalidatePath } from "next/cache"

const YF_HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]

// ── Yahoo Finance crumb auth ──────────────────────────────────────────────────
// v10/quoteSummary requires a crumb token. The cookie dance (load finance.yahoo.com
// then call /v1/test/getcrumb) is unreliable on Vercel Singapore because Yahoo
// redirects server-side requests to a GDPR consent page.
//
// Strategy (three-step fallback):
//  1. Try crumb endpoint directly — works on many server environments without cookies
//  2. Try cookie dance via finance.yahoo.com (may fail on consent-page redirect)
//  3. Proceed without crumb — Yahoo falls back gracefully for some queries

let _cachedCrumb  = ""
let _cachedCookie = ""
let _crumbCachedAt = 0
const CRUMB_TTL = 55 * 60 * 1000 // 55 minutes

function isValidCrumb(s: string): boolean {
  return Boolean(s) && s !== "null" && s.length > 2 && !s.startsWith("<") && !s.includes("<!DOCTYPE")
}

async function getYFCrumb(): Promise<{ crumb: string; cookie: string } | null> {
  if (_cachedCrumb && Date.now() - _crumbCachedAt < CRUMB_TTL) {
    return { crumb: _cachedCrumb, cookie: _cachedCookie }
  }

  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

  // ── Attempt 1: direct crumb fetch (no cookie) ──────────────────────────────
  for (const host of YF_HOSTS) {
    try {
      const res = await fetch(`https://${host}/v1/test/getcrumb`, {
        headers: { "User-Agent": UA, "Accept": "*/*" },
        cache: "no-store",
      })
      if (!res.ok) continue
      const crumb = (await res.text()).trim()
      if (isValidCrumb(crumb)) {
        _cachedCrumb  = crumb
        _cachedCookie = ""
        _crumbCachedAt = Date.now()
        return { crumb, cookie: "" }
      }
    } catch { continue }
  }

  // ── Attempt 2: cookie dance via finance.yahoo.com ─────────────────────────
  // Yahoo may redirect to consent page on server IPs — we follow redirects and
  // collect whatever cookies come back.
  try {
    const pageRes = await fetch("https://finance.yahoo.com/", {
      headers: {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      cache: "no-store",
    })

    // getSetCookie() available in Node 18+; fallback to raw header string
    const rawCookies: string[] =
      typeof (pageRes.headers as unknown as Record<string, unknown>).getSetCookie === "function"
        ? ((pageRes.headers as unknown as { getSetCookie(): string[] }).getSetCookie())
        : (pageRes.headers.get("set-cookie") ?? "").split(/,(?=[^;]+=[^;]+)/)

    const cookieStr = rawCookies
      .filter(Boolean)
      .map(c => c.split(";")[0].trim())
      .filter(Boolean)
      .join("; ")

    if (cookieStr) {
      for (const host of YF_HOSTS) {
        try {
          const crumbRes = await fetch(`https://${host}/v1/test/getcrumb`, {
            headers: { "User-Agent": UA, "Accept": "*/*", "Cookie": cookieStr },
            cache: "no-store",
          })
          if (!crumbRes.ok) continue
          const crumb = (await crumbRes.text()).trim()
          if (isValidCrumb(crumb)) {
            _cachedCrumb  = crumb
            _cachedCookie = cookieStr
            _crumbCachedAt = Date.now()
            return { crumb, cookie: cookieStr }
          }
        } catch { continue }
      }
    }
  } catch {}

  console.warn("[yahoo-finance] Could not obtain crumb — proceeding without it")
  return null
}

// Map Yahoo Finance ticker symbols → our tracked company names
const SYMBOL_TO_COMPANY: Record<string, string> = {
  NVDA:     "Nvidia",
  MSFT:     "Microsoft",
  AAPL:     "Apple",
  AMZN:     "Amazon",
  META:     "Meta",
  GOOGL:    "Alphabet",
  GOOG:     "Alphabet",
  AVGO:     "Broadcom",
  TSM:      "TSMC",
  "2330.TW":"TSMC",   // Taiwan Stock Exchange listing (appears in VFEA)
}

// GICS sector keys Yahoo Finance uses → maps to our "digital economy" bucket
const DIGITAL_GICS = new Set(["technology", "communication_services"])

// Countries we classify as Emerging Markets
const EMERGING_COUNTRIES = new Set([
  "china", "india", "brazil", "taiwan", "southkorea", "mexico",
  "indonesia", "thailand", "malaysia", "philippines", "vietnam",
  "saudiarabia", "southafrica", "turkey", "argentina", "colombia",
])

type CompanyWeights = Record<string, number>
type SectorWeights  = { semiconductor: number; digital: number; us: number; ai: number }
type GeoWeights     = { us: number; intlDev: number; emerging: number; crypto: number }

type EtfData = {
  companyWeights: CompanyWeights
  sectorWeights:  SectorWeights
  geoWeights:     GeoWeights
}

// ── Yahoo Finance fetch ──────────────────────────────────────────────────────

async function fetchYFHoldings(ticker: string): Promise<Record<string, unknown> | null> {
  const modules = "topHoldings"
  const auth = await getYFCrumb()

  for (const host of YF_HOSTS) {
    try {
      // Append crumb when available; Yahoo falls back gracefully without it but
      // a missing crumb is the primary cause of "Unauthorized" / empty responses.
      const qs = auth
        ? `modules=${modules}&crumb=${encodeURIComponent(auth.crumb)}`
        : `modules=${modules}`

      const headers: Record<string, string> = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
      }
      if (auth?.cookie) headers["Cookie"] = auth.cookie

      const res = await fetch(
        `https://${host}/v10/finance/quoteSummary/${ticker}?${qs}`,
        { headers, cache: "no-store" }
      )
      if (!res.ok) continue
      const json = await res.json()
      const result = json?.quoteSummary?.result?.[0]
      if (result) return result as Record<string, unknown>
    } catch {
      continue
    }
  }
  return null
}

// ── Derivation logic ─────────────────────────────────────────────────────────

function deriveCompanyWeights(
  holdings: Array<{ symbol: string; holdingPercent: { raw: number } }>
): CompanyWeights {
  const weights: CompanyWeights = {
    Nvidia: 0, Microsoft: 0, Apple: 0, Amazon: 0,
    Meta: 0, Alphabet: 0, Broadcom: 0, TSMC: 0,
  }
  const alphabetSymbolsSeen = new Set<string>()

  for (const h of holdings) {
    const company = SYMBOL_TO_COMPANY[h.symbol]
    if (!company) continue
    const pct = (h.holdingPercent?.raw ?? 0) * 100

    if (company === "Alphabet") {
      // GOOGL and GOOG may both appear — sum them once each
      if (!alphabetSymbolsSeen.has(h.symbol)) {
        alphabetSymbolsSeen.add(h.symbol)
        weights.Alphabet = +(weights.Alphabet + pct).toFixed(2)
      }
    } else {
      weights[company] = +pct.toFixed(2)
    }
  }
  return weights
}

function deriveSectorWeights(
  ticker: string,
  sectorWeightings: Array<Record<string, number>>,
  companyWeights: CompanyWeights
): SectorWeights {
  // Flatten Yahoo's GICS sector map
  const gics: Record<string, number> = {}
  for (const sw of sectorWeightings) {
    for (const [k, v] of Object.entries(sw)) {
      gics[k] = (gics[k] ?? 0) + v * 100
    }
  }

  // Digital Economy = technology + communication_services GICS sectors
  let digital = 0
  for (const key of DIGITAL_GICS) digital += gics[key] ?? 0

  // Semiconductor: SEMI is a pure semi ETF so use its technology weight as proxy.
  // For others, derive from tracked company weights (Nvidia + Broadcom + TSMC)
  // and scale up since these 3 represent only ~35–45% of the semiconductor universe.
  let semiconductor: number
  if (ticker === "SMH") {
    semiconductor = Math.round(gics["technology"] ?? 90)
  } else {
    const semiCompanies = (companyWeights.Nvidia ?? 0) +
      (companyWeights.Broadcom ?? 0) +
      (companyWeights.TSMC ?? 0)
    // Scale factor ~2.5× covers AMD, ASML, QCOM, Applied Materials etc.
    semiconductor = Math.min(Math.round(semiCompanies * 2.5), Math.round(digital * 0.45))
  }

  // AI Infrastructure ≈ large fraction of semiconductor + AI-adjacent tech
  const ai = Math.min(Math.round(semiconductor * 0.75 + (gics["technology"] ?? 0) * 0.15), 35)

  return {
    semiconductor: Math.round(semiconductor),
    digital:       Math.round(digital),
    us:            0, // filled in from geo data below
    ai:            Math.round(ai),
  }
}

function deriveGeoWeights(
  ticker: string,
  countryWeightings: Array<Record<string, number>>
): { us: number; intlDev: number; emerging: number; crypto: number } {
  // Pure-US ETFs have no country weightings in Yahoo's response
  if (ticker === "EQAC") return { us: 97, intlDev: 3, emerging: 0, crypto: 0 }

  let us = 0
  let emerging = 0

  for (const cw of countryWeightings) {
    for (const [country, weight] of Object.entries(cw)) {
      const pct = weight * 100
      const key = country.toLowerCase().replace(/[\s_-]/g, "")
      if (key === "unitedstates") us += pct
      else if (EMERGING_COUNTRIES.has(key)) emerging += pct
    }
  }

  // If no country data came back (common for pure-US ETFs), use known values
  if (countryWeightings.length === 0 && ticker === "SMH") {
    us = 65; emerging = 8
  }

  const intlDev = Math.max(0, 100 - us - emerging)
  return {
    us:       Math.round(us),
    intlDev:  Math.round(intlDev),
    emerging: Math.round(emerging),
    crypto:   0,
  }
}

// ── Main action ──────────────────────────────────────────────────────────────

export async function refreshLookThroughAction(): Promise<{
  success?: boolean
  updated?: string[]
  errors?: string[]
  error?: string
}> {
  const session = await getSession()
  if (!session) return { error: "Unauthenticated." }
  // Any authenticated user can refresh (it's read-only data from Yahoo)

  const SOURCES = [
    { ticker: "IMID", yahoo: "IMID.L", source: "https://www.ssga.com/uk/en_gb/institutional/etfs/state-street-spdr-msci-all-country-world-investable-market-ucits-etf-acc-imid-gy" },
    { ticker: "EQAC", yahoo: "EQAC.L", source: "https://www.invesco.com/uk/en/financial-products/etfs/invesco-eqqq-nasdaq-100-ucits-etf-acc.html" },
    { ticker: "SMH", yahoo: "SMH.L", source: "https://www.vaneck.com/uk/en/semiconductor-etf" },
    { ticker: "IB01", yahoo: "IB01.L", source: "https://www.ishares.com/uk/individual/en/products/307243/ishares-treasury-bond-01yr-ucits-etf" },
  ] as const
  const updated: string[] = []
  const errors:  string[] = []

  for (const { ticker, yahoo, source } of SOURCES) {
    try {
      let data: EtfData

      if (ticker === "IB01") {
        // The official mandate is exclusively short-dated US Treasury securities.
        data = {
          companyWeights: {
            Nvidia: 0, Microsoft: 0, Apple: 0, Amazon: 0,
            Meta: 0, Alphabet: 0, Broadcom: 0, TSMC: 0,
          },
          sectorWeights:  { semiconductor: 0, digital: 0, us: 0, ai: 0 },
          geoWeights:     { us: 100, intlDev: 0, emerging: 0, crypto: 0 },
        }
      } else {
        const result = await fetchYFHoldings(yahoo)
        if (!result) {
          errors.push(`${ticker}: no data returned from Yahoo Finance`)
          continue
        }

        const topHoldings = result.topHoldings as Record<string, unknown> | undefined
        if (!topHoldings) {
          errors.push(`${ticker}: topHoldings module missing`)
          continue
        }

        type HoldingRow = { symbol: string; holdingPercent: { raw: number } }
        const holdings = (topHoldings.holdings as HoldingRow[]) ?? []
        const sectorWeightings = (topHoldings.sectorWeightings as Array<Record<string, number>>) ?? []
        const countryWeightings = (topHoldings.countryWeightings as Array<Record<string, number>>) ?? []

        const companyWeights = deriveCompanyWeights(holdings)
        const sectorWeights  = deriveSectorWeights(ticker, sectorWeightings, companyWeights)
        const geoWeights     = deriveGeoWeights(ticker, countryWeightings)

        // Sync us% into sectorWeights.us (same value)
        sectorWeights.us = geoWeights.us

        data = { companyWeights, sectorWeights, geoWeights }
      }

      // Upsert into DB
      const existing = await db.etfLookThrough.findUnique({ where: { ticker } })
      if (existing) {
        await db.etfLookThrough.update({
          where: { ticker },
          data: {
            companyWeights: JSON.stringify(data.companyWeights),
            sectorWeights:  JSON.stringify(data.sectorWeights),
            geoWeights:     JSON.stringify(data.geoWeights),
            source:         `yahoo_finance|${source}`,
          },
        })
      } else {
        await db.etfLookThrough.create({
          data: {
            id:             crypto.randomUUID(),
            ticker,
            companyWeights: JSON.stringify(data.companyWeights),
            sectorWeights:  JSON.stringify(data.sectorWeights),
            geoWeights:     JSON.stringify(data.geoWeights),
            source:         `yahoo_finance|${source}`,
          },
        })
      }

      updated.push(ticker)
    } catch (e) {
      errors.push(`${ticker}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  revalidatePath("/reports")
  revalidatePath("/mission-control")
  revalidatePath("/")

  if (updated.length === 0) {
    return { error: `Refresh failed for all tickers. ${errors.join("; ")}` }
  }

  return {
    success: true,
    updated,
    errors: errors.length > 0 ? errors : undefined,
  }
}
