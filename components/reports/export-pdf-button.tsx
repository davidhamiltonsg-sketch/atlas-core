"use client"

import { FileDown, Loader2 } from "lucide-react"
import { useState } from "react"

export function ExportPdfButton() {
  const [loading, setLoading] = useState(false)

  function handleExport() {
    setLoading(true)
    // Give React one frame to update the button state, then print
    setTimeout(() => {
      window.print()
      setLoading(false)
    }, 120)
  }

  return (
    <button
      onClick={handleExport}
      disabled={loading}
      className="no-print inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3.5 py-2 text-xs font-semibold text-foreground shadow-sm hover:bg-accent/60 hover:border-violet-500/30 transition-all disabled:opacity-60"
    >
      {loading
        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
        : <FileDown className="h-3.5 w-3.5" />
      }
      {loading ? "Preparing…" : "Export PDF"}
    </button>
  )
}
