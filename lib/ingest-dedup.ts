// ─────────────────────────────────────────────────────────────────────────────
// IBKR ingestion — pure dedup / reconcile logic.
//
// Kept free of any DB or network import so the contract check (scripts/check-ingest.ts) can
// exercise it directly. holdings-sync.ts wires these into the actual import.
// ─────────────────────────────────────────────────────────────────────────────

// The subset of an IBKR execution these helpers read. Kept structural (not the full FlexExecution)
// so any execution shape from the parser or the import layer is accepted without coupling.
export interface ExecutionLike {
  tradeID: string; symbol: string; buySell: string
  quantity: number; price: number; tradeDate: string
}

// Parse IBKR date YYYYMMDD → Date.
export function parseFlexDate(s: string): Date {
  if (s.length === 8) return new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`)
  return new Date(s)
}

/** Natural identity of a trade/execution — used to dedup when IBKR reissues tradeIDs. */
export function naturalKey(ticker: string, side: string, units: number, price: number, date: Date): string {
  return `${ticker.trim().toUpperCase()}|${side}|${units}|${price}|${date.toISOString().slice(0, 10)}`
}
export function executionNaturalKey(e: ExecutionLike): string {
  return naturalKey(e.symbol, e.buySell, e.quantity, e.price, parseFlexDate(e.tradeDate))
}

/**
 * Decide which incoming executions to import given what the DB already holds — idempotent AND
 * safe against partial fills:
 *   • Skip anything whose IBKR tradeID is already stored (normal re-run).
 *   • Otherwise cap each natural key's count at how many the SOURCE batch has for that key. A
 *     wholesale re-import under NEW tradeIDs then adds nothing (the DB already holds enough of
 *     that exact execution), while two legitimate same-price fills of one order — true
 *     multiplicity 2 — both import. This is what stops a reconfigured Flex query (new ids for the
 *     same trades) from doubling the whole portfolio without discarding real partial fills.
 */
export function selectExecutionsToImport<T extends ExecutionLike>(
  incoming: T[],
  existingTradeIDs: Set<string>,
  existingNaturalCounts: Map<string, number>,
): T[] {
  const desired = new Map<string, number>()
  for (const e of incoming) {
    const k = executionNaturalKey(e)
    desired.set(k, (desired.get(k) ?? 0) + 1)
  }
  const accepted = new Map<string, number>()
  const out: T[] = []
  for (const e of incoming) {
    if (existingTradeIDs.has(e.tradeID)) continue
    const k = executionNaturalKey(e)
    const have = (existingNaturalCounts.get(k) ?? 0) + (accepted.get(k) ?? 0)
    if (have >= (desired.get(k) ?? 0)) continue // DB already holds enough of this exact execution
    accepted.set(k, (accepted.get(k) ?? 0) + 1)
    out.push(e)
  }
  return out
}

export interface ExistingTradeRow { id: string; ibkrId: string | null; date: Date }

/**
 * Decide which EXISTING trades to remove to heal an already-doubled log, using the incoming IBKR
 * report as the source of truth. Only keys present in the report are considered, so trades outside
 * the report's window are NEVER touched. For each such key:
 *   • if the DB has rows whose IBKR id IS in this report, those are authoritative — delete the
 *     other (stale-id or manual) copies of that key;
 *   • otherwise trim the key down to the report's multiplicity, keeping the OLDEST rows.
 * Genuine same-price partial fills are preserved because the report carries their true multiplicity.
 */
export function selectStaleDuplicateTrades(
  existingByKey: Map<string, ExistingTradeRow[]>,
  batchNaturalCounts: Map<string, number>,
  batchTradeIDs: Set<string>,
): string[] {
  const remove: string[] = []
  for (const [key, count] of batchNaturalCounts) {
    const rows = existingByKey.get(key) ?? []
    if (rows.length <= 1) continue
    const confirmed = (r: ExistingTradeRow) => r.ibkrId !== null && batchTradeIDs.has(r.ibkrId)
    const inReport = rows.filter(confirmed)
    if (inReport.length >= 1) {
      // Report-confirmed rows are authoritative; every other copy of this key is a duplicate.
      for (const r of rows) if (!confirmed(r)) remove.push(r.id)
    } else if (rows.length > count) {
      // No overlap with the report's ids — trim to the report's multiplicity, keeping the oldest.
      const sorted = [...rows].sort((a, b) => a.date.getTime() - b.date.getTime())
      for (const r of sorted.slice(count)) remove.push(r.id)
    }
  }
  return remove
}
