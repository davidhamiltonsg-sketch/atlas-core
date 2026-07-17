"use client"

import { useEffect, useState, useRef, useTransition } from "react"
import { X, Upload, Pencil, Check, AlertCircle, Loader2, Camera, RefreshCw, ArrowUpCircle } from "lucide-react"
import { updateHoldingsManually, extractFromScreenshot, applyExtractedHoldings, type NeedsConfirmationRow } from "@/app/portfolio/actions"
import { isInScope } from "@/lib/approved-alternatives"

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

  // IBKR state
  const [ibkrState, setIbkrState] = useState<"idle" | "fetching" | "preview" | "error">("idle")
  const [ibkrPositions, setIbkrPositions] = useState<IBKRPosition[]>([])
  const [ibkrError, setIbkrError] = useState<string | null>(null)
  const [ibkrMeta, setIbkrMeta] = useState<{ accountId: string; reportDate: string } | null>(null)

  const [isPending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)

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

  // ── IBKR FLEX ─────────────────────────────────────────────────────────────

  async function handleIBKRSync() {
    setIbkrState("fetching")
    setIbkrError(null)
    try {
      const res = await fetch("/api/sync-ibkr", { method: "POST" })
      const data = await res.json()
      if (!res.ok) {
        setIbkrError(data.error ?? "Failed to fetch from IBKR")
        setIbkrState("error")
        return
      }
      setIbkrPositions(data.positions)
      setIbkrMeta({ accountId: data.accountId, reportDate: data.reportDate })
      setIbkrState("preview")
    } catch {
      setIbkrError("Network error — check your connection")
      setIbkrState("error")
    }
  }

  function handleConfirmIBKR() {
    // Send ALL positions — matched ones update in place, new tickers (e.g. IBIT) are created.
    startTransition(async () => {
      const res = await fetch("/api/sync-ibkr", {
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
      if (res.ok) {
        setSaved(true)
        setTimeout(() => { setSaved(false); onClose() }, 1200)
      }
    })
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="update-portfolio-title" className="relative z-10 flex max-h-[calc(100dvh-16px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <h2 id="update-portfolio-title" className="text-sm font-semibold">Update Portfolio Values</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Sync from IBKR or enter manually</p>
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
                  <p className="text-sm font-semibold">Sync IBKR</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Live positions via Flex API</p>
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

            {mode === "ibkr" && ibkrState === "preview" && ibkrPositions.length > 0 && (
              <button
                onClick={handleConfirmIBKR}
                disabled={isPending || saved}
                className="flex items-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-xs font-semibold px-4 py-2 transition-colors"
              >
                {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Save {ibkrPositions.length} position{ibkrPositions.length !== 1 ? "s" : ""}
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
    </div>
  )
}
