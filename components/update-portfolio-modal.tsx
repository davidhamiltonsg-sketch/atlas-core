"use client"

import { useEffect, useState, useRef, useTransition } from "react"
import { createPortal } from "react-dom"
import { X, Upload, Pencil, Check, AlertCircle, Loader2, Camera, RefreshCw, ArrowUpCircle, TrendingUp, Info, ShieldAlert } from "lucide-react"
import { updateHoldingsManually, extractFromScreenshot, applyExtractedHoldings, type NeedsConfirmationRow } from "@/app/portfolio/actions"
import { isInScope } from "@/lib/approved-alternatives"
import { formatFlexDate } from "@/lib/ibkr-flex"

interface Holding {
  id: string
  ticker: string
  name: string
  latestUnits: number
  latestPrice: number
}

interface ExtractedRow {
  ticker: string
  units: number
  price: number
  value: number
}

interface IBKRPosition {
  symbol: string
  units: number
  markPrice: number
  positionValue: number
  currency: string
  holdingId: string | null
  matched: boolean
  prevUnits: number | null
  prevPrice: number | null
}

interface IBKRExecution {
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

interface IBKRDividend {
  transactionID: string
  symbol: string
  amount: number
  payDate: string
  description: string
  holdingId: string | null
  alreadyImported: boolean
  holdingKnown: boolean
}

interface IBKRLedgerEntry {
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

interface UpdatePortfolioModalProps {
  holdings: Holding[]
  onClose: () => void
  defaultMode?: "choose" | "manual" | "screenshot" | "ibkr"
}

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function UpdatePortfolioModal({ holdings, onClose, defaultMode = "choose" }: UpdatePortfolioModalProps) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<"choose" | "manual" | "screenshot" | "ibkr">(defaultMode)

  // Mobile keyboard fix: the on-screen keyboard shrinks the VISUAL viewport, but the CSS
  // `dvh` unit the dialog's max-height falls back to doesn't reliably track that shrink on
  // every mobile browser — so a centred, height-capped dialog could compute itself taller
  // than what's actually visible once the keyboard is up (this form is nothing but number
  // inputs), pushing the footer's Save button below the fold with no way to scroll to it.
  // window.visualViewport DOES track the keyboard, so use it to cap the dialog live.
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

  // Manual state
  const [manualValues, setManualValues] = useState<Record<string, { units: string; price: string }>>(
    Object.fromEntries(holdings.map((h) => [h.id, { units: String(h.latestUnits), price: String(h.latestPrice) }]))
  )

  // Screenshot state
  const [screenshotState, setScreenshotState] = useState<"idle" | "processing" | "preview" | "flagged" | "error">("idle")
  const [extractedRows, setExtractedRows] = useState<ExtractedRow[]>([])
  const [flaggedRows, setFlaggedRows] = useState<NeedsConfirmationRow[]>([])
  const [extractError, setExtractError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // IBKR state — positions (required half of the closing refresh)
  const [ibkrState, setIbkrState] = useState<"idle" | "fetching" | "preview" | "error">("idle")
  const [ibkrPositions, setIbkrPositions] = useState<IBKRPosition[]>([])
  const [ibkrError, setIbkrError] = useState<string | null>(null)
  const [ibkrMeta, setIbkrMeta] = useState<{ accountId: string; reportDate: string } | null>(null)

  // IBKR state — activity (trades/dividends/cash). Optional half: if this fails or isn't
  // configured, positions can still be reviewed and saved on their own.
  const [activityState, setActivityState] = useState<"idle" | "loaded" | "unavailable">("idle")
  const [activityError, setActivityError] = useState<string | null>(null)
  const [executions, setExecutions] = useState<IBKRExecution[]>([])
  const [dividends, setDividends] = useState<IBKRDividend[]>([])
  const [ledger, setLedger] = useState<IBKRLedgerEntry[]>([])
  const [selectedTrades, setSelectedTrades] = useState<Set<string>>(new Set())
  const [selectedDivs, setSelectedDivs] = useState<Set<string>>(new Set())
  const [behaviourAcknowledged, setBehaviourAcknowledged] = useState(false)
  const [saveSummary, setSaveSummary] = useState<{ positions: number; trades: number; dividends: number; ledger: number } | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const [isPending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)

  // Opening straight into "ibkr" mode (defaultMode="ibkr", skipping the choose screen) has
  // nothing to fetch it automatically the way the choose-screen's card onClick does — kick
  // it off here instead. Guarded on ibkrState==="idle" so it fires once on mount and never
  // re-fires from the choose-screen path (which already sets ibkrState past "idle" in the
  // same synchronous click handler before this effect re-evaluates).
  useEffect(() => {
    if (mode === "ibkr" && ibkrState === "idle") handleIBKRSync()
  }, [mode, ibkrState])

  useEffect(() => {
    closeRef.current?.focus()

    // Lock body scroll behind the modal while it's open, restoring whatever was there before.
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { onClose(); return }
      if (event.key !== "Tab") return
      // Focus trap: keep Tab/Shift+Tab cycling within the dialog instead of escaping to the page behind it.
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

  // ── Manual ────────────────────────────────────────────────────────────────

  function handleManualChange(holdingId: string, field: "units" | "price", value: string) {
    setManualValues((prev) => ({ ...prev, [holdingId]: { ...prev[holdingId], [field]: value } }))
  }

  function handleSaveManual() {
    const updates = holdings.map((h) => {
      const v = manualValues[h.id]
      return { holdingId: h.id, units: parseFloat(v.units) || 0, price: parseFloat(v.price) || 0 }
    }).filter((u) => u.units > 0 && u.price > 0)

    startTransition(async () => {
      await updateHoldingsManually(updates)
      setSaved(true)
      setTimeout(() => { setSaved(false); onClose() }, 1200)
    })
  }

  // ── Screenshot ────────────────────────────────────────────────────────────

  // Downscale a screenshot in the browser before sending it to the server action. Phone
  // screenshots are multiple MB; a Server Action request body is capped (~1MB by default), so an
  // un-resized image is rejected BEFORE the action runs — which previously left the modal stuck
  // on "Analysing…" forever. Resizing to a ~1600px JPEG keeps the payload well under the limit
  // and speeds up the vision call.
  async function downscaleScreenshot(file: File, maxEdge = 1600, quality = 0.8): Promise<{ base64: string; mime: string }> {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(r.result as string)
      r.onerror = () => reject(new Error("Could not read the image file"))
      r.readAsDataURL(file)
    })
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => reject(new Error("Could not decode the image"))
      i.src = dataUrl
    })
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height))
    const ctx = scale < 1 ? document.createElement("canvas").getContext("2d") : null
    if (!ctx) return { base64: dataUrl.split(",")[1], mime: file.type } // already small enough
    ctx.canvas.width = Math.round(img.width * scale)
    ctx.canvas.height = Math.round(img.height * scale)
    ctx.drawImage(img, 0, 0, ctx.canvas.width, ctx.canvas.height)
    return { base64: ctx.canvas.toDataURL("image/jpeg", quality).split(",")[1], mime: "image/jpeg" }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setScreenshotState("processing")
    setExtractError(null)
    // try/catch so a failed action (oversized body, timeout, network) surfaces an error instead of
    // leaving the spinner stuck forever — the previous code awaited inside reader.onload with no catch.
    try {
      let base64: string, mime: string
      if (file.type === "application/pdf") {
        // PDFs go through unmodified (no canvas downscale) — cap the size so the base64 body
        // stays inside the server-action limit (next.config: 8mb).
        if (file.size > 4 * 1024 * 1024) {
          throw new Error("This PDF is larger than 4 MB — export a shorter statement (positions section only) or use a screenshot instead.")
        }
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const r = new FileReader()
          r.onload = () => resolve(r.result as string)
          r.onerror = () => reject(new Error("Could not read the PDF file"))
          r.readAsDataURL(file)
        })
        base64 = dataUrl.split(",")[1]
        mime = "application/pdf"
      } else {
        ;({ base64, mime } = await downscaleScreenshot(file))
      }
      // Single-object payload on purpose: bare string args count toward the flight decoder's
      // 1M array-slot budget and a base64 PDF exceeds it (see extractFromScreenshot).
      const result = await extractFromScreenshot({ imageBase64: base64, mimeType: mime })
      if (result.success) {
        setExtractedRows(result.data)
        setScreenshotState("preview")
      } else {
        setExtractError(result.error)
        setScreenshotState("error")
      }
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : "Could not process the screenshot — try again or use Manual entry.")
      setScreenshotState("error")
    }
  }

  function handleConfirmScreenshot() {
    // Safe rows apply immediately; anything the server judges suspicious (unknown ticker,
    // >5× unit jump, >3× portfolio swing) comes back as needsConfirmation and is shown for
    // an explicit second confirmation — misread screenshots can no longer mint phantom
    // positions or silently overwrite governed rows.
    const rows = extractedRows
      .filter((r) => r.units > 0 && r.price > 0)
      .map((r) => ({ ticker: r.ticker, units: r.units, price: r.price, value: r.value }))

    startTransition(async () => {
      const result = await applyExtractedHoldings(rows)
      if (result.needsConfirmation.length > 0) {
        setFlaggedRows(result.needsConfirmation)
        setScreenshotState("flagged")
        return
      }
      setSaved(true)
      setTimeout(() => { setSaved(false); onClose() }, 1200)
    })
  }

  function handleConfirmFlagged() {
    startTransition(async () => {
      await applyExtractedHoldings(
        flaggedRows.map((r) => ({ ticker: r.ticker, units: r.units, price: r.price, value: r.value })),
        { confirmed: true },
      )
      setFlaggedRows([])
      setSaved(true)
      setTimeout(() => { setSaved(false); onClose() }, 1200)
    })
  }

  // ── IBKR FLEX — "Closing Refresh": positions (units/price/cost basis) AND activity
  // (trades/dividends/cash/tax) fetched together, reviewed together, saved together. ──

  async function handleIBKRSync() {
    setIbkrState("fetching")
    setIbkrError(null)
    setActivityState("idle")
    setActivityError(null)
    setSaveSummary(null)
    setSaveError(null)

    const [posResult, actResult] = await Promise.all([
      fetch("/api/sync-ibkr", { method: "POST" })
        .then(async (res) => ({ ok: res.ok, data: await res.json() }))
        .catch(() => ({ ok: false, data: { error: "Network error — check your connection" } })),
      fetch("/api/sync-ibkr/activity", { method: "POST" })
        .then(async (res) => ({ ok: res.ok, data: await res.json() }))
        .catch(() => ({ ok: false, data: { error: "Network error — check your connection" } })),
    ])

    // Positions is the required half — without it there's nothing to review.
    if (!posResult.ok) {
      setIbkrError(posResult.data.error ?? "Failed to fetch from IBKR")
      setIbkrState("error")
      return
    }
    setIbkrPositions(posResult.data.positions)
    setIbkrMeta({ accountId: posResult.data.accountId, reportDate: posResult.data.reportDate })
    setIbkrState("preview")

    // Activity is optional — not configured or transiently unavailable never blocks positions.
    if (!actResult.ok) {
      setActivityError(actResult.data.error ?? "Failed to fetch activity from IBKR")
      setActivityState("unavailable")
      return
    }
    setExecutions(actResult.data.executions)
    setDividends(actResult.data.dividends)
    setLedger(actResult.data.ledger ?? [])
    setSelectedTrades(new Set(
      (actResult.data.executions as IBKRExecution[]).filter((e) => !e.alreadyImported).map((e) => e.tradeID)
    ))
    setSelectedDivs(new Set(
      (actResult.data.dividends as IBKRDividend[]).filter((d) => !d.alreadyImported).map((d) => d.transactionID)
    ))
    setActivityState("loaded")
  }

  const hasSells = executions.some((e) => selectedTrades.has(e.tradeID) && e.buySell === "SELL")
  const canConfirmIBKR = ibkrPositions.length > 0 && (!hasSells || behaviourAcknowledged)

  function handleConfirmIBKR() {
    // Send ALL positions — matched ones update in place, new tickers (e.g. IBIT) are created.
    // Positions already carry IBKR's own reported cost basis/unrealised P&L, so saving them
    // reflects the true post-trade state directly — no separate "go update units manually"
    // reconciliation step needed once activity is imported alongside.
    startTransition(async () => {
      setSaveError(null)
      const posRes = await fetch("/api/sync-ibkr", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          positions: ibkrPositions.map((p) => ({
            holdingId:     p.holdingId,
            symbol:        p.symbol,
            units:         p.units,
            markPrice:     p.markPrice,
            positionValue: p.positionValue,
          })),
        }),
      })
      if (!posRes.ok) {
        const d = await posRes.json().catch(() => ({}))
        setSaveError(d.error ?? "Failed to save positions")
        return
      }
      const posData = await posRes.json()

      let actSummary = { trades: 0, dividends: 0, ledger: 0 }
      const tradesToImport = executions.filter((e) => selectedTrades.has(e.tradeID))
      const divsToImport = dividends.filter((d) => selectedDivs.has(d.transactionID))
      if (activityState === "loaded" && (tradesToImport.length > 0 || divsToImport.length > 0 || ledger.length > 0)) {
        const actRes = await fetch("/api/sync-ibkr/activity", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ executions: tradesToImport, dividends: divsToImport, ledger }),
        })
        // Positions are already saved at this point — an activity failure here is surfaced
        // as a partial result, not rolled back or blocked.
        if (actRes.ok) {
          const actData = await actRes.json()
          actSummary = { trades: actData.tradesImported, dividends: actData.dividendsImported, ledger: actData.ledgerImported ?? 0 }
        } else {
          const d = await actRes.json().catch(() => ({}))
          setActivityError(d.error ?? "Positions saved, but activity import failed")
        }
      }

      setSaveSummary({ positions: posData.updated ?? ibkrPositions.length, ...actSummary })
      setSaved(true)
      setTimeout(() => { setSaved(false); onClose() }, 2400)
    })
  }

  // ── Render ────────────────────────────────────────────────────────────────

  // Portal straight to document.body: this dialog is opened from buttons nested inside
  // `bg-card`-classed panels, and `.atlas-shell main .bg-card` carries a permanent
  // `backdrop-filter` (app/globals.css) — any CSS filter/transform/backdrop-filter on an
  // ancestor creates a new containing block for `position: fixed` descendants, so without
  // a portal this dialog's "fixed inset-0" was being sized against that small card's box
  // instead of the real viewport, clipping it and leaving the Save button unreachable.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-portfolio-title"
        style={viewportHeight ? { maxHeight: `${viewportHeight - 16}px` } : undefined}
        className="relative z-10 flex max-h-[calc(100dvh-16px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <h2 id="update-portfolio-title" className="text-sm font-semibold">Update Portfolio Values</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Closing refresh from IBKR, or enter manually</p>
          </div>
          <button ref={closeRef} onClick={onClose} aria-label="Close portfolio update" className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto p-5">

          {/* Mode choose */}
          {mode === "choose" && (
            <div className="grid grid-cols-3 gap-3">
              {/* IBKR Sync */}
              <button
                onClick={() => { setMode("ibkr"); handleIBKRSync() }}
                className="flex flex-col items-center gap-3 rounded-xl border border-violet-500/30 bg-violet-500/[0.06] p-4 hover:bg-violet-500/10 transition-colors text-left group"
              >
                <div className="h-10 w-10 rounded-xl bg-violet-100 dark:bg-violet-500/15 flex items-center justify-center group-hover:bg-violet-200 dark:group-hover:bg-violet-500/25 transition-colors">
                  <RefreshCw className="h-5 w-5 text-violet-600 dark:text-violet-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold">Closing Refresh</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Positions, cost basis, trades, dividends &amp; cash from IBKR</p>
                </div>
              </button>

              {/* Manual */}
              <button
                onClick={() => setMode("manual")}
                className="flex flex-col items-center gap-3 rounded-xl border border-border p-4 hover:bg-accent/50 transition-colors text-left group"
              >
                <div className="h-10 w-10 rounded-xl bg-muted flex items-center justify-center group-hover:bg-accent transition-colors">
                  <Pencil className="h-5 w-5 text-muted-foreground group-hover:text-foreground" />
                </div>
                <div>
                  <p className="text-sm font-semibold">Manual</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Enter units and price</p>
                </div>
              </button>

              {/* Screenshot */}
              <button
                onClick={() => setMode("screenshot")}
                className="flex flex-col items-center gap-3 rounded-xl border border-border p-4 hover:bg-accent/50 transition-colors text-left group"
              >
                <div className="h-10 w-10 rounded-xl bg-muted flex items-center justify-center group-hover:bg-accent transition-colors">
                  <Camera className="h-5 w-5 text-muted-foreground group-hover:text-foreground" />
                </div>
                <div>
                  <p className="text-sm font-semibold">Screenshot</p>
                  <p className="text-xs text-muted-foreground mt-0.5">AI reads IBKR screenshot</p>
                </div>
              </button>
            </div>
          )}

          {/* IBKR mode */}
          {mode === "ibkr" && (
            <div>
              {ibkrState === "fetching" && (
                <div className="flex flex-col items-center gap-3 py-10">
                  <RefreshCw className="h-8 w-8 text-violet-500 animate-spin" />
                  <p className="text-sm font-medium">Fetching from IBKR…</p>
                  <p className="text-xs text-muted-foreground">Generating FLEX report — usually takes 5–10 seconds</p>
                </div>
              )}

              {ibkrState === "error" && (
                <div className="rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 p-4">
                  <div className="flex items-start gap-2 mb-3">
                    <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-semibold text-red-600 dark:text-red-400">IBKR sync failed</p>
                      <p className="text-xs text-red-500 mt-0.5">{ibkrError}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => { setIbkrState("idle"); handleIBKRSync() }}
                    className="text-xs text-red-600 dark:text-red-400 underline"
                  >
                    Retry
                  </button>
                </div>
              )}

              {ibkrState === "preview" && (
                <div>
                  {ibkrMeta && (
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-xs font-medium text-muted-foreground">
                        Review positions — report date: <span className="text-foreground">{ibkrMeta.reportDate}</span>
                      </p>
                      <span className="text-[10px] text-muted-foreground">{ibkrMeta.accountId}</span>
                    </div>
                  )}
                  <div className="space-y-2 mb-1">
                    {ibkrPositions.map((pos) => {
                      const offScope = !isInScope(pos.symbol)
                      return (
                      <div
                        key={pos.symbol}
                        className={`flex items-center justify-between rounded-lg px-3 py-2.5 border ${
                          pos.matched
                            ? "bg-green-50 dark:bg-green-500/10 border-green-200 dark:border-green-500/20"
                            : "bg-violet-50 dark:bg-violet-500/[0.08] border-violet-200 dark:border-violet-500/20"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          {pos.matched
                            ? <Check className="h-3.5 w-3.5 text-green-500" />
                            : <ArrowUpCircle className="h-3.5 w-3.5 text-violet-500" />
                          }
                          <span className="text-xs font-bold">{pos.symbol}</span>
                          {!pos.matched && <span className="text-[10px] text-violet-500">new — will be added</span>}
                          {offScope && <span className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold">not in plan</span>}
                        </div>
                        <div className="text-right">
                          <span className="text-xs font-semibold tabular-nums">
                            S${pos.positionValue.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                          <span className="text-[11px] text-muted-foreground ml-2 tabular-nums">
                            {pos.units} × {pos.units > 0 && pos.positionValue > 0 ? `S$${(pos.positionValue / pos.units).toFixed(2)}` : `${pos.markPrice.toFixed(2)} (fund ccy)`}
                          </span>
                          {pos.prevUnits !== null && pos.prevUnits !== pos.units && (
                            <span className="ml-2 text-[10px] text-amber-500">
                              was {pos.prevUnits}u
                            </span>
                          )}
                        </div>
                      </div>
                      )
                    })}
                  </div>
                  {ibkrPositions.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-2">
                      No open positions returned by IBKR.
                    </p>
                  )}

                  {/* Activity — optional half of the closing refresh */}
                  {activityState === "unavailable" && (
                    <div className="mt-4 rounded-lg border border-amber-300/40 bg-amber-400/5 px-3 py-2.5 flex items-start gap-2">
                      <Info className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-400">Trades, dividends &amp; cash weren&apos;t pulled</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">{activityError} Positions above are still current and can be saved on their own.</p>
                      </div>
                    </div>
                  )}

                  {activityState === "loaded" && (
                    <div className="mt-5 space-y-5">
                      {/* Trades */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Trades ({executions.length})</h3>
                          {executions.some((e) => !e.alreadyImported) && (
                            <span className="text-[10px] text-violet-500 font-semibold">{executions.filter((e) => !e.alreadyImported).length} new</span>
                          )}
                        </div>
                        {executions.length === 0 ? (
                          <p className="text-xs text-muted-foreground py-1">No executions in this period.</p>
                        ) : (
                          <div className="space-y-1.5">
                            {executions.map((e) => {
                              const isSelected = selectedTrades.has(e.tradeID)
                              const canSelect = !e.alreadyImported
                              return (
                                <label key={e.tradeID} className={`flex items-center gap-3 rounded-lg px-3 py-2 border transition-colors ${
                                  e.alreadyImported ? "border-border bg-muted/30 opacity-50 cursor-not-allowed"
                                    : isSelected ? "border-violet-500/40 bg-violet-500/[0.06] cursor-pointer"
                                    : "border-border bg-card cursor-pointer hover:bg-accent/30"
                                }`}>
                                  <input type="checkbox" checked={isSelected} disabled={!canSelect} className="shrink-0 accent-violet-600"
                                    onChange={(ev) => setSelectedTrades((prev) => {
                                      const next = new Set(prev)
                                      if (ev.target.checked) next.add(e.tradeID); else next.delete(e.tradeID)
                                      return next
                                    })}
                                  />
                                  <ArrowUpCircle className={`h-3.5 w-3.5 shrink-0 ${e.buySell === "BUY" ? "text-green-500" : "text-red-500"}`} />
                                  <div className="flex-1 min-w-0 flex items-center gap-1.5">
                                    <span className={`text-xs font-bold ${e.buySell === "BUY" ? "text-green-500" : "text-red-500"}`}>{e.buySell}</span>
                                    <span className="text-xs font-semibold">{e.symbol}</span>
                                    <span className="text-[11px] text-muted-foreground">{e.quantity} × ${e.price.toFixed(2)}</span>
                                    {!e.holdingKnown && <span className="text-[10px] text-violet-400 italic">new</span>}
                                  </div>
                                  <span className="text-[10px] text-muted-foreground shrink-0">{formatFlexDate(e.tradeDate)}</span>
                                  {e.alreadyImported && <span className="text-[10px] text-muted-foreground italic shrink-0">imported</span>}
                                </label>
                              )
                            })}
                          </div>
                        )}
                      </div>

                      {/* Dividends */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Dividends ({dividends.length})</h3>
                          {dividends.some((d) => !d.alreadyImported) && (
                            <span className="text-[10px] text-violet-500 font-semibold">{dividends.filter((d) => !d.alreadyImported).length} new</span>
                          )}
                        </div>
                        {dividends.length === 0 ? (
                          <p className="text-xs text-muted-foreground py-1">No dividends in this period.</p>
                        ) : (
                          <div className="space-y-1.5">
                            {dividends.map((d) => {
                              const isSelected = selectedDivs.has(d.transactionID)
                              const canSelect = !d.alreadyImported
                              return (
                                <label key={d.transactionID} className={`flex items-center gap-3 rounded-lg px-3 py-2 border transition-colors ${
                                  d.alreadyImported ? "border-border bg-muted/30 opacity-50 cursor-not-allowed"
                                    : isSelected ? "border-green-500/40 bg-green-500/[0.04] cursor-pointer"
                                    : "border-border bg-card cursor-pointer hover:bg-accent/30"
                                }`}>
                                  <input type="checkbox" checked={isSelected} disabled={!canSelect} className="shrink-0 accent-violet-600"
                                    onChange={(ev) => setSelectedDivs((prev) => {
                                      const next = new Set(prev)
                                      if (ev.target.checked) next.add(d.transactionID); else next.delete(d.transactionID)
                                      return next
                                    })}
                                  />
                                  <TrendingUp className="h-3.5 w-3.5 shrink-0 text-green-500" />
                                  <div className="flex-1 min-w-0 flex items-center gap-1.5">
                                    <span className="text-xs font-semibold">{d.symbol}</span>
                                    <span className="text-[11px] text-muted-foreground truncate">{d.description}</span>
                                  </div>
                                  <span className="text-[11px] tabular-nums font-semibold text-green-500 shrink-0">
                                    +S${d.amount.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </span>
                                  {d.alreadyImported && <span className="text-[10px] text-muted-foreground italic shrink-0">imported</span>}
                                </label>
                              )
                            })}
                          </div>
                        )}
                      </div>

                      {/* Cash — deposits, withdrawals, fees, tax, interest, conversions */}
                      <div>
                        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Cash &amp; adjustments ({ledger.length})</h3>
                        {ledger.length === 0 ? (
                          <p className="text-xs text-muted-foreground py-1">No deposits, withdrawals, fees, tax, interest or conversions in this period.</p>
                        ) : (
                          <div className="space-y-1.5">
                            {ledger.map((entry) => (
                              <div key={entry.externalId} className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2">
                                <span className="rounded-full border border-border px-2 py-0.5 text-[9px] font-bold text-muted-foreground shrink-0">{entry.category.replaceAll("_", " ")}</span>
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-[11px] font-medium">{entry.description || entry.rawType}</p>
                                  <p className="text-[10px] text-muted-foreground">{entry.symbol || entry.currency} · {formatFlexDate(entry.date)}</p>
                                </div>
                                <span className={`text-[11px] font-semibold tabular-nums shrink-0 ${entry.amount >= 0 ? "text-green-500" : "text-red-500"}`}>
                                  {entry.amount >= 0 ? "+" : ""}{entry.amount.toLocaleString("en-SG", { maximumFractionDigits: 2 })} {entry.currency}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Governance gate — required acknowledgment for SELL trades */}
                      {hasSells && (
                        <label className="flex items-start gap-3 rounded-lg border border-amber-400/40 bg-amber-400/5 px-4 py-3 cursor-pointer">
                          <input type="checkbox" checked={behaviourAcknowledged} onChange={(e) => setBehaviourAcknowledged(e.target.checked)} className="mt-0.5 shrink-0 accent-amber-500" />
                          <div className="flex items-start gap-1.5">
                            <ShieldAlert className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                            <p className="text-[11px] text-amber-700 dark:text-amber-400">
                              <span className="font-semibold">Governance gate:</span> I confirm this sale was reviewed against the investment policy, justified by the Behaviour Log, and does not constitute panic selling or speculation.
                            </p>
                          </div>
                        </label>
                      )}
                    </div>
                  )}

                  {activityError && activityState === "loaded" && (
                    <div className="mt-3 rounded-lg border border-red-300/40 bg-red-400/5 px-3 py-2 text-[11px] text-red-600 dark:text-red-400">
                      {activityError}
                    </div>
                  )}

                  {saveError && (
                    <div className="mt-3 rounded-lg border border-red-300/40 bg-red-400/5 px-3 py-2 text-[11px] text-red-600 dark:text-red-400">
                      {saveError}
                    </div>
                  )}

                  {saveSummary && (
                    <div className="mt-3 rounded-lg border border-green-300/40 bg-green-400/5 px-3 py-2.5 text-[11px] text-green-700 dark:text-green-400">
                      Saved {saveSummary.positions} position{saveSummary.positions !== 1 ? "s" : ""}
                      {(saveSummary.trades > 0 || saveSummary.dividends > 0 || saveSummary.ledger > 0) &&
                        ` · ${saveSummary.trades} trade${saveSummary.trades !== 1 ? "s" : ""}, ${saveSummary.dividends} dividend${saveSummary.dividends !== 1 ? "s" : ""}, ${saveSummary.ledger} cash entr${saveSummary.ledger === 1 ? "y" : "ies"}`}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Manual input */}
          {mode === "manual" && (
            <div className="space-y-3">
              <div className="grid grid-cols-[minmax(0,1fr)_70px_70px] gap-2 px-1 text-[10px] font-medium text-muted-foreground sm:grid-cols-[1fr_90px_90px] sm:text-[11px]">
                <span>Holding</span>
                <span className="text-right">Units</span>
                <span className="text-right">Price (fund currency)</span>
              </div>
              {holdings.map((h) => (
                <div key={h.id} className="grid grid-cols-[minmax(0,1fr)_70px_70px] items-center gap-2 sm:grid-cols-[1fr_90px_90px]">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold">{h.ticker}</span>
                    <span className="text-[11px] text-muted-foreground truncate hidden sm:block">{h.name}</span>
                  </div>
                  <input
                    type="number"
                    step="0.001"
                    value={manualValues[h.id]?.units ?? ""}
                    onChange={(e) => handleManualChange(h.id, "units", e.target.value)}
                    className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-right outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all"
                  />
                  <input
                    type="number"
                    step="0.01"
                    value={manualValues[h.id]?.price ?? ""}
                    onChange={(e) => handleManualChange(h.id, "price", e.target.value)}
                    className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-right outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all"
                  />
                </div>
              ))}
            </div>
          )}

          {/* Screenshot upload */}
          {mode === "screenshot" && (
            <div>
              {screenshotState === "idle" && (
                <div>
                  <input ref={fileInputRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={handleFileChange} />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-border hover:border-violet-400 dark:hover:border-violet-500 py-10 transition-colors group"
                  >
                    <div className="h-12 w-12 rounded-xl bg-muted flex items-center justify-center group-hover:bg-violet-50 dark:group-hover:bg-violet-500/10 transition-colors">
                      <Upload className="h-6 w-6 text-muted-foreground group-hover:text-violet-500 transition-colors" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-medium">Click to upload screenshot</p>
                      <p className="text-xs text-muted-foreground mt-1">PNG, JPG, WEBP or PDF statement (max 4 MB) · Claude AI extracts the data</p>
                    </div>
                  </button>
                </div>
              )}

              {screenshotState === "processing" && (
                <div className="flex flex-col items-center gap-3 py-10">
                  <Loader2 className="h-8 w-8 text-violet-500 animate-spin" />
                  <p className="text-sm font-medium">Analysing screenshot…</p>
                  <p className="text-xs text-muted-foreground">Claude AI is extracting your holdings data</p>
                </div>
              )}

              {screenshotState === "error" && (
                <div className="rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 p-4">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-semibold text-red-600 dark:text-red-400">Extraction failed</p>
                      <p className="text-xs text-red-500 mt-0.5">{extractError}</p>
                    </div>
                  </div>
                  <button onClick={() => setScreenshotState("idle")} className="mt-3 text-xs text-red-600 dark:text-red-400 underline">
                    Try again
                  </button>
                </div>
              )}

              {screenshotState === "preview" && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-3">Extracted holdings — review before confirming. New tickers will be added automatically.</p>
                  <div className="space-y-2 mb-4">
                    {extractedRows.map((row) => {
                      const matched = holdings.find((h) => h.ticker === row.ticker)
                      const offScope = !isInScope(row.ticker)
                      return (
                        <div key={row.ticker} className={`flex items-center justify-between rounded-lg px-3 py-2 border ${matched ? "bg-green-50 dark:bg-green-500/10 border-green-200 dark:border-green-500/20" : "bg-violet-50 dark:bg-violet-500/[0.08] border-violet-200 dark:border-violet-500/20"}`}>
                          <div className="flex items-center gap-2">
                            {matched ? <Check className="h-3.5 w-3.5 text-green-500" /> : <ArrowUpCircle className="h-3.5 w-3.5 text-violet-500" />}
                            <span className="text-xs font-bold">{row.ticker}</span>
                            {!matched && <span className="text-[10px] text-violet-500">new — will be added</span>}
                            {offScope && <span className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold">not in plan</span>}
                          </div>
                          <div className="text-right">
                            <span className="text-xs font-semibold">S${row.value.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            <span className="text-[11px] text-muted-foreground ml-2">{row.units} × {row.price} (fund ccy)</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {screenshotState === "flagged" && (
                <div>
                  <div className="rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-300 dark:border-amber-500/30 p-4 mb-3">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">These rows look wrong — nothing was written</p>
                        <p className="text-xs text-amber-700/80 dark:text-amber-400/80 mt-0.5">
                          Unknown tickers or very large jumps usually mean the screenshot was misread. Only confirm if the numbers match your brokerage exactly.
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2 mb-1">
                    {flaggedRows.map((row) => (
                      <div key={row.ticker} className="rounded-lg border border-amber-200 dark:border-amber-500/20 bg-amber-50/60 dark:bg-amber-500/[0.06] px-3 py-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold">{row.ticker}</span>
                          <span className="text-[11px] text-muted-foreground tabular-nums">{row.units} × {row.price} (fund ccy)</span>
                        </div>
                        <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-0.5">{row.reason}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <button
            onClick={() => {
              if (mode !== "choose") { setMode("choose"); setIbkrState("idle") }
              else onClose()
            }}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {mode !== "choose" ? "← Back" : "Cancel"}
          </button>

          <div className="flex items-center gap-2">
            {saved && (
              <div className="flex items-center gap-1.5 text-green-500 text-xs font-medium">
                <Check className="h-3.5 w-3.5" />
                Saved
              </div>
            )}

            {mode === "ibkr" && ibkrState === "preview" && ibkrPositions.length > 0 && !saveSummary && (
              <button
                onClick={handleConfirmIBKR}
                disabled={isPending || saved || !canConfirmIBKR}
                className="flex items-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-xs font-semibold px-4 py-2 transition-colors"
              >
                {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Save Closing Refresh
                {(() => {
                  const activityCount = selectedTrades.size + selectedDivs.size + ledger.length
                  return activityCount > 0
                    ? ` (${ibkrPositions.length} + ${activityCount})`
                    : ` (${ibkrPositions.length})`
                })()}
              </button>
            )}

            {mode === "manual" && (
              <button
                onClick={handleSaveManual}
                disabled={isPending || saved}
                className="flex items-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-xs font-semibold px-4 py-2 transition-colors"
              >
                {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Save Values
              </button>
            )}

            {mode === "screenshot" && screenshotState === "flagged" && (
              <button
                onClick={handleConfirmFlagged}
                disabled={isPending || saved || flaggedRows.length === 0}
                className="flex items-center gap-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white text-xs font-semibold px-4 py-2 transition-colors"
              >
                {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <AlertCircle className="h-3.5 w-3.5" />}
                Import flagged row{flaggedRows.length !== 1 ? "s" : ""} anyway
              </button>
            )}

            {mode === "screenshot" && screenshotState === "preview" && (
              <button
                onClick={handleConfirmScreenshot}
                disabled={isPending || saved || extractedRows.filter((r) => r.units > 0 && r.price > 0).length === 0}
                className="flex items-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-xs font-semibold px-4 py-2 transition-colors"
              >
                {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Confirm & Save
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
