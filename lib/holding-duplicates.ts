// ─────────────────────────────────────────────────────────────────────────────
// Duplicate Holding rows — detection, display folding, and merge ordering.
//
// The DB has no unique constraint on (userId, ticker) (schema changes are
// unavailable), and an earlier importer bug could create the same ticker twice
// in one batch. These pure helpers give every layer one shared definition:
//
//   DUPLICATE   — two or more non-CLOSED rows with the SAME normalized ticker.
//                 Alternate exchange lines of one instrument (EQQQ vs EQAC —
//                 GOVERNED_LINE_ALIASES) are NOT duplicates: the economic-sleeve
//                 layer governs those as one exposure across distinct rows.
//   IDENTITY WARNING — different tickers sharing one instrumentKey (same ISIN)
//                 that are NOT sleeve-mates; surfaced for review, never merged
//                 automatically.
//   CANONICAL   — the row to keep when merging: has cost basis on its latest
//                 snapshot > has the most recent snapshot > oldest createdAt.
//   FOLD        — display-layer tolerance: collapse duplicate rows into the
//                 canonical row with units/value SUMMED (never dropped), so
//                 ledgers/engines see one row per ticker while the owner decides.
// ─────────────────────────────────────────────────────────────────────────────
import { economicSleeveTicker } from "@/lib/instrument-identity"

export interface DuplicateSnapshotLike {
  date: Date
  units: number
  value: number
  costBasis?: number | null
}
export interface DuplicateHoldingLike {
  id: string
  ticker: string
  createdAt: Date
  instrumentStatus?: string
  instrumentKey?: string | null
  snapshots: DuplicateSnapshotLike[]
}

const norm = (t: string) => t.trim().toUpperCase()
const isOpenRow = (h: DuplicateHoldingLike) => h.instrumentStatus !== "CLOSED"

/** Canonical-row preference: latest-snapshot cost basis > most recent snapshot > oldest row. */
export function canonicalFirst<T extends DuplicateHoldingLike>(a: T, b: T): number {
  const aBasis = a.snapshots[0]?.costBasis != null ? 1 : 0
  const bBasis = b.snapshots[0]?.costBasis != null ? 1 : 0
  if (aBasis !== bBasis) return bBasis - aBasis
  const aDate = a.snapshots[0]?.date?.getTime() ?? 0
  const bDate = b.snapshots[0]?.date?.getTime() ?? 0
  if (aDate !== bDate) return bDate - aDate
  return a.createdAt.getTime() - b.createdAt.getTime()
}

export interface DuplicateGroup<T extends DuplicateHoldingLike> {
  ticker: string
  keep: T
  close: T[]
  totalUnits: number
  totalValueSgd: number
}

/** Literal same-ticker duplicate groups among non-CLOSED rows, canonical row first. */
export function findDuplicateGroups<T extends DuplicateHoldingLike>(holdings: T[]): DuplicateGroup<T>[] {
  const byTicker = new Map<string, T[]>()
  for (const h of holdings.filter(isOpenRow)) {
    const key = norm(h.ticker)
    byTicker.set(key, [...(byTicker.get(key) ?? []), h])
  }
  const groups: DuplicateGroup<T>[] = []
  for (const [ticker, rows] of byTicker) {
    if (rows.length < 2) continue
    const sorted = [...rows].sort(canonicalFirst)
    groups.push({
      ticker,
      keep: sorted[0],
      close: sorted.slice(1),
      totalUnits: sorted.reduce((s, r) => s + (r.snapshots[0]?.units ?? 0), 0),
      totalValueSgd: sorted.reduce((s, r) => s + (r.snapshots[0]?.value ?? 0), 0),
    })
  }
  return groups.sort((a, b) => a.ticker.localeCompare(b.ticker))
}

/** Different-ticker rows sharing one instrumentKey that are NOT sleeve-mates — review-only. */
export function findSharedIdentityWarnings(holdings: DuplicateHoldingLike[]): string[] {
  const byKey = new Map<string, DuplicateHoldingLike[]>()
  for (const h of holdings.filter(isOpenRow)) {
    if (!h.instrumentKey) continue
    byKey.set(h.instrumentKey, [...(byKey.get(h.instrumentKey) ?? []), h])
  }
  const warnings: string[] = []
  for (const [key, rows] of byKey) {
    const tickers = [...new Set(rows.map((r) => norm(r.ticker)))]
    if (tickers.length < 2) continue // same-ticker duplicates are handled by findDuplicateGroups
    const sleeves = new Set(tickers.map((t) => economicSleeveTicker(t)))
    if (sleeves.size === 1) continue // alternate lines of one governed sleeve — by design
    warnings.push(`${tickers.join(" & ")} share the same instrument identity (${key}) — review.`)
  }
  return warnings
}

/**
 * Display-layer tolerance: fold duplicate same-ticker rows into the canonical row with
 * the latest snapshot's units/value SUMMED across the group (nothing dropped, so NAV is
 * unchanged), older snapshots kept from the canonical row only. Until the owner merges,
 * every ledger/engine consumer sees one coherent row per ticker instead of colliding rows.
 */
export function foldDuplicateHoldings<T extends DuplicateHoldingLike>(holdings: T[]): T[] {
  const openByTicker = new Map<string, T[]>()
  for (const h of holdings) {
    if (!isOpenRow(h)) continue
    const key = norm(h.ticker)
    openByTicker.set(key, [...(openByTicker.get(key) ?? []), h])
  }
  const out: T[] = []
  for (const h of holdings) {
    if (!isOpenRow(h)) { out.push(h); continue }
    const group = openByTicker.get(norm(h.ticker))!
    if (group.length < 2) { out.push(h); continue }
    const canonical = [...group].sort(canonicalFirst)[0]
    if (h !== canonical) continue // folded into the canonical row
    const units = group.reduce((s, r) => s + (r.snapshots[0]?.units ?? 0), 0)
    const value = group.reduce((s, r) => s + (r.snapshots[0]?.value ?? 0), 0)
    const base = canonical.snapshots[0] ?? group.find((r) => r.snapshots.length > 0)?.snapshots[0]
    out.push(base
      ? { ...canonical, snapshots: [{ ...base, units, value }, ...canonical.snapshots.slice(1)] }
      : canonical)
  }
  return out
}
