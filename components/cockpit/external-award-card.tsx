"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Briefcase, PencilLine, AlertTriangle, CheckCircle2 } from "lucide-react"
import { formatCurrency } from "@/lib/utils"
import { setExternalAwardAction } from "@/app/actions/external-award"

// Outside-Atlas employer RSU pipeline. Display-only with respect to the
// portfolio: nothing here enters NAV, targets, health or look-through. The
// page computes values server-side and passes plain rows down.

export interface AwardCardVestRow {
  dateLabel: string // "15 Feb 2027"
  units: number
  grossUsd: number
  afterTaxUsd: number
  grossSgd: number
}

export interface AwardCardData {
  label: string
  ticker: string
  priceUsd: number
  priceIsLive: boolean
  taxRatePct: number
  vests: AwardCardVestRow[]
  nextVestDays: number | null
  tranchesRaw: Array<{ date: string; units: number }>
}

const inputCls =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/40"
const labelCls = "block text-[11px] font-semibold text-muted-foreground mb-1"

function Editor({ data, onDone }: { data: AwardCardData | null; onDone: () => void }) {
  const router = useRouter()
  const [ticker, setTicker] = useState(data?.ticker ?? "BK")
  const [taxRate, setTaxRate] = useState(String(data?.taxRatePct ?? 30))
  const [price, setPrice] = useState("")
  const [tranches, setTranches] = useState<Array<{ date: string; units: string }>>(
    data?.tranchesRaw.map((t) => ({ date: t.date, units: String(t.units) })) ?? [{ date: "", units: "" }],
  )
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, startTransition] = useTransition()

  function save() {
    setMessage(null)
    startTransition(async () => {
      const result = await setExternalAwardAction({
        ticker,
        taxRatePct: Number(taxRate),
        ...(price.trim() ? { priceUsd: Number(price) } : {}),
        tranches: tranches
          .filter((t) => t.date && t.units)
          .map((t) => ({ date: t.date, units: Number(t.units) })),
      })
      if (result.success) {
        onDone()
        router.refresh()
      } else {
        setMessage({ ok: false, text: result.error })
      }
    })
  }

  function clearAward() {
    setMessage(null)
    startTransition(async () => {
      const result = await setExternalAwardAction({ cleared: true })
      if (result.success) {
        setMessage({ ok: true, text: "Pipeline cleared." })
        onDone()
        router.refresh()
      } else {
        setMessage({ ok: false, text: result.error })
      }
    })
  }

  return (
    <div className="space-y-4 p-5 border-t border-border">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div>
          <label className={labelCls} htmlFor="award-ticker">Ticker</label>
          <input id="award-ticker" value={ticker} onChange={(e) => setTicker(e.target.value)} className={inputCls} placeholder="BK" />
        </div>
        <div>
          <label className={labelCls} htmlFor="award-tax">Assumed tax at vest (%)</label>
          <input id="award-tax" type="number" min={0} max={60} value={taxRate} onChange={(e) => setTaxRate(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls} htmlFor="award-price">Fallback price (US$, optional)</label>
          <input id="award-price" type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} className={inputCls} placeholder="live quote used when available" />
        </div>
      </div>

      <div className="space-y-2">
        <p className={labelCls}>Vesting tranches</p>
        {tranches.map((t, i) => (
          <div key={i} className="flex gap-2">
            <input
              aria-label={`Tranche ${i + 1} date`}
              type="date"
              value={t.date}
              onChange={(e) => setTranches(tranches.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))}
              className={inputCls}
            />
            <input
              aria-label={`Tranche ${i + 1} units`}
              type="number"
              placeholder="units"
              value={t.units}
              onChange={(e) => setTranches(tranches.map((x, j) => (j === i ? { ...x, units: e.target.value } : x)))}
              className={inputCls}
            />
            <button
              onClick={() => setTranches(tranches.filter((_, j) => j !== i))}
              className="shrink-0 rounded-lg border border-border px-3 text-xs font-semibold text-muted-foreground hover:bg-accent transition-colors"
              aria-label={`Remove tranche ${i + 1}`}
            >
              Remove
            </button>
          </div>
        ))}
        {tranches.length < 12 && (
          <button
            onClick={() => setTranches([...tranches, { date: "", units: "" }])}
            className="text-xs font-semibold text-primary hover:underline"
          >
            + Add tranche
          </button>
        )}
      </div>

      {message && (
        <div className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs font-medium ${message.ok ? "border-success/40 bg-success/10 text-success" : "border-danger/40 bg-danger/10 text-danger"}`}>
          {message.ok ? <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" /> : <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />}
          <span>{message.text}</span>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={pending} className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50 hover:opacity-90 transition-opacity">
          {pending ? "Saving…" : "Save pipeline"}
        </button>
        {data && (
          <button onClick={clearAward} disabled={pending} className="rounded-lg border border-border px-4 py-2.5 text-sm font-semibold text-muted-foreground hover:bg-accent transition-colors">
            Clear
          </button>
        )}
      </div>
    </div>
  )
}

export function ExternalAwardCard({ data, editable }: { data: AwardCardData | null; editable: boolean }) {
  const [editing, setEditing] = useState(false)

  // A cross-portfolio viewer with no pipeline to look at gets nothing, not an empty setup card.
  if (!data && !editable) return null

  return (
    <div className="rounded-xl border border-border bg-card card-elevated overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Briefcase className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Outside Atlas — {data ? data.label : "employer awards"}
          </h2>
        </div>
        {editable && (
          <button onClick={() => setEditing(!editing)} className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors">
            <PencilLine className="h-3.5 w-3.5" />
            {editing ? "Close" : data ? "Edit" : "Set up"}
          </button>
        )}
      </div>

      {data ? (
        <div className="p-5 space-y-4">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <p className="text-2xl font-black tabular-nums">
              {formatCurrency(data.vests.reduce((s, v) => s + v.grossUsd, 0), "USD")}
            </p>
            <p className="text-xs text-muted-foreground">
              unvested at {formatCurrency(data.priceUsd, "USD")}/{data.ticker}
              {data.priceIsLive ? "" : " (manual price — no live quote)"}
              {data.nextVestDays !== null && ` · next vest in ${data.nextVestDays} days`}
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Vest date</th>
                  <th className="px-3 py-2 text-right font-semibold text-muted-foreground">Units</th>
                  <th className="px-3 py-2 text-right font-semibold text-muted-foreground">Gross</th>
                  <th className="px-3 py-2 text-right font-semibold text-muted-foreground">After tax ({data.taxRatePct}%)</th>
                  <th className="px-3 py-2 text-right font-semibold text-muted-foreground">≈ SGD gross</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.vests.map((v) => (
                  <tr key={v.dateLabel}>
                    <td className="px-3 py-2 font-semibold whitespace-nowrap">{v.dateLabel}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{v.units}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(v.grossUsd, "USD")}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">{formatCurrency(v.afterTaxUsd, "USD")}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{formatCurrency(v.grossSgd, "SGD")}</td>
                  </tr>
                ))}
                {data.vests.length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-3 text-muted-foreground">All tranches have vested — clear the pipeline or add the next grant.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <p className="text-[11px] text-muted-foreground">
            Not part of NAV, targets or concentration maths — unvested awards are contingent compensation, and employer
            stock doubles employer risk. SOP on each vest: sell, convert, contribute — the proceeds enter the ledger as a
            contribution, and the forecast already counts these after-tax inflows as planned contributions.
          </p>
        </div>
      ) : (
        !editing && (
          <div className="p-5">
            <p className="text-xs text-muted-foreground">
              Track employer RSUs or similar awards held outside Atlas — shown as a vesting pipeline (never in NAV), with
              after-tax vest proceeds counted as planned future contributions in the forecast.
            </p>
          </div>
        )
      )}

      {editing && editable && <Editor data={data} onDone={() => setEditing(false)} />}
    </div>
  )
}
