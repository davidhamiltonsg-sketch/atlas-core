/**
 * SBR market data — live prices for the four SBR funds.
 *
 * QQQM and SMH are US-listed → Finnhub (price + 52-week high).
 * VWRA (VWRA.L, London) and A35 (A35.SI, SGX) → Yahoo Finance (price only;
 * 52-week high not reliably available without a premium API, so the skip-at-high
 * rule is disabled for VWRA and A35 until a source is wired up).
 */

import { getLiveMarketPositions } from "@/lib/finnhub"
import type { EngineMarket } from "@/lib/next-best-move"

const YF_HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]

export interface SbrMarketResult {
  positions: Record<string, { price: number; hi52: number }>
  stale: boolean
  asOf: string
}

async function fetchYahooPrice(symbol: string): Promise<number> {
  for (const host of YF_HOSTS) {
    try {
      const res = await fetch(
        `https://${host}/v8/finance/chart/${symbol}?interval=1d&range=1d`,
        { headers: { "User-Agent": "Mozilla/5.0 (compatible; AtlasPortfolio/1.0)" }, next: { revalidate: 1800 } }
      )
      if (res.ok) {
        const d = await res.json()
        const p = d?.chart?.result?.[0]?.meta?.regularMarketPrice
        if (p && p > 0) return p
      }
    } catch {}
  }
  return 0
}

async function fetchYahoo52wHigh(symbol: string): Promise<number> {
  for (const host of YF_HOSTS) {
    try {
      const res = await fetch(
        `https://${host}/v8/finance/chart/${symbol}?interval=1wk&range=1y`,
        { headers: { "User-Agent": "Mozilla/5.0 (compatible; AtlasPortfolio/1.0)" }, next: { revalidate: 3600 } }
      )
      if (res.ok) {
        const d = await res.json()
        const highs: number[] = d?.chart?.result?.[0]?.indicators?.quote?.[0]?.high ?? []
        const valid = highs.filter((h: number) => h > 0)
        if (valid.length > 0) return Math.max(...valid)
      }
    } catch {}
  }
  return 0
}

export async function getSbrMarketData(): Promise<SbrMarketResult> {
  const asOf = new Date().toISOString()

  // Fetch Finnhub (US funds) and Yahoo (non-US funds) in parallel.
  const [finnhub, vwraPrice, vwra52, a35Price] = await Promise.all([
    getLiveMarketPositions(["QQQM", "SMH"]),
    fetchYahooPrice("VWRA.L"),
    fetchYahoo52wHigh("VWRA.L"),
    fetchYahooPrice("A35.SI"),
    // A35 52-week high: SGX data is sparse on Yahoo; we skip rather than guess.
  ])

  const positions: Record<string, { price: number; hi52: number }> = {}

  // QQQM and SMH from Finnhub (includes 52-week high for skip-at-high engine rule)
  for (const [ticker, data] of Object.entries(finnhub.positions as EngineMarket)) {
    if (["QQQM", "SMH"].includes(ticker) && data) {
      positions[ticker] = { price: data.price ?? 0, hi52: data.hi52 ?? 0 }
    }
  }

  // VWRA.L → DB ticker VWRA (USD-priced on London exchange)
  if (vwraPrice > 0) positions["VWRA"] = { price: vwraPrice, hi52: vwra52 }

  // A35.SI → DB ticker A35 (SGD-priced on SGX; no hi52 → skip-at-high never triggers)
  if (a35Price > 0) positions["A35"] = { price: a35Price, hi52: 0 }

  const stale = Object.keys(positions).length === 0

  return { positions, stale, asOf }
}
