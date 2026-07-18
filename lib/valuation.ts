// Cost basis is considered stale once it's this many days past its last IBKR confirmation —
// long enough that a user should re-run Closing Refresh/Reconcile before trusting it for a
// concentration- or tax-relevant decision, short enough to catch a sync that's quietly
// stopped working. Mirrors the look-through engine's own freshness pattern (lib/look-through.ts).
export const COST_BASIS_STALE_DAYS = 90

export interface ValuationSource {
  value: number
  units: number
  snapshotCostBasis?: number | null
  snapshotUnrealizedPnl?: number | null
  reconstructedCostBasis?: number | null
  reconstructedAveragePrice?: number | null
  reportingFxRate: number
  // Explicit provenance (Snapshot.costBasisSource/costBasisAsOf) instead of only inferring
  // trustworthiness from snapshotCostBasis being non-null — a carried-forward cost basis
  // stays non-null indefinitely even if the underlying IBKR sync has silently stopped
  // confirming it, which null-checking alone can't detect.
  costBasisAsOf?: Date | string | null
  now?: Date
}

export interface OpenPositionValuation {
  costBasis: number | null
  unrealizedPnl: number | null
  unrealizedReturnPct: number | null
  averagePriceInstrumentCurrency: number | null
  source: "ibkr" | "reconstructed" | "unavailable"
  reconciles: boolean
  costBasisAsOf: Date | null
  costBasisStale: boolean
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
  const costBasisAsOf = x.costBasisAsOf != null ? new Date(x.costBasisAsOf) : null
  const now = x.now ?? new Date()
  const costBasisStale = authoritative && costBasisAsOf != null
    && Math.floor((now.getTime() - costBasisAsOf.getTime()) / 86_400_000) > COST_BASIS_STALE_DAYS
  return {
    costBasis, unrealizedPnl,
    unrealizedReturnPct: costBasis != null && unrealizedPnl != null ? unrealizedPnl / costBasis * 100 : null,
    averagePriceInstrumentCurrency,
    source: authoritative ? "ibkr" : costBasis != null ? "reconstructed" : "unavailable",
    reconciles,
    costBasisAsOf,
    costBasisStale,
  }
}
