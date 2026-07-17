"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { PlusCircle, CheckCircle2, AlertTriangle } from "lucide-react"
import { addManualContribution, addManualDividend } from "@/app/contributions/actions"
import { useToast } from "@/components/ui/toast"

// Owner-only manual ledger entry — the fallback when no IBKR activity feed is
// connected (or its report window has a gap). Two entry kinds:
//   • Contribution / withdrawal (SGD; withdrawals negative)
//   • Dividend received (SGD, tied to an existing holding)

const inputCls =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/40"
const labelCls = "block text-[11px] font-semibold text-muted-foreground mb-1"

export function ManualEntryPanel({ tickers }: { tickers: string[] }) {
  const router = useRouter()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<"contribution" | "dividend">("contribution")
  const [amount, setAmount] = useState("")
  const [date, setDate] = useState("")
  const [ticker, setTicker] = useState(tickers[0] ?? "")
  const [note, setNote] = useState("")
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    setMessage(null)
    const parsed = Number(amount)
    startTransition(async () => {
      const result =
        kind === "contribution"
          ? await addManualContribution({ amount: parsed, date, note })
          : await addManualDividend({ ticker, amount: parsed, paymentDate: date, note })
      if (result.success) {
        const text = kind === "contribution" ? "Recorded. The ledger and monthly totals update immediately." : `Dividend recorded against ${ticker}.`
        setMessage({ ok: true, text })
        toast(text, { type: "success" })
        setAmount("")
        setNote("")
        router.refresh()
      } else {
        setMessage({ ok: false, text: result.error })
        toast(result.error, { type: "error" })
      }
    })
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-semibold hover:bg-accent transition-colors"
      >
        <PlusCircle className="h-4 w-4" />
        Record a contribution or dividend manually
      </button>
    )
  }

  return (
    <div className="rounded-xl border border-border bg-card card-elevated overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Manual entry</h2>
        <button onClick={() => { setOpen(false); setMessage(null) }} className="text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors">
          Close
        </button>
      </div>

      <div className="p-5 space-y-4">
        {/* Kind toggle */}
        <div className="inline-flex rounded-lg border border-border overflow-hidden text-xs font-semibold">
          {(["contribution", "dividend"] as const).map((k) => (
            <button
              key={k}
              onClick={() => { setKind(k); setMessage(null) }}
              className={`px-4 py-2 transition-colors ${kind === k ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-accent"}`}
            >
              {k === "contribution" ? "Contribution / withdrawal" : "Dividend received"}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {kind === "dividend" && (
            <div>
              <label className={labelCls} htmlFor="manual-ticker">Holding</label>
              <select id="manual-ticker" value={ticker} onChange={(e) => setTicker(e.target.value)} className={inputCls}>
                {tickers.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className={labelCls} htmlFor="manual-amount">
              {kind === "contribution" ? "Amount (SGD — withdrawals negative)" : "Amount received (SGD)"}
            </label>
            <input
              id="manual-amount"
              type="number"
              inputMode="decimal"
              step="0.01"
              placeholder={kind === "contribution" ? "e.g. 4000 or -1500" : "e.g. 125.40"}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="manual-date">{kind === "contribution" ? "Date" : "Payment date"}</label>
            <input id="manual-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          </div>
          <div className={kind === "dividend" ? "sm:col-span-3" : "sm:col-span-1"}>
            <label className={labelCls} htmlFor="manual-note">Note (optional)</label>
            <input
              id="manual-note"
              type="text"
              maxLength={140}
              placeholder={kind === "contribution" ? "e.g. July transfer from DBS" : "e.g. VWRA semi-annual distribution"}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>

        {message && (
          <div className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs font-medium ${message.ok ? "border-success/40 bg-success/10 text-success" : "border-danger/40 bg-danger/10 text-danger"}`}>
            {message.ok ? <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" /> : <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />}
            <span>{message.text}</span>
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={submit}
            disabled={pending || !amount || !date || (kind === "dividend" && !ticker)}
            className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50 hover:opacity-90 transition-opacity"
          >
            {pending ? "Recording…" : kind === "contribution" ? "Record contribution" : "Record dividend"}
          </button>
          <p className="text-[11px] text-muted-foreground">
            Entries are tagged as manual and append-only — fix a mistake with an offsetting entry.
          </p>
        </div>
      </div>
    </div>
  )
}
