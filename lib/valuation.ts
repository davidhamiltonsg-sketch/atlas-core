export interface ValuationSource {
  value: number
  units: number
  snapshotCostBasis?: number | null
  snapshotUnrealizedPnl?: number | null
  reconstructedCostBasis?: number | null
  reconstructedAveragePrice?: number | null
  reportingFxRate: number
}

export interface OpenPositionValuation {
  costBasis: number | null
  unrealizedPnl: number | null
  unrealizedReturnPct: number | null
  averagePriceInstrumentCurrency: number | null
  source: "ibkr" | "reconstructed" | "unavailable"
  reconciles: boolean
}

export function openPositionValuation(x: ValuationSource): OpenPositionValuation {
  const authoritative = x.snapshotCostBasis != null && x.snapshotCostBasis > 0
  const costBasis = authoritative ? x.snapshotCostBasis! : (x.reconstructedCostBasis != null && x.reconstructedCostBasis > 0 ? x.reconstructedCostBasis : null)
  const unrealizedPnl = x.snapshotUnrealizedPnl != null
    ? x.snapshotUnrealizedPnl
    : costBasis != null ? x.value - costBasis : null
  const tolerance = Math.max(1, Math.abs(x.value) * 0.0005)
  const reconciles = costBasis == null || unrealizedPnl == null || Math.abs(x.value - costBasis - unrealizedPnl) <= tolerance
  const averagePriceInstrumentCurrency = costBasis != null && x.units > 0 && x.reportingFxRate > 0
    ? costBasis / x.units / x.reportingFxRate
    : x.reconstructedAveragePrice ?? null
  return {
    costBasis, unrealizedPnl,
    unrealizedReturnPct: costBasis != null && unrealizedPnl != null ? unrealizedPnl / costBasis * 100 : null,
    averagePriceInstrumentCurrency,
    source: authoritative ? "ibkr" : costBasis != null ? "reconstructed" : "unavailable",
    reconciles,
  }
}
