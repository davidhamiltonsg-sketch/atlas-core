/**
 * SBR market data — live prices for the four SBR funds.
 *
 * All four SBR funds are non-US-listed:
 *   IMID, EQAC, SMH and IB01 London listings, fetched via Yahoo Finance.
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

  const symbols={IMID:"IMID.L",EQAC:"EQAC.L",SMH:"SMH.L",IB01:"IB01.L"}
  const rows=await Promise.all(Object.entries(symbols).map(async([ticker,symbol])=>({ticker,price:await fetchYahooPrice(symbol),hi52:await fetchYahoo52wHigh(symbol)})))

  const positions: Record<string, { price: number; hi52: number }> = {}

  for(const row of rows)if(row.price>0)positions[row.ticker]={price:row.price,hi52:row.hi52}

  const stale = Object.keys(positions).length === 0

  return { positions, stale, asOf }
}
