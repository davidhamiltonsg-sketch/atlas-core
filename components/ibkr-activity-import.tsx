"use client"

import { useEffect, useRef, useState, useTransition, useMemo } from "react"
import { createPortal } from "react-dom"
import { X, RefreshCw, Check, AlertCircle, ArrowUpCircle, Loader2, TrendingUp, Info, ShieldAlert } from "lucide-react"
import { isInScope } from "@/lib/approved-alternatives"
import { formatFlexDate } from "@/lib/ibkr-flex"

interface Execution {
  tradeID: string
  symbol: string
  buySell: "BUY" | "SELL"
  quantity: number
  price: number
  fxRate: number
  tradeDate: string
  alreadyImported: boolean
  holdingKnown: boolean
}

interface Dividend {
  transactionID: string
  symbol: string
  amount: number
  payDate: string
  description: string
  holdingId: string | null
  alreadyImported: boolean
  holdingKnown: boolean
}

interface LedgerEntry {
  externalId: string
  category: string
  symbol: string
  amount: number
  currency: string
  amountBase: number | null
  fxRate: number | null
  date: string
  description: string
  rawType: string
}

interface IBKRActivityImportProps {
  onClose: () => void
  onImported: () => void
}

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function IBKRActivityImport({ onClose, onImported }: IBKRActivityImportProps) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<"idle" | "fetching" | "preview" | "error">("idle")
  const [executions, setExecutions] = useState<Execution[]>([])
  const [dividends, setDividends] = useState<Dividend[]>([])
  const [ledger, setLedger] = useState<LedgerEntry[]>([])
  const [accountId, setAccountId] = useState("")
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [importResult, setImportResult] = useState<{ tradesImported: number; dividendsImported: number; ledgerImported?: number; contributionsImported?: number } | null>(null)
  const [isPending, startTransition] = useTransition()

  // Toggle selection
  const [selectedTrades, setSelectedTrades] = useState<Set<string>>(new Set())
  const [selectedDivs, setSelectedDivs] = useState<Set<string>>(new Set())
  const [behaviourAcknowledged, setBehaviourAcknowledged] = useState(false)

  // Mobile viewport fix: `dvh` doesn't reliably track the visual viewport on every mobile
  // browser (notably when the on-screen keyboard is up), which can let this centred,
  // height-capped dialog compute itself taller than what's actually visible — pushing the
  // footer's action button below the fold with no way to scroll to it (see the identical
  // fix in update-portfolio-modal.tsx). window.visualViewport tracks it correctly.
  const [viewportHeight, setViewportHeight] = useState<number | null>(null)
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null
    if (!vv) return
    const update = () => setViewportHeight(vv.height)
    update()
    vv.addEventListener("resize", update)
    vv.addEventListener("scroll", update)
    return () => {
      vv.removeEventListener("resize", update)
      vv.removeEventListener("scroll", update)
    }
  }, [])

  useEffect(() => {
    closeRef.current?.focus()

    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { onClose(); return }
      if (event.key !== "Tab") return
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      if (!focusable || focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])

  async function handleFetch() {
    setState("fetching")
    setErrorMsg(null)
    try {
      const res = await fetch("/api/sync-ibkr/activity", { method: "POST" })
      const data = await res.json()
      if (!res.ok || data.error) {
        setErrorMsg(data.error ?? "Failed to fetch from IBKR")
        setState("error")
        return
      }
      setExecutions(data.executions)
      setDividends(data.dividends)
      setLedger(data.ledger ?? [])
      setAccountId(data.accountId)
      // Pre-select all new importable items. New tickers (not yet in the portfolio) ARE
      // included — importing them creates the holding so they populate the whole app.
      setSelectedTrades(new Set(
        (data.executions as Execution[])
          .filter(e => !e.alreadyImported)
          .map(e => e.tradeID)
      ))
      setSelectedDivs(new Set(
        (data.dividends as Dividend[])
          .filter(d => !d.alreadyImported)
          .map(d => d.transactionID)
      ))
      setState("preview")
    } catch {
      setErrorMsg("Network error — check your connection")
      setState("error")
    }
  }

  function handleConfirm() {
    const tradesToImport = executions.filter(e => selectedTrades.has(e.tradeID))
    const divsToImport = dividends.filter(d => selectedDivs.has(d.transactionID))

    startTransition(async () => {
      const res = await fetch("/api/sync-ibkr/activity", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ executions: tradesToImport, dividends: divsToImport, ledger }),
      })
      if (res.ok) {
        const result = await res.json()
        setImportResult(result)
        setTimeout(() => { onImported(); onClose() }, 2000)
      } else {
        const d = await res.json()
        setErrorMsg(d.error ?? "Import failed")
      }
    })
  }

  const newTrades = executions.filter(e => !e.alreadyImported)
  const newDivs = dividends.filter(d => !d.alreadyImported)
  const totalNew = selectedTrades.size + selectedDivs.size + ledger.length

  // Units reconciliation: aggregate net unit changes for selected trades
  const sellSummary = useMemo(() => {
    const map: Record<string, number> = {}
    for (const e of executions) {
      if (!selectedTrades.has(e.tradeID)) continue
      if (!map[e.symbol]) map[e.symbol] = 0
      map[e.symbol] += e.buySell === "SELL" ? -e.quantity : e.quantity
    }
    return map
  }, [executions, selectedTrades])

  const hasSells = executions.some(e => selectedTrades.has(e.tradeID) && e.buySell === "SELL")
  const canImport = totalNew > 0 && (!hasSells || behaviourAcknowledged)

  // Portal straight to document.body — see the identical fix (and rationale) in
  // update-portfolio-modal.tsx: a `backdrop-filter`/`transform` on an ancestor `bg-card`
  // panel creates a new containing block for this dialog's `position: fixed`, silently
  // shrinking it to that panel's box instead of the real viewport.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ibkr-activity-title"
        style={viewportHeight ? { maxHeight: `${viewportHeight - 16}px` } : undefined}
        className="relative z-10 flex max-h-[calc(100dvh-16px)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <h2 id="ibkr-activity-title" className="text-sm font-semibold">Import Activity from IBKR</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Pull executed trades and dividends from your FLEX activity report
            </p>
          </div>
          <button ref={closeRef} onClick={onClose} aria-label="Close IBKR activity import" className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto p-5">

          {state === "idle" && (
            <div className="flex flex-col items-center gap-4 py-8">
              <div className="h-14 w-14 rounded-2xl bg-violet-500/10 flex items-center justify-center">
                <RefreshCw className="h-7 w-7 text-violet-500" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold">Fetch IBKR Activity</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                  Pulls executed trades and dividend payments from your IBKR FLEX report. Your query must include the <strong>Executions</strong> and <strong>Cash Transactions</strong> sections. Already-imported items are skipped automatically.
                </p>
              </div>
              <button
                onClick={handleFetch}
                className="flex items-center gap-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold px-5 py-2.5 transition-colors"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Fetch from IBKR
              </button>
            </div>
          )}

          {state === "fetching" && (
            <div className="flex flex-col items-center gap-3 py-10">
              <RefreshCw className="h-8 w-8 text-violet-500 animate-spin" />
              <p className="text-sm font-medium">Fetching activity report…</p>
              <p className="text-xs text-muted-foreground">Generating FLEX report — usually 5–15 seconds</p>
            </div>
          )}

          {state === "error" && (
            <div className="rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 p-4">
              <div className="flex items-start gap-2 mb-3">
                <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-red-600 dark:text-red-400">Fetch failed</p>
                  <p className="text-xs text-red-500 mt-0.5">{errorMsg}</p>
                </div>
              </div>
              <button
                onClick={() => { setState("idle"); setErrorMsg(null) }}
                className="text-xs text-red-600 dark:text-red-400 underline"
              >
                Try again
              </button>
            </div>
          )}

          {importResult && (
            <div className="flex items-center gap-2 rounded-lg bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20 px-4 py-3 text-xs font-medium text-green-700 dark:text-green-400">
              <Check className="h-4 w-4 shrink-0" />
              Imported {importResult.tradesImported} trade{importResult.tradesImported !== 1 ? "s" : ""}, {importResult.dividendsImported} dividend{importResult.dividendsImported !== 1 ? "s" : ""}, and {importResult.ledgerImported ?? 0} cash/adjustment entr{(importResult.ledgerImported ?? 0) === 1 ? "y" : "ies"}
            </div>
          )}

          {state === "preview" && !importResult && (
            <div className="space-y-5">
              {accountId && (
                <p className="text-[11px] text-muted-foreground">Account: {accountId}</p>
              )}

              {/* Executions */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                    Trades ({executions.length})
                  </h3>
                  {newTrades.length > 0 && (
                    <span className="text-[10px] text-violet-500 font-semibold">{newTrades.length} new</span>
                  )}
                </div>
                {executions.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2">
                    No executions found. Your FLEX query may not include an <strong>Executions</strong> section — add it in IBKR → Reports → Flex Queries, or set <code className="text-[10px] bg-muted px-1 rounded">IBKR_FLEX_QUERY_ID_ACTIVITY</code> in your .env.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {executions.map(e => {
                      const isSelected = selectedTrades.has(e.tradeID)
                      const canSelect = !e.alreadyImported
                      return (
                        <label
                          key={e.tradeID}
                          className={`flex items-center gap-3 rounded-lg px-3 py-2.5 border transition-colors ${
                            e.alreadyImported
                              ? "border-border bg-muted/30 opacity-50 cursor-not-allowed"
                              : isSelected
                              ? "border-violet-500/40 bg-violet-500/[0.06] cursor-pointer"
                              : "border-border bg-card cursor-pointer hover:bg-accent/30"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={!canSelect}
                            onChange={ev => {
                              setSelectedTrades(prev => {
                                const next = new Set(prev)
                                if (ev.target.checked) next.add(e.tradeID)
                                else next.delete(e.tradeID)
                                return next
                              })
                            }}
                            className="shrink-0 accent-violet-600"
                          />
                          <ArrowUpCircle className={`h-3.5 w-3.5 shrink-0 ${e.buySell === "BUY" ? "text-green-500" : "text-red-500"}`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className={`text-xs font-bold ${e.buySell === "BUY" ? "text-green-500" : "text-red-500"}`}>{e.buySell}</span>
                              <span className="text-xs font-semibold">{e.symbol}</span>
                              <span className="text-[11px] text-muted-foreground">{e.quantity} × ${e.price.toFixed(2)}</span>
                              {!e.holdingKnown && <span className="text-[10px] text-violet-400 italic">new — will be added</span>}
                              {!isInScope(e.symbol) && <span className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold">not in plan</span>}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-[11px] tabular-nums font-semibold">
                              S${(e.quantity * e.price * e.fxRate).toLocaleString("en-SG", { maximumFractionDigits: 0 })}
                            </div>
                            <div className="text-[10px] text-muted-foreground">{formatFlexDate(e.tradeDate)}</div>
                          </div>
                          {e.alreadyImported && (
                            <span className="text-[10px] text-muted-foreground italic shrink-0">imported</span>
                          )}
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Dividends */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                    Dividends ({dividends.length})
                  </h3>
                  {newDivs.length > 0 && (
                    <span className="text-[10px] text-violet-500 font-semibold">{newDivs.length} new</span>
                  )}
                </div>
                {dividends.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2">
                    No dividends found. Add a <strong>Cash Transactions</strong> section (type = Dividends) to your FLEX query.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {dividends.map(d => {
                      const isSelected = selectedDivs.has(d.transactionID)
                      const canSelect = !d.alreadyImported
                      return (
                        <label
                          key={d.transactionID}
                          className={`flex items-center gap-3 rounded-lg px-3 py-2.5 border transition-colors ${
                            d.alreadyImported
                              ? "border-border bg-muted/30 opacity-50 cursor-not-allowed"
                              : isSelected
                              ? "border-green-500/40 bg-green-500/[0.04] cursor-pointer"
                              : "border-border bg-card cursor-pointer hover:bg-accent/30"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={!canSelect}
                            onChange={ev => {
                              setSelectedDivs(prev => {
                                const next = new Set(prev)
                                if (ev.target.checked) next.add(d.transactionID)
                                else next.delete(d.transactionID)
                                return next
                              })
                            }}
                            className="shrink-0 accent-violet-600"
                          />
                          <TrendingUp className="h-3.5 w-3.5 shrink-0 text-green-500" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-semibold">{d.symbol}</span>
                              <span className="text-[11px] text-muted-foreground truncate">{d.description}</span>
                              {!d.holdingKnown && <span className="text-[10px] text-violet-400 italic">new — will be added</span>}
                              {!isInScope(d.symbol) && <span className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold">not in plan</span>}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-[11px] tabular-nums font-semibold text-green-500">
                              +S${d.amount.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </div>
                            <div className="text-[10px] text-muted-foreground">{formatFlexDate(d.payDate)}</div>
                          </div>
                          {d.alreadyImported && (
                            <span className="text-[10px] text-muted-foreground italic shrink-0">imported</span>
                          )}
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Cash movements, fees, taxes, interest and corporate actions */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                    Cash &amp; adjustments ({ledger.length})
                  </h3>
                  {ledger.length > 0 && <span className="text-[10px] text-violet-500 font-semibold">deduplicated automatically</span>}
                </div>
                {ledger.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2">No deposits, withdrawals, fees, taxes, interest or corporate actions were returned. Include Cash Transactions and Corporate Actions in the Flex query.</p>
                ) : (
                  <div className="space-y-1.5">
                    {ledger.map(entry => (
                      <div key={entry.externalId} className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5">
                        <span className="rounded-full border border-border px-2 py-0.5 text-[9px] font-bold text-muted-foreground">{entry.category.replaceAll("_", " ")}</span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[11px] font-medium">{entry.description || entry.rawType}</p>
                          <p className="text-[10px] text-muted-foreground">{entry.symbol || entry.currency} · {formatFlexDate(entry.date)}</p>
                        </div>
                        <span className={`text-[11px] font-semibold tabular-nums ${entry.amount >= 0 ? "text-green-500" : "text-red-500"}`}>
                          {entry.amount >= 0 ? "+" : ""}{entry.amount.toLocaleString("en-SG", { maximumFractionDigits: 2 })} {entry.currency}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            {/* Units reconciliation notice — shown whenever there are net unit changes */}
            {Object.keys(sellSummary).some(k => sellSummary[k] !== 0) && (
              <div className="rounded-lg border border-blue-400/30 bg-blue-400/5 px-4 py-3 flex items-start gap-2">
                <Info className="h-3.5 w-3.5 text-blue-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-[11px] font-semibold text-blue-500">Update your portfolio snapshot after import</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Trade log records the transaction — snapshot units must also be updated manually on the Portfolio page:
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {Object.entries(sellSummary)
                      .filter(([, delta]) => delta !== 0)
                      .map(([ticker, delta]) => (
                        <li key={ticker} className="text-[11px] tabular-nums font-semibold">
                          <span className={delta > 0 ? "text-green-500" : "text-red-500"}>
                            {ticker}: {delta > 0 ? "+" : ""}{delta} units
                          </span>
                        </li>
                      ))}
                  </ul>
                </div>
              </div>
            )}

            {/* Behaviour log gate — required acknowledgment for SELL trades */}
            {hasSells && (
              <label className="flex items-start gap-3 rounded-lg border border-amber-400/40 bg-amber-400/5 px-4 py-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={behaviourAcknowledged}
                  onChange={e => setBehaviourAcknowledged(e.target.checked)}
                  className="mt-0.5 shrink-0 accent-amber-500"
                />
                <div className="flex items-start gap-1.5">
                  <ShieldAlert className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-amber-700 dark:text-amber-400">
                    <span className="font-semibold">Governance gate:</span> I confirm this sale was reviewed against the investment policy (v6.7 §2–3), justified by the Behaviour Log, and does not constitute panic selling or speculation.
                  </p>
                </div>
              </label>
            )}
            </div>
          )}
        </div>

        {/* Footer */}
        {state === "preview" && !importResult && (
          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            <button
              onClick={onClose}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={isPending || !canImport}
              className="flex items-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-xs font-semibold px-4 py-2 transition-colors"
            >
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Import {totalNew} item{totalNew !== 1 ? "s" : ""}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
