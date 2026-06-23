/**
 * Insider transactions (Form 4) via Finnhub
 * Endpoint: GET /api/v1/stock/insider-transactions?symbol=TICKER&token=KEY
 * Available on free tier.
 */

import { SmartMoneyTrade, SmartMoneyFeed } from '../types'
import { enrichWithOverlap } from '../relevance'
import { WATCH_TICKERS } from './ticker-list'

interface FinnhubInsiderTransaction {
  name:             string
  share:            number
  change:           number
  filingDate:       string
  transactionDate:  string
  transactionCode:  string   // P = purchase, S = sale
  transactionPrice: number
}

interface FinnhubInsiderResponse {
  data:   FinnhubInsiderTransaction[]
  symbol: string
}

// Only surface open-market buys and sells — filter awards, gifts, conversions
const CODE_MAP: Record<string, SmartMoneyTrade['action'] | null> = {
  P: 'buy', S: 'sell',
  A: null, D: null, F: null, M: null, C: null, G: null, I: null, W: null, Z: null,
}

const NOTABLE_TITLES: Record<string, string> = {
  'Jensen Huang':    'CEO, NVIDIA',
  'Lisa Su':         'CEO, AMD',
  'Pat Gelsinger':   'CEO, Intel',
  'Elon Musk':       'CEO, Tesla/SpaceX',
  'Mark Zuckerberg': 'CEO, Meta',
  'Satya Nadella':   'CEO, Microsoft',
  'Tim Cook':        'CEO, Apple',
  'Andy Jassy':      'CEO, Amazon',
  'Sundar Pichai':   'CEO, Alphabet',
  'Michael Saylor':  'Executive Chairman, MicroStrategy',
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const BASE = 'https://finnhub.io/api/v1'

export async function fetchInsiderTrades(options: {
  daysBack?: number; atlasOnly?: boolean; apiKey?: string
}): Promise<SmartMoneyFeed> {
  const { daysBack = 90, atlasOnly = false } = options
  const apiKey = options.apiKey ?? process.env.FINNHUB_API_KEY

  if (!apiKey) return {
    source: 'insider', trades: [], fetchedAt: new Date().toISOString(),
    error: 'FINNHUB_API_KEY not set.',
  }

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - daysBack)
  const from = cutoff.toISOString().split('T')[0]
  const to   = new Date().toISOString().split('T')[0]

  const allTrades: SmartMoneyTrade[] = []
  const errors: string[] = []

  for (let i = 0; i < WATCH_TICKERS.length; i++) {
    const sym = WATCH_TICKERS[i]
    try {
      const url = `${BASE}/stock/insider-transactions?symbol=${sym}&from=${from}&to=${to}&token=${apiKey}`
      const res = await fetch(url)
      if (!res.ok) { errors.push(`${sym}: ${res.status}`); continue }
      const json: FinnhubInsiderResponse = await res.json()
      for (const raw of json.data ?? []) {
        const action = CODE_MAP[(raw.transactionCode ?? '').toUpperCase()]
        if (!action) continue
        if (new Date(raw.transactionDate) < cutoff) continue
        const total = Math.abs(raw.share) * raw.transactionPrice
        const label = total >= 1_000_000
          ? `$${(total / 1_000_000).toFixed(1)}M`
          : `$${Math.round(total / 1000)}K`
        const overlap = enrichWithOverlap(sym)
        allTrades.push({
          id:            `insider-${raw.name}-${sym}-${raw.transactionDate}-${raw.transactionCode}`
                           .replace(/[\s/]+/g, '-').toLowerCase(),
          source:        'insider',
          actor:         raw.name,
          role:          NOTABLE_TITLES[raw.name] ?? 'Corporate Insider',
          ticker:        sym,
          action,
          valueEstimate: label,
          valueMin:      total,
          valueMax:      total,
          tradeDate:     raw.transactionDate,
          disclosureDate: raw.filingDate || raw.transactionDate,
          daysLag:       Math.max(0, Math.round(
                           (new Date(raw.filingDate).getTime() - new Date(raw.transactionDate).getTime()) / 86400000
                         )),
          atlasOverlap:  overlap.atlasOverlap,
          overlapReason: overlap.overlapReason,
          overlapTicker: overlap.overlapTicker,
          notes:         `${Math.abs(raw.share).toLocaleString()} shares @ $${raw.transactionPrice.toFixed(2)}`,
          sourceUrl:     `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${sym}&type=4`,
        })
      }
    } catch (err) {
      errors.push(`${sym}: ${err instanceof Error ? err.message : 'error'}`)
    }
    if (i < WATCH_TICKERS.length - 1) await sleep(1100)
  }

  const seen = new Set<string>()
  const trades = allTrades
    .filter(t => { if (seen.has(t.id)) return false; seen.add(t.id); return true })
    .filter(t => !atlasOnly || t.atlasOverlap)
    .sort((a, b) => b.disclosureDate.localeCompare(a.disclosureDate))

  return {
    source: 'insider', trades, fetchedAt: new Date().toISOString(),
    error: errors.length ? `${errors.length} ticker(s) failed: ${errors.slice(0, 3).join(', ')}` : undefined,
  }
}
