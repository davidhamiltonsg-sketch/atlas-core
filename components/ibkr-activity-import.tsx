"use client"

import { useState, useTransition } from "react"
import { X, RefreshCw, Check, AlertCircle, ArrowUpCircle, Loader2, TrendingUp } from "lucide-react"

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

interface IBKRActivityImportProps {
  onClose: () => void
  onImported: () => void
}

function formatFlexDate(s: string) {
  if (s.length === 8) {
    return new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`).toLocaleDateString("en-GB", {
      day: "numeric", month: "short", year: "2-digit",
    })
  }
  return s
}

export function IBKRActivityImport({ onClose, onImported }: IBKRActivityImportProps) {
  const [state, setState] = useState<"idle" | "fetching" | "preview" | "error">("idle")
  const [executions, setExecutions] = useState<Execution[]>([])
  const [dividends, setDividends] = useState<Dividend[]>([])
  const [accountId, setAccountId] = useState("")
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [importResult, setImportResult] = useState<{ tradesImported: number; dividendsImported: number } | null>(null)
  const [isPending, startTransition] = useTransition()

  // Toggle selection
  const [selectedTrades, setSelectedTrades] = useState<Set<string>>(new Set())
  const [selectedDivs, setSelectedDivs] = useState<Set<string>>(new Set())

  async function handleFetch() {
    setState("fetching")
    setErrorMsg(null)
    try {
      const res = await fetch("/api/sync-ibkr/activity", { method: "POST" })
      const data = await res.json()
      if (!res.ok) {
        setErrorMsg(data.error ?? "Failed to fetch from IBKR")
        setState("error")
        return
      }
      setExecutions(data.executions)
      setDividends(data.dividends)
      setAccountId(data.accountId)
      // Pre-select all new importable items
      setSelectedTrades(new Set(
        (data.executions as Execution[])
          .filter(e => !e.alreadyImported && e.holdingKnown)
          .map(e => e.tradeID)
      ))
      setSelectedDivs(new Set(
        (data.dividends as Dividend[])
          .filter(d => !d.alreadyImported && d.holdingKnown)
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
        body: JSON.stringify({ executions: tradesToImport, dividends: divsToImport }),
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

  const newTrades = executions.filter(e => !e.alreadyImported && e.holdingKnown)
  const newDivs = dividends.filter(d => !d.alreadyImported && d.holdingKnown)
  const totalNew = selectedTrades.size + selectedDivs.size

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative z-10 w-full max-w-xl rounded-2xl border border-border bg-card shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <h2 className="text-sm font-semibold">Import Activity from IBKR</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Pull executed trades and dividends from your FLEX activity report
            </p>
          </div>
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 max-h-[70vh] overflow-y-auto">

          {state === "idle" && (
            <div className="flex flex-col items-center gap-4 py-8">
              <div className="h-14 w-14 rounded-2xl bg-indigo-500/10 flex items-center justify-center">
                <RefreshCw className="h-7 w-7 text-indigo-500" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold">Fetch IBKR Activity</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                  Pulls executed trades and dividend payments from your IBKR FLEX report. Your query must include the <strong>Executions</strong> and <strong>Cash Transactions</strong> sections. Already-imported items are skipped automatically.
                </p>
              </div>
              <button
                onClick={handleFetch}
                className="flex items-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-5 py-2.5 transition-colors"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Fetch from IBKR
              </button>
            </div>
          )}

          {state === "fetching" && (
            <div className="flex flex-col items-center gap-3 py-10">
              <RefreshCw className="h-8 w-8 text-indigo-500 animate-spin" />
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
              Imported {importResult.tradesImported} trade{importResult.tradesImported !== 1 ? "s" : ""} and {importResult.dividendsImported} dividend{importResult.dividendsImported !== 1 ? "s" : ""}
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
                    <span className="text-[10px] text-indigo-500 font-semibold">{newTrades.length} new</span>
                  )}
                </div>
                {executions.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2">No executions in report period.</p>
                ) : (
                  <div className="space-y-1.5">
                    {executions.map(e => {
                      const isSelected = selectedTrades.has(e.tradeID)
                      const canSelect = !e.alreadyImported && e.holdingKnown
                      return (
                        <label
                          key={e.tradeID}
                          className={`flex items-center gap-3 rounded-lg px-3 py-2.5 border transition-colors ${
                            e.alreadyImported
                              ? "border-border bg-muted/30 opacity-50 cursor-not-allowed"
                              : !e.holdingKnown
                              ? "border-border bg-muted/30 opacity-40 cursor-not-allowed"
                              : isSelected
                              ? "border-indigo-500/40 bg-indigo-500/[0.06] cursor-pointer"
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
                                ev.target.checked ? next.add(e.tradeID) : next.delete(e.tradeID)
                                return next
                              })
                            }}
                            className="shrink-0 accent-indigo-600"
                          />
                          <ArrowUpCircle className={`h-3.5 w-3.5 shrink-0 ${e.buySell === "BUY" ? "text-green-500" : "text-red-500"}`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className={`text-xs font-bold ${e.buySell === "BUY" ? "text-green-500" : "text-red-500"}`}>{e.buySell}</span>
                              <span className="text-xs font-semibold">{e.symbol}</span>
                              <span className="text-[11px] text-muted-foreground">{e.quantity} × ${e.price.toFixed(2)}</span>
                              {!e.holdingKnown && <span className="text-[10px] text-muted-foreground italic">not in portfolio</span>}
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
                    <span className="text-[10px] text-indigo-500 font-semibold">{newDivs.length} new</span>
                  )}
                </div>
                {dividends.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2">No dividends in report period.</p>
                ) : (
                  <div className="space-y-1.5">
                    {dividends.map(d => {
                      const isSelected = selectedDivs.has(d.transactionID)
                      const canSelect = !d.alreadyImported && d.holdingKnown
                      return (
                        <label
                          key={d.transactionID}
                          className={`flex items-center gap-3 rounded-lg px-3 py-2.5 border transition-colors ${
                            d.alreadyImported
                              ? "border-border bg-muted/30 opacity-50 cursor-not-allowed"
                              : !d.holdingKnown
                              ? "border-border bg-muted/30 opacity-40 cursor-not-allowed"
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
                                ev.target.checked ? next.add(d.transactionID) : next.delete(d.transactionID)
                                return next
                              })
                            }}
                            className="shrink-0 accent-indigo-600"
                          />
                          <TrendingUp className="h-3.5 w-3.5 shrink-0 text-green-500" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-semibold">{d.symbol}</span>
                              <span className="text-[11px] text-muted-foreground truncate">{d.description}</span>
                              {!d.holdingKnown && <span className="text-[10px] text-muted-foreground italic">not in portfolio</span>}
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
            </div>
          )}
        </div>

        {/* Footer */}
        {state === "preview" && !importResult && (
          <div className="flex items-center justify-between gap-3 p-5 border-t border-border">
            <button
              onClick={onClose}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={isPending || totalNew === 0}
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold px-4 py-2 transition-colors"
            >
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Import {totalNew} item{totalNew !== 1 ? "s" : ""}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
