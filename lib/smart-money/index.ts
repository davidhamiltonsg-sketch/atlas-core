import { SmartMoneyTrade, SmartMoneyFeed, SmartMoneyFilter, SmartMoneyStats, DEFAULT_FILTER } from './types'
import { fetchCongressTrades }   from './sources/finnhub-congress'
import { fetchInsiderTrades }    from './sources/finnhub-insider'

export * from './types'
export * from './relevance'

// 'influencer' remains in the SmartMoneySource type for UI compatibility, but has no
// live source anymore (the curated unusual-whales list was removed) — it yields no trades.
export async function fetchSmartMoneyFeed(options: {
  sources?:  Array<'congress' | 'insider' | 'influencer'>
  daysBack?: number; atlasOnly?: boolean; apiKey?: string
}): Promise<{ feeds: SmartMoneyFeed[]; trades: SmartMoneyTrade[]; stats: SmartMoneyStats }> {
  const { sources = ['congress', 'insider'], daysBack = 90, atlasOnly = false, apiKey } = options

  const fetches: Promise<SmartMoneyFeed>[] = []
  if (sources.includes('congress'))   fetches.push(fetchCongressTrades({ daysBack, atlasOnly, apiKey }))
  if (sources.includes('insider'))    fetches.push(fetchInsiderTrades({ daysBack, atlasOnly, apiKey }))

  const feeds = await Promise.all(fetches)
  const seen  = new Set<string>()
  const trades = feeds.flatMap(f => f.trades)
    .filter(t => { if (seen.has(t.id)) return false; seen.add(t.id); return true })
    .sort((a, b) => b.disclosureDate.localeCompare(a.disclosureDate))

  return { feeds, trades, stats: computeStats(trades) }
}

export function applyFilter(trades: SmartMoneyTrade[], filter: Partial<SmartMoneyFilter>): SmartMoneyTrade[] {
  const f = { ...DEFAULT_FILTER, ...filter }
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - f.daysBack)
  return trades.filter(t => {
    if (!f.sources.includes(t.source))         return false
    if (!f.actions.includes(t.action))         return false
    if (f.atlasOnly && !t.atlasOverlap)        return false
    if (t.valueMax < f.minValue)               return false
    if (new Date(t.tradeDate) < cutoff)        return false
    if (f.searchQuery) {
      const q = f.searchQuery.toLowerCase()
      if (!t.actor.toLowerCase().includes(q) && !t.ticker.toLowerCase().includes(q)) return false
    }
    return true
  })
}

function computeStats(trades: SmartMoneyTrade[]): SmartMoneyStats {
  const actorCounts: Record<string, number> = {}
  const tickerActivity: Record<string, { buys: number; sells: number }> = {}
  for (const t of trades) {
    actorCounts[t.actor] = (actorCounts[t.actor] ?? 0) + 1
    if (!tickerActivity[t.ticker]) tickerActivity[t.ticker] = { buys: 0, sells: 0 }
    if (t.action === 'buy')  tickerActivity[t.ticker].buys++
    if (t.action === 'sell') tickerActivity[t.ticker].sells++
  }
  const congress = trades.filter(t => t.source === 'congress')
  const insider  = trades.filter(t => t.source === 'insider')
  return {
    totalTrades:   trades.length,
    atlasOverlaps: trades.filter(t => t.atlasOverlap).length,
    congressBuys:  congress.filter(t => t.action === 'buy').length,
    congressSells: congress.filter(t => t.action === 'sell').length,
    insiderBuys:   insider.filter(t => t.action === 'buy').length,
    insiderSells:  insider.filter(t => t.action === 'sell').length,
    topActors:     Object.entries(actorCounts).sort((a,b) => b[1]-a[1]).slice(0,5).map(([name,count]) => ({name,count})),
    topTickers:    Object.entries(tickerActivity).sort((a,b) => (b[1].buys+b[1].sells)-(a[1].buys+a[1].sells)).slice(0,10).map(([ticker,{buys,sells}]) => ({ticker,buys,sells})),
    lastUpdated:   new Date().toISOString(),
  }
}

export function getDashboardIndicator(stats: SmartMoneyStats): string | null {
  if (stats.atlasOverlaps === 0) return null
  const parts: string[] = []
  if (stats.congressBuys  > 0) parts.push(`${stats.congressBuys} Congress buy${stats.congressBuys > 1 ? 's' : ''}`)
  if (stats.congressSells > 0) parts.push(`${stats.congressSells} Congress sell${stats.congressSells > 1 ? 's' : ''}`)
  if (stats.insiderBuys   > 0) parts.push(`${stats.insiderBuys} insider buy${stats.insiderBuys > 1 ? 's' : ''}`)
  if (stats.insiderSells  > 0) parts.push(`${stats.insiderSells} insider sell${stats.insiderSells > 1 ? 's' : ''}`)
  return parts.length ? `Smart Money: ${stats.atlasOverlaps} overlap${stats.atlasOverlaps > 1 ? 's' : ''} on your holdings — ${parts.join(', ')}` : null
}
