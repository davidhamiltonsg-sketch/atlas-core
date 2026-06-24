/**
 * Atlas Core — Finnhub server-side data layer (v6.1)
 *
 * Replaces hardcoded price / 52-week / yield figures with live values for the
 * recommendation logic, the buffer indicator, and the scheduled-events calendar.
 *
 * RULES (per the integration brief):
 *  - Server-side ONLY. The key (FINNHUB_API_KEY) is never exposed to the client.
 *  - Cache aggressively (these are not live-trading numbers) and degrade gracefully:
 *    on any failure we return the last verified fallback and mark the result STALE,
 *    never a silent guess.
 *  - No streaming/websockets, no sentiment, no predictive scores.
 */

import { MARKET_STATE, type EngineMarket } from "@/lib/next-best-move"
import { SGOV_YIELD } from "@/lib/constants"

const BASE = "https://finnhub.io/api/v1"

// Cache TTLs (seconds). Quotes/metrics refresh ~30 min; calendars ~6 h.
const TTL_QUOTE = 1800
const TTL_METRIC = 1800
const TTL_CALENDAR = 21600

function apiKey(): string | undefined {
  return process.env.FINNHUB_API_KEY
}

export function finnhubConfigured(): boolean {
  return Boolean(apiKey())
}

/** Cached GET against Finnhub. Returns parsed JSON or null on any failure. */
async function fhGet<T>(path: string, revalidate: number): Promise<T | null> {
  const key = apiKey()
  if (!key) return null
  const sep = path.includes("?") ? "&" : "?"
  try {
    const res = await fetch(`${BASE}${path}${sep}token=${key}`, {
      next: { revalidate },
      headers: { Accept: "application/json" },
    })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

// ─── Market positions (price + 52-week levels) ───────────────────────────────

interface FinnhubQuote { c?: number }
interface FinnhubMetricResp { metric?: Record<string, number | null> }

export interface MarketSnapshot {
  positions: EngineMarket          // overlay merged by the engine over MARKET_STATE
  asOf: string                     // ISO timestamp of this read
  stale: boolean                   // true when we fell back to verified constants
  liveTickers: string[]            // which tickers got a real live read
  note: string | null
}

const DEFAULT_MARKET_TICKERS = ["VT", "QQQM", "SMH", "VWO", "IBIT"]

/**
 * Pull live price + 52-week high/low for the given tickers. Volatility is left at 0
 * (Finnhub candle history is premium) so the engine keeps its verified vol estimate.
 * Falls back to MARKET_STATE constants (marked stale) when the key is missing or every
 * fetch fails.
 */
export async function getLiveMarketPositions(
  tickers: string[] = DEFAULT_MARKET_TICKERS
): Promise<MarketSnapshot> {
  const asOf = new Date().toISOString()

  if (!finnhubConfigured()) {
    return { positions: {}, asOf, stale: true, liveTickers: [], note: "FINNHUB_API_KEY not set — showing last verified figures." }
  }

  const positions: EngineMarket = {}
  const liveTickers: string[] = []

  await Promise.all(
    tickers.map(async (t) => {
      const [quote, metric] = await Promise.all([
        fhGet<FinnhubQuote>(`/quote?symbol=${t}`, TTL_QUOTE),
        fhGet<FinnhubMetricResp>(`/stock/metric?symbol=${t}&metric=all`, TTL_METRIC),
      ])
      const price = quote?.c && quote.c > 0 ? quote.c : 0
      const hi52 = num(metric?.metric?.["52WeekHigh"])
      const lo52 = num(metric?.metric?.["52WeekLow"])
      if (price > 0 || hi52 > 0) {
        positions[t] = { price, lo52, hi52, histVolPct: 0 }
        liveTickers.push(t)
      }
    })
  )

  const stale = liveTickers.length === 0
  return {
    positions,
    asOf,
    stale,
    liveTickers,
    note: stale ? "Live market fetch failed — showing last verified figures." : null,
  }
}

function num(v: number | null | undefined): number {
  return typeof v === "number" && isFinite(v) && v > 0 ? v : 0
}

// ─── SGOV yield (for the buffer indicator) ───────────────────────────────────

export interface SgovYield { dividendYieldPct: number; secYieldPct: number; stale: boolean; asOf: string }

export async function getSgovYield(): Promise<SgovYield> {
  const asOf = new Date().toISOString()
  const metric = await fhGet<FinnhubMetricResp>(`/stock/metric?symbol=SGOV&metric=all`, TTL_METRIC)
  const live = num(metric?.metric?.["dividendYieldIndicatedAnnual"])
  if (live > 0) {
    return { dividendYieldPct: live, secYieldPct: SGOV_YIELD.thirtyDaySec * 100, stale: false, asOf }
  }
  // Fallback to the verified constant (marked stale).
  return {
    dividendYieldPct: SGOV_YIELD.dividendYield * 100,
    secYieldPct: SGOV_YIELD.thirtyDaySec * 100,
    stale: true,
    asOf,
  }
}

// ─── Scheduled-events calendar (read-only; context, NOT signals) ─────────────

export interface ScheduledEvent {
  date: string            // YYYY-MM-DD
  kind: "economic" | "earnings" | "policy"
  title: string
  detail?: string
  ticker?: string
}

interface FinnhubEconomicResp {
  economicCalendar?: Array<{ time?: string; event?: string; country?: string; impact?: string }>
}
interface FinnhubEarningsResp {
  earningsCalendar?: Array<{ date?: string; symbol?: string; hour?: string }>
}

// Known fixed dates — static config (governance-relevant, not generated signals).
const STATIC_EVENTS: ScheduledEvent[] = [
  { date: MARKET_STATE.tariffTruceExpiry, kind: "policy", title: "US–China tariff truce expiry", detail: "Truce expires; renegotiated annually. Watch from September. (Context, not a signal.)" },
]

const EARNINGS_TICKERS = ["NVDA", "AAPL", "MSFT", "AMZN", "META", "GOOGL", "AVGO", "TSM"]

function ymd(d: Date): string {
  return d.toISOString().split("T")[0]
}

export interface CalendarResult {
  events: ScheduledEvent[]
  stale: boolean
  asOf: string
  note: string | null
}

/**
 * Upcoming scheduled events over the next `daysAhead` days: economic releases (FOMC/CPI),
 * earnings for key look-through names, and static known policy dates. Read-only context.
 */
export async function getScheduledEvents(daysAhead = 90): Promise<CalendarResult> {
  const asOf = new Date().toISOString()
  const today = new Date()
  const from = ymd(today)
  const horizon = new Date(today.getTime() + daysAhead * 86400000)
  const to = ymd(horizon)

  const events: ScheduledEvent[] = []

  // Static policy dates within the window.
  for (const e of STATIC_EVENTS) {
    if (e.date >= from && e.date <= to) events.push(e)
  }

  let stale = false

  // Economic calendar (premium on Finnhub — may be empty on free tier).
  const econ = await fhGet<FinnhubEconomicResp>(`/calendar/economic?from=${from}&to=${to}`, TTL_CALENDAR)
  if (econ?.economicCalendar?.length) {
    for (const e of econ.economicCalendar) {
      if (!e.time || !e.event) continue
      // Only surface high-impact US releases (FOMC, CPI, payrolls, etc.).
      if (e.country && e.country !== "US") continue
      if (e.impact && !["high", "3"].includes(String(e.impact).toLowerCase())) continue
      events.push({ date: e.time.split(" ")[0], kind: "economic", title: e.event })
    }
  } else if (!finnhubConfigured()) {
    stale = true
  }

  // Earnings for key holdings / look-through names.
  const earn = await fhGet<FinnhubEarningsResp>(`/calendar/earnings?from=${from}&to=${to}`, TTL_CALENDAR)
  if (earn?.earningsCalendar?.length) {
    for (const e of earn.earningsCalendar) {
      if (!e.date || !e.symbol) continue
      if (!EARNINGS_TICKERS.includes(e.symbol)) continue
      events.push({ date: e.date, kind: "earnings", title: `${e.symbol} earnings`, ticker: e.symbol })
    }
  }

  events.sort((a, b) => a.date.localeCompare(b.date))

  return {
    events,
    stale,
    asOf,
    note: !finnhubConfigured()
      ? "FINNHUB_API_KEY not set — showing known fixed dates only."
      : (events.length <= STATIC_EVENTS.length ? "Live economic/earnings calendar unavailable on the current Finnhub plan — showing known fixed dates." : null),
  }
}
