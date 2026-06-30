"use client"

import { useRef, useState, useTransition } from "react"
import { Download, PieChart, Camera, ArrowLeftRight, PiggyBank, Coins, Archive, Upload, AlertTriangle } from "lucide-react"
import { restoreBackup } from "@/lib/backup-actions"

const EXPORTS = [
  {
    type: "portfolio",
    label: "Current Portfolio",
    description: "Latest snapshot per holding — ticker, units, price, value, target allocation.",
    icon: PieChart,
    color: "text-indigo-400",
  },
  {
    type: "snapshots",
    label: "All Snapshots",
    description: "Full snapshot history for every holding, ordered by date. Use this for charting or external analysis.",
    icon: Camera,
    color: "text-violet-400",
  },
  {
    type: "trades",
    label: "Trade Log",
    description: "All buy/sell transactions — ticker, type, units, price, FX rate, and total amount.",
    icon: ArrowLeftRight,
    color: "text-blue-400",
  },
  {
    type: "contributions",
    label: "Contributions",
    description: "Monthly contribution records — date and amount in USD.",
    icon: PiggyBank,
    color: "text-green-400",
  },
  {
    type: "dividends",
    label: "Dividends",
    description: "Dividend payment records — ticker, date, amount in SGD, and per-unit yield.",
    icon: Coins,
    color: "text-yellow-400",
  },
]

export function ExportButtons({ isAdmin = false }: { isAdmin?: boolean }) {
  function download(type: string) {
    window.location.href = `/api/export?type=${type}`
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="text-xs text-muted-foreground leading-relaxed">
          CSV exports are compatible with Excel, Google Sheets, and any analysis tool. The
          <span className="font-semibold text-foreground"> full backup</span> is a single JSON file
          with everything — keep it somewhere safe for your 2045 horizon. Files are generated on demand.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {EXPORTS.map(({ type, label, description, icon: Icon, color }) => (
          <div key={type} className="rounded-xl border border-border bg-card p-5 flex flex-col gap-3 hover:bg-accent/20 transition-colors">
            <div className="flex items-start gap-3">
              <Icon className={`h-5 w-5 shrink-0 mt-0.5 ${color}`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">{label}</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{description}</p>
              </div>
            </div>
            <button
              onClick={() => download(type)}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-border bg-background hover:bg-accent/60 text-xs font-semibold px-4 py-2 transition-colors mt-auto"
            >
              <Download className="h-3.5 w-3.5" />
              Download CSV
            </button>
          </div>
        ))}
      </div>

      {/* Full backup (JSON) */}
      <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/[0.04] p-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Archive className="h-5 w-5 shrink-0 mt-0.5 text-indigo-400" />
          <div>
            <p className="text-sm font-semibold">Full Backup (JSON)</p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">Everything in one file — holdings, all snapshots, trades, contributions, dividends, behaviour log, watchlist, and the rule register.</p>
          </div>
        </div>
        <button
          onClick={() => download("backup")}
          className="shrink-0 flex items-center justify-center gap-1.5 rounded-lg border border-indigo-500/40 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-300 text-xs font-semibold px-4 py-2 transition-colors"
        >
          <Download className="h-3.5 w-3.5" /> Download backup
        </button>
      </div>

      {isAdmin && <RestorePanel />}
    </div>
  )
}

// Admin-only restore — destructive: replaces this account's data with a backup file.
function RestorePanel() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [pending, startTransition] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  function onPick(file: File) {
    setMsg(null)
    if (!confirm("Restore will REPLACE all current data for this account with the backup file. This cannot be undone. Continue?")) {
      if (fileRef.current) fileRef.current.value = ""
      return
    }
    startTransition(async () => {
      const text = await file.text()
      const r = await restoreBackup(text)
      if ("success" in r) setMsg({ ok: true, text: `Restored ${r.holdings} holdings, ${r.snapshots} snapshots, ${r.trades} trades.` })
      else setMsg({ ok: false, text: r.error ?? "Restore failed." })
      if (fileRef.current) fileRef.current.value = ""
    })
  }

  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/[0.04] p-5">
      <div className="flex items-start gap-3 mb-3">
        <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5 text-red-500" />
        <div>
          <p className="text-sm font-semibold">Restore from backup <span className="text-[10px] font-bold uppercase tracking-wide text-red-500 ml-1">admin · destructive</span></p>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">Replaces this account&apos;s holdings, snapshots, trades, contributions, dividends, behaviour log, and watchlist with the uploaded backup. Export a fresh backup first.</p>
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        disabled={pending}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f) }}
        className="hidden"
      />
      <button
        onClick={() => fileRef.current?.click()}
        disabled={pending}
        className="flex items-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-300 text-xs font-semibold px-4 py-2 transition-colors disabled:opacity-50"
      >
        <Upload className="h-3.5 w-3.5" /> {pending ? "Restoring…" : "Choose backup file to restore"}
      </button>
      {msg && (
        <p className={`mt-3 text-xs font-medium ${msg.ok ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>{msg.text}</p>
      )}
    </div>
  )
}
