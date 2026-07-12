export const ATLAS_TICKERS = ["IMID", "IWQU", "EQAC", "SMH", "BTC", "IBIT"] as const
export type AtlasTicker = typeof ATLAS_TICKERS[number]
export interface FundRelevance { atlasTicker: AtlasTicker; approximateWt: number; reason: string }

// Indicative relevance is used only to rank research stories. Governance uses the separately
// sourced look-through dataset and its freshness controls, never these editorial estimates.
export const COMPANY_RELEVANCE: Record<string, FundRelevance[]> = {
  NVDA: [{ atlasTicker: "SMH", approximateWt: 0.20, reason: "Major semiconductor holding" }, { atlasTicker: "EQAC", approximateWt: 0.09, reason: "Major Nasdaq-100 holding" }],
  TSM: [{ atlasTicker: "SMH", approximateWt: 0.13, reason: "Major semiconductor holding" }],
  AVGO: [{ atlasTicker: "SMH", approximateWt: 0.08, reason: "Semiconductor holding" }, { atlasTicker: "EQAC", approximateWt: 0.05, reason: "Nasdaq-100 holding" }],
  AAPL: [{ atlasTicker: "EQAC", approximateWt: 0.09, reason: "Major Nasdaq-100 holding" }, { atlasTicker: "IMID", approximateWt: 0.04, reason: "Global-market holding" }],
  MSFT: [{ atlasTicker: "EQAC", approximateWt: 0.09, reason: "Major Nasdaq-100 holding" }, { atlasTicker: "IWQU", approximateWt: 0.05, reason: "World-quality holding" }],
  META: [{ atlasTicker: "EQAC", approximateWt: 0.06, reason: "Nasdaq-100 holding" }],
  AMZN: [{ atlasTicker: "EQAC", approximateWt: 0.06, reason: "Nasdaq-100 holding" }],
}

export function enrichWithOverlap(symbol: string) {
  const matches = COMPANY_RELEVANCE[symbol.toUpperCase()] ?? []
  return {
    atlasOverlap: matches.length > 0,
    overlapTicker: matches[0]?.atlasTicker,
    overlapReason: matches.map((m) => `${m.atlasTicker}: ${m.reason}`).join(" · ") || undefined,
  }
}
