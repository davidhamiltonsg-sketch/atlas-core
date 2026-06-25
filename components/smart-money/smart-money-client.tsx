"use client"

import { useState, useEffect, useMemo } from "react"
import { Search, Landmark, Building2, Megaphone, RefreshCw, AlertTriangle, ExternalLink, Info } from "lucide-react"
import { cn } from "@/lib/utils"
import type { SmartMoneyTrade, SmartMoneySource, TradeAction } from "@/lib/smart-money/types"

type ApiResponse = {
  feeds?:  Array<{ source: SmartMoneySource; error?: string; stale?: boolean }>
  trades?: SmartMoneyTrade[]
  error?:  string
}

const SOURCE_META: Record<SmartMoneySource, { label: string; Icon: typeof Landmark }> = {
  congress:   { label: "Congress",     Icon: Landmark },
  insider:    { label: "Insider",      Icon: Building2 },
  influencer: { label: "Public Figure", Icon: Megaphone },
}

const DAYS_OPTIONS = [30, 60, 90, 180] as const

// All trade actions are always included (no action filter in this UI). Module-level
// so its reference is stable across renders.
const ALL_ACTIONS: Set<TradeAction> = new Set(["buy", "sell", "option_call", "option_put", "exchange"])

function fmtDate(d: string): string {
  const date = new Date(d)
  if (isNaN(date.getTime())) return d
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" })
}

export function SmartMoneyClient({ initialAtlasOnly = false }: { initialAtlasOnly?: boolean }) {
  const [allTrades, setAllTrades] = useState<SmartMoneyTrade[]>([])
  const [loading,   setLoading]   = useState(true)
  const [missingKey, setMissingKey] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)

  // Filters (applied client-side over the full 180-day pull)
  const [sources,   setSources]   = useState<Set<SmartMoneySource>>(new Set(["congress", "insider", "influencer"]))
  const [atlasOnly, setAtlasOnly] = useState(initialAtlasOnly)
  const [daysBack,  setDaysBack]  = useState<number>(90)
  const [search,    setSearch]    = useState("")

  // Applies fetched data to state — only ever called from a promise callback,
  // never synchronously inside the mount effect.
  function applyData(data: ApiResponse) {
    setFetchError(data.error ?? null)
    setMissingKey(Boolean(data.feeds?.some(f => f.error?.includes("FINNHUB_API_KEY"))))
    setAllTrades(data.trades ?? [])
    setLoading(false)
  }

  function refresh() {
    setLoading(true)
    setFetchError(null)
    fetch("/api/smart-money?daysBack=180")
      .then(r => r.json() as Promise<ApiResponse>)
      .then(applyData)
      .catch(() => { setFetchError("Could not reach the Smart Money feed."); setLoading(false) })
  }

  useEffect(() => {
    let active = true
    fetch("/api/smart-money?daysBack=180")
      .then(r => r.json() as Promise<ApiResponse>)
      .then(d => { if (active) applyData(d) })
      .catch(() => { if (active) { setFetchError("Could not reach the Smart Money feed."); setLoading(false) } })
    return () => { active = false }
  }, [])

  const filtered = useMemo(() => {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - daysBack)
    const q = search.trim().toLowerCase()
    return allTrades.filter(t => {
      if (!sources.has(t.source)) return false
      if (!ALL_ACTIONS.has(t.action)) return false
      if (atlasOnly && !t.atlasOverlap) return false
      if (new Date(t.tradeDate) < cutoff) return false
      if (q && !t.actor.toLowerCase().includes(q) && !t.ticker.toLowerCase().includes(q)) return false
      return true
    })
  }, [allTrades, sources, atlasOnly, daysBack, search])

  const stats = useMemo(() => {
    const congress = filtered.filter(t => t.source === "congress")
    const insider  = filtered.filter(t => t.source === "insider")
    return {
      total:         filtered.length,
      overlaps:      filtered.filter(t => t.atlasOverlap).length,
      congressBuys:  congress.filter(t => t.action === "buy").length,
      insiderBuys:   insider.filter(t => t.action === "buy").length,
    }
  }, [filtered])

  function toggleSource(s: SmartMoneySource) {
    setSources(prev => { const n = new Set(prev); if (n.has(s)) n.delete(s); else n.add(s); return n })
  }

  return (
    <div className="space-y-5">
      {/* Governance disclaimer */}
      <div className="flex items-start gap-2.5 rounded-xl border border-blue-500/20 bg-blue-500/[0.05] px-4 py-3">
        <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          <span className="font-semibold text-foreground">Read-only intelligence feed.</span>{" "}
          Congressional and corporate-insider disclosures for tickers that overlap your Atlas holdings. This{" "}
          <span className="font-semibold">does not influence DCA or the Next Best Move</span> — it is context only.
          Disclosures lag the actual trade (often weeks). Never act on a single data point.
        </p>
      </div>

      {/* Filter bar */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {(Object.keys(SOURCE_META) as SmartMoneySource[]).map(s => {
            const { label, Icon } = SOURCE_META[s]
            const on = sources.has(s)
            return (
              <button key={s} onClick={() => toggleSource(s)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
                  on ? "border-indigo-500/40 bg-indigo-500/10 text-indigo-600 dark:text-indigo-300"
                     : "border-border text-muted-foreground hover:bg-accent/60"
                )}>
                <Icon className="h-3.5 w-3.5" />{label}
              </button>
            )
          })}
          <div className="h-5 w-px bg-border mx-1" />
          <button onClick={() => setAtlasOnly(v => !v)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
              atlasOnly ? "border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                        : "border-border text-muted-foreground hover:bg-accent/60"
            )}>
            <Landmark className="h-3.5 w-3.5" /> Atlas overlaps only
          </button>
          <button onClick={refresh} disabled={loading}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent/60 disabled:opacity-50">
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />Refresh
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1">
            {DAYS_OPTIONS.map(d => (
              <button key={d} onClick={() => setDaysBack(d)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors",
                  daysBack === d ? "bg-indigo-600 text-white" : "text-muted-foreground hover:bg-accent/60"
                )}>
                {d}d
              </button>
            ))}
          </div>
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search actor or ticker…"
              className="w-full rounded-lg border border-border bg-card pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total Trades",   value: stats.total,        cls: "text-foreground" },
          { label: "Atlas Overlaps", value: stats.overlaps,     cls: "text-amber-500" },
          { label: "Congress Buys",  value: stats.congressBuys, cls: "text-green-500" },
          { label: "Insider Buys",   value: stats.insiderBuys,  cls: "text-green-500" },
        ].map(s => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground mb-1">{s.label}</p>
            <p className={cn("text-2xl font-black tabular-nums", s.cls)}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Body */}
      {missingKey ? (
        <FinnhubSetup />
      ) : loading ? (
        <div className="rounded-xl border border-border bg-card px-5 py-12 text-center text-sm text-muted-foreground">
          <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2 text-muted-foreground" />
          Loading disclosures…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-card px-5 py-12 text-center">
          <p className="text-sm font-semibold mb-1">No trades match your filters</p>
          <p className="text-xs text-muted-foreground">
            {fetchError ? fetchError : "Try widening the date range, enabling more sources, or turning off “Atlas overlaps only.”"}
          </p>
        </div>
      ) : (
        <TradeTable trades={filtered} />
      )}

      {fetchError && !missingKey && filtered.length > 0 && (
        <p className="text-[11px] text-amber-600 dark:text-amber-500 flex items-center gap-1.5">
          <AlertTriangle className="h-3 w-3" /> Partial data: {fetchError}
        </p>
      )}
    </div>
  )
}

function TradeTable({ trades }: { trades: SmartMoneyTrade[] }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="hidden md:grid grid-cols-[1.6fr_1fr_0.9fr_1.1fr_1.4fr] gap-3 px-4 py-2.5 bg-muted/30 border-b border-border">
        {["Actor", "Ticker / Action", "Value", "Dates", "Atlas overlap"].map(h => (
          <span key={h} className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</span>
        ))}
      </div>
      <div className="divide-y divide-border">
        {trades.map(t => {
          const isBuy  = t.action === "buy" || t.action === "option_call"
          const isSell = t.action === "sell" || t.action === "option_put"
          const actionCls = isBuy ? "text-green-600 dark:text-green-400 bg-green-500/10 ring-green-500/20"
                          : isSell ? "text-red-600 dark:text-red-400 bg-red-500/10 ring-red-500/20"
                          : "text-muted-foreground bg-muted ring-border"
          return (
            <div key={t.id}
              className={cn(
                "grid grid-cols-1 md:grid-cols-[1.6fr_1fr_0.9fr_1.1fr_1.4fr] gap-x-3 gap-y-1.5 px-4 py-3 transition-colors hover:bg-accent/20",
                t.atlasOverlap ? "border-l-2 border-amber-500" : "border-l-2 border-transparent"
              )}>
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{t.actor}</p>
                <p className="text-[11px] text-muted-foreground truncate">{t.role}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold">{t.ticker}</span>
                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ring-1", actionCls)}>
                  {t.action.replace("_", " ")}
                </span>
              </div>
              <div className="flex md:block items-center gap-2">
                <span className="md:hidden text-[10px] text-muted-foreground uppercase">Value</span>
                <span className="text-sm font-semibold tabular-nums">{t.valueEstimate}</span>
              </div>
              <div className="text-[11px] text-muted-foreground leading-tight">
                <span className="text-foreground/80">{fmtDate(t.tradeDate)}</span>
                <span className="block">filed {fmtDate(t.disclosureDate)} · {t.daysLag}d lag</span>
              </div>
              <div className="text-[11px]">
                {t.atlasOverlap ? (
                  <span className="text-amber-700 dark:text-amber-400">
                    <span className="font-semibold">{t.overlapTicker}</span> — {t.overlapReason}
                  </span>
                ) : (
                  <span className="text-muted-foreground/60">No direct overlap</span>
                )}
                {t.sourceUrl && (
                  <a href={t.sourceUrl} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 ml-1 text-indigo-500 hover:underline">
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function FinnhubSetup() {
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.05] px-5 py-6">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className="h-5 w-5 text-amber-500" />
        <p className="text-sm font-bold">Finnhub API key not set</p>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed mb-3">
        The Smart Money feed needs a free Finnhub key. Insider transactions work on the free tier;
        congressional trades may require a Finnhub premium plan.
      </p>
      <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal list-inside">
        <li>Create a free key at <a href="https://finnhub.io/register" target="_blank" rel="noopener noreferrer" className="text-indigo-500 hover:underline">finnhub.io</a>.</li>
        <li>Add <code className="rounded bg-muted px-1 py-0.5 text-[11px]">FINNHUB_API_KEY</code> to your Vercel project environment variables (and <code className="rounded bg-muted px-1 py-0.5 text-[11px]">.env.local</code> for local dev).</li>
        <li>Redeploy. This page will populate automatically.</li>
      </ol>
    </div>
  )
}
