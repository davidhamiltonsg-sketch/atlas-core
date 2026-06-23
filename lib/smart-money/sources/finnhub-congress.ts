/**
 * Congressional trades via Finnhub
 * Endpoint: GET /api/v1/advanced/congressional-trading?symbol=TICKER&token=KEY
 * Note: May require Finnhub premium plan. Free tier may return empty.
 */

import { SmartMoneyTrade, SmartMoneyFeed } from '../types'
import { enrichWithOverlap } from '../relevance'
import { CONGRESS_WATCH_TICKERS } from './ticker-list'

interface FinnhubCongressTrade {
  name:            string
  chamber:         string
  transaction:     string
  transactionDate: string
  filingDate:      string
  amount:          string
  symbol:          string
  party?:          string
}

interface FinnhubCongressResponse {
  data:   FinnhubCongressTrade[]
  symbol: string
}

function parseValueRange(amount: string): { min: number; max: number; label: string } {
  const map: Record<string, { min: number; max: number; label: string }> = {
    '$1,001 - $15,000':         { min: 1001,    max: 15000,    label: '$1K–$15K' },
    '$15,001 - $50,000':        { min: 15001,   max: 50000,    label: '$15K–$50K' },
    '$50,001 - $100,000':       { min: 50001,   max: 100000,   label: '$50K–$100K' },
    '$100,001 - $250,000':      { min: 100001,  max: 250000,   label: '$100K–$250K' },
    '$250,001 - $500,000':      { min: 250001,  max: 500000,   label: '$250K–$500K' },
    '$500,001 - $1,000,000':    { min: 500001,  max: 1000000,  label: '$500K–$1M' },
    '$1,000,001 - $5,000,000':  { min: 1000001, max: 5000000,  label: '$1M–$5M' },
    '$5,000,001 - $25,000,000': { min: 5000001, max: 25000000, label: '$5M–$25M' },
    'Over $50,000,000':         { min: 50000001,max: 99999999, label: '>$50M' },
  }
  const cleaned = amount?.trim() ?? ''
  if (map[cleaned]) return map[cleaned]
  const nums = cleaned.replace(/[$,]/g, '').match(/\d+/g)
  if (nums && nums.length >= 2) return { min: parseInt(nums[0]), max: parseInt(nums[1]), label: cleaned }
  return { min: 0, max: 0, label: amount || 'Unknown' }
}

function normalizeAction(t: string): SmartMoneyTrade['action'] {
  const l = (t ?? '').toLowerCase()
  if (l.includes('buy') || l.includes('purchase')) return 'buy'
  if (l.includes('exchange'))                       return 'exchange'
  return 'sell'
}

function partyAbbr(party?: string): string {
  if (!party) return ''
  const p = party.toLowerCase()
  if (p.includes('democrat'))   return 'D'
  if (p.includes('republican')) return 'R'
  return 'I'
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const BASE = 'https://finnhub.io/api/v1'

export async function fetchCongressTrades(options: {
  daysBack?: number; atlasOnly?: boolean; apiKey?: string
}): Promise<SmartMoneyFeed> {
  const { daysBack = 90, atlasOnly = false } = options
  const apiKey = options.apiKey ?? process.env.FINNHUB_API_KEY

  if (!apiKey) return {
    source: 'congress', trades: [], fetchedAt: new Date().toISOString(),
    error: 'FINNHUB_API_KEY not set. Add it to your Vercel environment variables.',
  }

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - daysBack)
  const from = cutoff.toISOString().split('T')[0]

  const allTrades: SmartMoneyTrade[] = []
  const errors: string[] = []

  for (let i = 0; i < CONGRESS_WATCH_TICKERS.length; i++) {
    const sym = CONGRESS_WATCH_TICKERS[i]
    try {
      const url = `${BASE}/advanced/congressional-trading?symbol=${sym}&from=${from}&token=${apiKey}`
      const res = await fetch(url)
      if (!res.ok) { errors.push(`${sym}: ${res.status}`); continue }
      const json: FinnhubCongressResponse = await res.json()
      for (const raw of json.data ?? []) {
        if (new Date(raw.transactionDate) < cutoff) continue
        const { min, max, label } = parseValueRange(raw.amount)
        const tradeDate      = raw.transactionDate
        const disclosureDate = raw.filingDate || raw.transactionDate
        const daysLag = Math.max(0, Math.round(
          (new Date(disclosureDate).getTime() - new Date(tradeDate).getTime()) / 86400000
        ))
        const overlap = enrichWithOverlap(sym)
        allTrades.push({
          id:            `congress-${raw.name}-${sym}-${tradeDate}`.replace(/[\s/]+/g, '-').toLowerCase(),
          source:        'congress',
          actor:         raw.name,
          role:          `${raw.chamber || 'Congress'}${raw.party ? ` (${partyAbbr(raw.party)})` : ''}`,
          ticker:        sym,
          action:        normalizeAction(raw.transaction),
          valueEstimate: label,
          valueMin:      min,
          valueMax:      max,
          tradeDate,
          disclosureDate,
          daysLag,
          atlasOverlap:  overlap.atlasOverlap,
          overlapReason: overlap.overlapReason,
          overlapTicker: overlap.overlapTicker,
        })
      }
    } catch (err) {
      errors.push(`${sym}: ${err instanceof Error ? err.message : 'error'}`)
    }
    if (i < CONGRESS_WATCH_TICKERS.length - 1) await sleep(1100)
  }

  const seen = new Set<string>()
  const trades = allTrades
    .filter(t => { if (seen.has(t.id)) return false; seen.add(t.id); return true })
    .filter(t => !atlasOnly || t.atlasOverlap)
    .sort((a, b) => b.disclosureDate.localeCompare(a.disclosureDate))

  return {
    source: 'congress', trades, fetchedAt: new Date().toISOString(),
    error: errors.length ? `${errors.length} ticker(s) failed` : undefined,
  }
}
