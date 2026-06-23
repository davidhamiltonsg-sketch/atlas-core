export const ATLAS_TICKERS = ['VT', 'VWRA', 'QQQM', 'SMH', 'VWO', 'VFEA', 'BTC', 'IBIT'] as const
export type AtlasTicker = typeof ATLAS_TICKERS[number]

interface IndirectExposure {
  atlasTicker:   string
  approximateWt: number
  reason:        string
}

export const INDIRECT_EXPOSURE_MAP: Record<string, IndirectExposure[]> = {
  NVDA:  [{ atlasTicker: 'SMH',  approximateWt: 0.20, reason: 'NVDA is largest SMH holding (~20%)' },
          { atlasTicker: 'QQQM', approximateWt: 0.09, reason: 'NVDA ~9% of Nasdaq-100' }],
  TSM:   [{ atlasTicker: 'SMH',  approximateWt: 0.13, reason: 'TSM is #2 SMH holding (~13%)' }],
  AVGO:  [{ atlasTicker: 'SMH',  approximateWt: 0.08, reason: 'AVGO ~8% of SMH' },
          { atlasTicker: 'QQQM', approximateWt: 0.05, reason: 'AVGO ~5% of Nasdaq-100' }],
  ASML:  [{ atlasTicker: 'SMH',  approximateWt: 0.06, reason: 'ASML ~6% of SMH' }],
  AMAT:  [{ atlasTicker: 'SMH',  approximateWt: 0.05, reason: 'AMAT ~5% of SMH' }],
  LRCX:  [{ atlasTicker: 'SMH',  approximateWt: 0.04, reason: 'LRCX ~4% of SMH' }],
  KLAC:  [{ atlasTicker: 'SMH',  approximateWt: 0.04, reason: 'KLAC ~4% of SMH' }],
  MU:    [{ atlasTicker: 'SMH',  approximateWt: 0.04, reason: 'MU ~4% of SMH' }],
  QCOM:  [{ atlasTicker: 'SMH',  approximateWt: 0.04, reason: 'QCOM ~4% of SMH' },
          { atlasTicker: 'QQQM', approximateWt: 0.03, reason: 'QCOM ~3% of Nasdaq-100' }],
  TXN:   [{ atlasTicker: 'SMH',  approximateWt: 0.03, reason: 'TXN ~3% of SMH' }],
  AMD:   [{ atlasTicker: 'SMH',  approximateWt: 0.03, reason: 'AMD ~3% of SMH' },
          { atlasTicker: 'QQQM', approximateWt: 0.02, reason: 'AMD ~2% of Nasdaq-100' }],
  INTC:  [{ atlasTicker: 'SMH',  approximateWt: 0.03, reason: 'INTC ~3% of SMH' }],
  AAPL:  [{ atlasTicker: 'QQQM', approximateWt: 0.09, reason: 'AAPL ~9% of Nasdaq-100' },
          { atlasTicker: 'VT',   approximateWt: 0.04, reason: 'AAPL ~4% of global market cap' }],
  MSFT:  [{ atlasTicker: 'QQQM', approximateWt: 0.09, reason: 'MSFT ~9% of Nasdaq-100' },
          { atlasTicker: 'VT',   approximateWt: 0.04, reason: 'MSFT ~4% of global market cap' }],
  META:  [{ atlasTicker: 'QQQM', approximateWt: 0.06, reason: 'META ~6% of Nasdaq-100' }],
  AMZN:  [{ atlasTicker: 'QQQM', approximateWt: 0.08, reason: 'AMZN ~8% of Nasdaq-100' }],
  GOOGL: [{ atlasTicker: 'QQQM', approximateWt: 0.07, reason: 'GOOGL ~7% of Nasdaq-100' }],
  GOOG:  [{ atlasTicker: 'QQQM', approximateWt: 0.05, reason: 'GOOG ~5% of Nasdaq-100' }],
  TSLA:  [{ atlasTicker: 'QQQM', approximateWt: 0.05, reason: 'TSLA ~5% of Nasdaq-100' }],
  MSTR:  [{ atlasTicker: 'IBIT', approximateWt: 0.00, reason: 'MSTR is a BTC proxy — signals BTC sentiment' }],
  COIN:  [{ atlasTicker: 'IBIT', approximateWt: 0.00, reason: 'COIN is a crypto infrastructure proxy' }],
  BABA:  [{ atlasTicker: 'VWO',  approximateWt: 0.04, reason: 'BABA ~4% of VWO' }],
  PDD:   [{ atlasTicker: 'VWO',  approximateWt: 0.02, reason: 'PDD ~2% of VWO' }],
}

export interface OverlapResult {
  isOverlap:   boolean
  directMatch: boolean
  atlasTicker?: string
  reason?:     string
  exposureWt?: number
}

export function checkAtlasOverlap(ticker: string): OverlapResult {
  const upper = ticker.toUpperCase()
  if ((ATLAS_TICKERS as readonly string[]).includes(upper)) {
    return { isOverlap: true, directMatch: true, atlasTicker: upper, reason: `You directly hold ${upper}` }
  }
  const exposures = INDIRECT_EXPOSURE_MAP[upper]
  if (exposures?.length) {
    const top = exposures.reduce((a, b) => a.approximateWt > b.approximateWt ? a : b)
    return { isOverlap: true, directMatch: false, atlasTicker: top.atlasTicker, reason: top.reason, exposureWt: top.approximateWt }
  }
  return { isOverlap: false, directMatch: false }
}

export function enrichWithOverlap(ticker: string): {
  atlasOverlap: boolean; overlapReason?: string; overlapTicker?: string
} {
  const result = checkAtlasOverlap(ticker)
  if (!result.isOverlap) return { atlasOverlap: false }
  return { atlasOverlap: true, overlapReason: result.reason, overlapTicker: result.atlasTicker }
}
