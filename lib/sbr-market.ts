/**
 * SBR market data — live prices for the four SBR funds.
 *
 * All four SBR funds are non-US-listed:
 *   VWRA (VWRA.L, London), EQQQ (EQQQ.L, London), SEMI (SEMI.L, London),
 *   A35 (A35.SI, SGX) → all fetched via Yahoo Finance.
 */

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

  // All four SBR funds are non-US: VWRA.L, EQQQ.L, SEMI.L (London), A35.SI (SGX).
  const [vwraPrice, vwra52, eqqqPrice, eqqq52, semiPrice, semi52, a35Price] = await Promise.all([
    fetchYahooPrice("VWRA.L"),
    fetchYahoo52wHigh("VWRA.L"),
    fetchYahooPrice("EQQQ.L"),
    fetchYahoo52wHigh("EQQQ.L"),
    fetchYahooPrice("SEMI.L"),
    fetchYahoo52wHigh("SEMI.L"),
    fetchYahooPrice("A35.SI"),
  ])

  const positions: Record<string, { price: number; hi52: number }> = {}

  if (vwraPrice > 0) positions["VWRA"] = { price: vwraPrice, hi52: vwra52 }
  if (eqqqPrice > 0) positions["EQQQ"] = { price: eqqqPrice, hi52: eqqq52 }
  if (semiPrice > 0) positions["SEMI"] = { price: semiPrice, hi52: semi52 }
  if (a35Price > 0) positions["A35"] = { price: a35Price, hi52: 0 }

  const stale = Object.keys(positions).length === 0

  return { positions, stale, asOf }
}
