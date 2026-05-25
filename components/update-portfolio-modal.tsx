"use client"

import { useState, useRef, useTransition } from "react"
import { X, Upload, Pencil, Check, AlertCircle, Loader2, Camera } from "lucide-react"
import { updateHoldingsManually, extractFromScreenshot } from "@/app/portfolio/actions"

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

interface UpdatePortfolioModalProps {
  holdings: Holding[]
  onClose: () => void
  defaultMode?: "choose" | "manual" | "screenshot"
}

export function UpdatePortfolioModal({ holdings, onClose, defaultMode = "choose" }: UpdatePortfolioModalProps) {
  const [mode, setMode] = useState<"choose" | "manual" | "screenshot">(defaultMode)
  const [manualValues, setManualValues] = useState<Record<string, { units: string; price: string }>>(
    Object.fromEntries(holdings.map((h) => [h.id, { units: String(h.latestUnits), price: String(h.latestPrice) }]))
  )
  const [screenshotState, setScreenshotState] = useState<"idle" | "processing" | "preview" | "error">("idle")
  const [extractedRows, setExtractedRows] = useState<ExtractedRow[]>([])
  const [extractError, setExtractError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleManualChange(holdingId: string, field: "units" | "price", value: string) {
    setManualValues((prev) => ({ ...prev, [holdingId]: { ...prev[holdingId], [field]: value } }))
  }

  function handleSaveManual() {
    const updates = holdings.map((h) => {
      const v = manualValues[h.id]
      return {
        holdingId: h.id,
        units: parseFloat(v.units) || 0,
        price: parseFloat(v.price) || 0,
      }
    }).filter((u) => u.units > 0 && u.price > 0)

    startTransition(async () => {
      await updateHoldingsManually(updates)
      setSaved(true)
      setTimeout(() => { setSaved(false); onClose() }, 1200)
    })
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setScreenshotState("processing")
    setExtractError(null)

    const reader = new FileReader()
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result as string
      const base64 = dataUrl.split(",")[1]
      const mimeType = file.type

      try {
        const rows = await extractFromScreenshot(base64, mimeType)
        setExtractedRows(rows)
        setScreenshotState("preview")
      } catch (err) {
        setExtractError(err instanceof Error ? err.message : "Failed to extract data from screenshot")
        setScreenshotState("error")
      }
    }
    reader.readAsDataURL(file)
  }

  function handleConfirmScreenshot() {
    const updates: Array<{ holdingId: string; units: number; price: number }> = []

    for (const row of extractedRows) {
      const holding = holdings.find((h) => h.ticker === row.ticker)
      if (holding) {
        updates.push({ holdingId: holding.id, units: row.units, price: row.price })
      }
    }

    startTransition(async () => {
      await updateHoldingsManually(updates)
      setSaved(true)
      setTimeout(() => { setSaved(false); onClose() }, 1200)
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-lg rounded-2xl border border-border bg-card shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <h2 className="text-sm font-semibold">Update Portfolio Values</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Enter current prices or upload a brokerage screenshot</p>
          </div>
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5">
          {/* Mode choose */}
          {mode === "choose" && (
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setMode("manual")}
                className="flex flex-col items-center gap-3 rounded-xl border border-border p-5 hover:bg-accent/50 transition-colors text-left group"
              >
                <div className="h-10 w-10 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 flex items-center justify-center group-hover:bg-indigo-100 dark:group-hover:bg-indigo-500/20 transition-colors">
                  <Pencil className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold">Manual Input</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Enter units and price per holding</p>
                </div>
              </button>

              <button
                onClick={() => setMode("screenshot")}
                className="flex flex-col items-center gap-3 rounded-xl border border-border p-5 hover:bg-accent/50 transition-colors text-left group"
              >
                <div className="h-10 w-10 rounded-xl bg-violet-50 dark:bg-violet-500/10 flex items-center justify-center group-hover:bg-violet-100 dark:group-hover:bg-violet-500/20 transition-colors">
                  <Camera className="h-5 w-5 text-violet-600 dark:text-violet-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold">Screenshot Upload</p>
                  <p className="text-xs text-muted-foreground mt-0.5">AI extracts data from IBKR screenshot</p>
                </div>
              </button>
            </div>
          )}

          {/* Manual input */}
          {mode === "manual" && (
            <div className="space-y-3">
              <div className="grid grid-cols-[1fr_90px_90px] gap-2 text-[11px] font-medium text-muted-foreground px-1">
                <span>Holding</span>
                <span className="text-right">Units</span>
                <span className="text-right">Price (USD)</span>
              </div>
              {holdings.map((h) => (
                <div key={h.id} className="grid grid-cols-[1fr_90px_90px] gap-2 items-center">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold">{h.ticker}</span>
                    <span className="text-[11px] text-muted-foreground truncate hidden sm:block">{h.name}</span>
                  </div>
                  <input
                    type="number"
                    step="0.001"
                    value={manualValues[h.id]?.units ?? ""}
                    onChange={(e) => handleManualChange(h.id, "units", e.target.value)}
                    className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-right outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all"
                  />
                  <input
                    type="number"
                    step="0.01"
                    value={manualValues[h.id]?.price ?? ""}
                    onChange={(e) => handleManualChange(h.id, "price", e.target.value)}
                    className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-right outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all"
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
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-border hover:border-indigo-400 dark:hover:border-indigo-500 py-10 transition-colors group"
                  >
                    <div className="h-12 w-12 rounded-xl bg-muted flex items-center justify-center group-hover:bg-indigo-50 dark:group-hover:bg-indigo-500/10 transition-colors">
                      <Upload className="h-6 w-6 text-muted-foreground group-hover:text-indigo-500 transition-colors" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-medium">Click to upload screenshot</p>
                      <p className="text-xs text-muted-foreground mt-1">PNG, JPG, WEBP accepted · Claude AI extracts the data</p>
                    </div>
                  </button>
                </div>
              )}

              {screenshotState === "processing" && (
                <div className="flex flex-col items-center gap-3 py-10">
                  <Loader2 className="h-8 w-8 text-indigo-500 animate-spin" />
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
                  <button
                    onClick={() => setScreenshotState("idle")}
                    className="mt-3 text-xs text-red-600 dark:text-red-400 underline"
                  >
                    Try again
                  </button>
                </div>
              )}

              {screenshotState === "preview" && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-3">Extracted holdings — review before confirming</p>
                  <div className="space-y-2 mb-4">
                    {extractedRows.map((row) => {
                      const matched = holdings.find((h) => h.ticker === row.ticker)
                      return (
                        <div key={row.ticker} className={`flex items-center justify-between rounded-lg px-3 py-2 ${matched ? "bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20" : "bg-muted/50 border border-border opacity-60"}`}>
                          <div className="flex items-center gap-2">
                            {matched
                              ? <Check className="h-3.5 w-3.5 text-green-500" />
                              : <AlertCircle className="h-3.5 w-3.5 text-muted-foreground" />
                            }
                            <span className="text-xs font-bold">{row.ticker}</span>
                            {!matched && <span className="text-[10px] text-muted-foreground">not in portfolio</span>}
                          </div>
                          <div className="text-right">
                            <span className="text-xs font-semibold">${row.value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            <span className="text-[11px] text-muted-foreground ml-2">{row.units} × ${row.price}</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  {extractedRows.filter((r) => holdings.find((h) => h.ticker === r.ticker)).length === 0 && (
                    <p className="text-xs text-muted-foreground text-center mb-4">No matching tickers found. Try manual input instead.</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 p-5 border-t border-border">
          <button
            onClick={() => {
              if (mode !== "choose") setMode("choose")
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

            {mode === "manual" && (
              <button
                onClick={handleSaveManual}
                disabled={isPending || saved}
                className="flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-xs font-semibold px-4 py-2 transition-colors"
              >
                {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Save Values
              </button>
            )}

            {mode === "screenshot" && screenshotState === "preview" && (
              <button
                onClick={handleConfirmScreenshot}
                disabled={isPending || saved || extractedRows.filter((r) => holdings.find((h) => h.ticker === r.ticker)).length === 0}
                className="flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-xs font-semibold px-4 py-2 transition-colors"
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
