"use client"

import { useMemo, useState, useSyncExternalStore } from "react"
import { Search, ArrowUpDown } from "lucide-react"
import { HoldingRow, type HoldingRowData } from "./holding-row"
import { TableSkeleton } from "@/components/ui/table-skeleton"
import { subscribeRefreshing, getRefreshingSnapshot, getRefreshingServerSnapshot } from "@/lib/client/refresh-signal"

export interface SleeveGroup {
  key: string
  label: string
  target: number
  members: HoldingRowData[]
}

type SortKey = "default" | "value-desc" | "drift-desc" | "actual-desc" | "name-asc"

const SORT_LABELS: Record<SortKey, string> = {
  default: "Constitution order",
  "value-desc": "Value (highest first)",
  "drift-desc": "Drift (largest first)",
  "actual-desc": "Actual % (highest first)",
  "name-asc": "Name (A–Z)",
}

function groupValue(g: SleeveGroup): number {
  return g.members.reduce((s, m) => s + m.value, 0)
}
function groupMaxDrift(g: SleeveGroup): number {
  return Math.max(...g.members.map(m => Math.abs(m.drift)), 0)
}

function matchesQuery(h: HoldingRowData, query: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  return h.ticker.toLowerCase().includes(q) || h.name.toLowerCase().includes(q)
}

interface Props {
  sleeveGroups: SleeveGroup[]
  legacyRows: HoldingRowData[]
  sleeveActual: Record<string, number>
  hasBalance: boolean
}

/** Search + sort controls over the holdings table. Grouping (sleeve headers, legacy
 *  section) is preserved — search hides non-matching rows (and empty sleeve headers),
 *  sort reorders which sleeve appears first without breaking up members within a sleeve,
 *  since a sleeve's members are one governed economic exposure, not independent rows. */
export function HoldingsTableInteractive({ sleeveGroups, legacyRows, sleeveActual, hasBalance }: Props) {
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState<SortKey>("default")
  const isRefreshing = useSyncExternalStore(subscribeRefreshing, getRefreshingSnapshot, getRefreshingServerSnapshot)

  const filteredGroups = useMemo(() => {
    return sleeveGroups
      .map(g => ({ ...g, members: g.members.filter(m => matchesQuery(m, query)) }))
      .filter(g => g.members.length > 0)
  }, [sleeveGroups, query])

  const sortedGroups = useMemo(() => {
    const groups = [...filteredGroups]
    switch (sort) {
      case "value-desc": return groups.sort((a, b) => groupValue(b) - groupValue(a))
      case "drift-desc": return groups.sort((a, b) => groupMaxDrift(b) - groupMaxDrift(a))
      case "actual-desc": return groups.sort((a, b) => (sleeveActual[b.key] ?? 0) - (sleeveActual[a.key] ?? 0))
      case "name-asc": return groups.sort((a, b) => a.label.localeCompare(b.label))
      default: return groups
    }
  }, [filteredGroups, sort, sleeveActual])

  const filteredLegacy = useMemo(() => legacyRows.filter(h => matchesQuery(h, query)), [legacyRows, query])

  const noResults = query && sortedGroups.length === 0 && filteredLegacy.length === 0

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-border bg-muted/10">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by ticker or name…"
            aria-label="Search holdings"
            className="w-full rounded-lg border border-border bg-background pl-8 pr-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <select
            value={sort}
            onChange={e => setSort(e.target.value as SortKey)}
            aria-label="Sort holdings"
            className="rounded-lg border border-border bg-background text-xs px-2 py-1.5 outline-none focus:ring-2 focus:ring-primary/30"
          >
            {(Object.keys(SORT_LABELS) as SortKey[]).map(k => (
              <option key={k} value={k}>{SORT_LABELS[k]}</option>
            ))}
          </select>
        </div>
      </div>

      {isRefreshing ? (
        <TableSkeleton rows={Math.max(3, sleeveGroups.length)} columns={5} />
      ) : (
      <div className="divide-y divide-border">
        {noResults ? (
          <p className="px-5 py-8 text-center text-xs text-muted-foreground">No holdings match &ldquo;{query}&rdquo;.</p>
        ) : (
          <>
            {sortedGroups.map((g) => g.members.length === 1 ? (
              <HoldingRow key={g.members[0].id} holding={g.members[0]} />
            ) : (
              <div key={g.key} className="divide-y divide-border">
                <div className="px-5 py-2 bg-muted/20 flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: g.members[0].color }} />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {g.label} — combined target {g.target}%
                    {hasBalance && (
                      <span className="ml-2 normal-case font-normal">
                        ({(sleeveActual[g.key] ?? 0).toFixed(1)}% actual)
                      </span>
                    )}
                  </span>
                </div>
                {g.members.map(m => <HoldingRow key={m.id} holding={m} />)}
              </div>
            ))}
            {filteredLegacy.length > 0 && (
              <div className="divide-y divide-border">
                <div className="px-5 py-2 bg-muted/20">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Legacy — awaiting sale
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground/80 mt-0.5 ml-3.5">
                    Sell proceeds settle into the cash bank before replacement buys — Art. VII. Value and history stay attached to the original instrument.
                  </p>
                </div>
                {filteredLegacy.map(h => <HoldingRow key={h.id} holding={h} />)}
              </div>
            )}
          </>
        )}
      </div>
      )}
    </div>
  )
}
