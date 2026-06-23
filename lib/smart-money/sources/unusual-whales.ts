/**
 * Curated public figures — manually maintained, no API key needed.
 * Signal quality: LOW. Display only, never feeds governance.
 */

import { SmartMoneyTrade, SmartMoneyFeed } from '../types'
import { enrichWithOverlap } from '../relevance'

interface CuratedPosition {
  actor: string; role: string; ticker: string
  action: SmartMoneyTrade['action']; valueEstimate: string
  tradeDate: string; source: string; notes: string
}

const CURATED_POSITIONS: CuratedPosition[] = [
  {
    actor: 'Cathie Wood (ARK)', role: 'CEO, ARK Invest', ticker: 'NVDA', action: 'sell',
    valueEstimate: '>$50M', tradeDate: '2025-01-15',
    source: 'ARK Invest daily trade report',
    notes: 'ARK has been a systematic NVDA seller since Jan 2025. Daily reports are public.',
  },
  {
    actor: 'Michael Saylor (MicroStrategy)', role: 'Executive Chairman, MSTR', ticker: 'IBIT', action: 'buy',
    valueEstimate: '>$1B', tradeDate: '2025-03-01',
    source: 'MicroStrategy 8-K filing',
    notes: 'MSTR continues systematic BTC accumulation. Disclosed via SEC 8-K.',
  },
]

export async function fetchInfluencerTrades(options: {
  daysBack?: number; atlasOnly?: boolean
}): Promise<SmartMoneyFeed> {
  const { daysBack = 180, atlasOnly = false } = options
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - daysBack)

  const trades = CURATED_POSITIONS
    .filter(p => new Date(p.tradeDate) >= cutoff)
    .filter(p => !atlasOnly || enrichWithOverlap(p.ticker).atlasOverlap)
    .map(p => {
      const overlap = enrichWithOverlap(p.ticker)
      return {
        id:            `influencer-${p.actor}-${p.ticker}-${p.tradeDate}`.replace(/[\s/]+/g, '-').toLowerCase(),
        source:        'influencer' as const,
        actor:         p.actor, role: p.role, ticker: p.ticker, action: p.action,
        valueEstimate: p.valueEstimate, valueMin: 0, valueMax: 0,
        tradeDate:     p.tradeDate, disclosureDate: p.tradeDate, daysLag: 0,
        atlasOverlap:  overlap.atlasOverlap,
        overlapReason: overlap.overlapReason,
        overlapTicker: overlap.overlapTicker,
        notes:         `${p.notes} [Source: ${p.source}]`,
      } as SmartMoneyTrade
    })

  return { source: 'influencer', trades, fetchedAt: new Date().toISOString(), stale: true }
}
