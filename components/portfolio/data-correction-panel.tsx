"use client"

import { useState, useTransition } from "react"
import { Wrench, Check, AlertCircle, Loader2, Eraser } from "lucide-react"
import { correctPositions } from "@/app/portfolio/actions"

export interface CorrectionRow {
  holdingId: string
  ticker: string
  name: string
  units: number
  valueSgd: number
}

interface DataCorrectionPanelProps {
  rows: CorrectionRow[]
  plainEnglish?: boolean // SBR wording
}

const fmtS = (v: number) => `S$${Math.round(v).toLocaleString("en-SG")}`
const fmtU = (v: number) => v.toLocaleString("en-SG", { maximumFractionDigits: 4 })

/** Owner-only recovery tool for erroneous data (e.g. phantom positions minted by a misread
 *  screenshot import). The owner enters the TRUE units/value per holding from the broker
 *  statement; applying writes corrective snapshots and a governance-log entry per change.
 *  Append-only — nothing is deleted. */
export function DataCorrectionPanel({ rows, plainEnglish = false }: DataCorrectionPanelProps) {
  const [draftUnits, setDraftUnits] = useState<Record<string, string>>(
    Object.fromEntries(rows.map((r) => [r.holdingId, String(r.units)])),
  )
  const [draftValue, setDraftValue] = useState<Record<string, string>>({})
  const [step, setStep] = useState<"edit" | "review">("edit")
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null)
  const [pending, startTransition] = useTransition()

  const L = plainEnglish
    ? {
        title: "Fix wrong numbers",
        intro: "If the app shows positions you don't actually have, enter what you really hold (from your broker statement). Nothing is deleted — the app writes a correction and keeps a note of every change.",
        review: "Check before applying",
        apply: "Apply corrections",
        zeroAll: "Set everything to 0",
      }
    : {
        title: "Data correction — owner only",
        intro: "Enter the TRUE position per row (units, and optionally the SGD market value from your brokerage). Applying writes a corrective snapshot per changed row plus a governance-log exception entry (old → new). Append-only: no rows or history are deleted.",
        review: "Review changes",
        apply: "Apply corrections",
        zeroAll: "Set all units to 0",
      }

  const changes = rows
    .map((r) => {
      const units = parseFloat(draftUnits[r.holdingId] ?? "")
      if (!Number.isFinite(units) || units < 0) return null
      const rawValue = draftValue[r.holdingId]
      const valueSgd = rawValue !== undefined && rawValue !== "" ? parseFloat(rawValue) : undefined
      if (valueSgd !== undefined && (!Number.isFinite(valueSgd) || valueSgd < 0)) return null
      const perUnit = r.units > 0 && r.valueSgd > 0 ? r.valueSgd / r.units : 0
      const projectedValue = units === 0 ? 0 : valueSgd !== undefined ? valueSgd : units * perUnit
      const changed = Math.abs(units - r.units) > 1e-9 || (valueSgd !== undefined && Math.abs(valueSgd - r.valueSgd) > 0.005)
      if (!changed) return null
      return { row: r, units, valueSgd, projectedValue, noPrice: units > 0 && valueSgd === undefined && perUnit === 0 }
    })
    .filter((c): c is NonNullable<typeof c> => c !== null)

  function handleApply() {
    setMsg(null)
    startTransition(async () => {
      const result = await correctPositions(changes.map((c) => ({
        holdingId: c.row.holdingId,
        units: c.units,
        valueSgd: c.valueSgd ?? null,
      })))
      if (result.success) {
        setMsg({ type: "success", text: plainEnglish ? `Done — ${result.applied} position${result.applied === 1 ? "" : "s"} corrected and noted.` : `Applied ${result.applied} correction${result.applied === 1 ? "" : "s"} — each logged to the governance log.` })
        setStep("edit")
      } else {
        setMsg({ type: "error", text: result.error ?? "Could not apply the corrections." })
      }
    })
  }

  return (
    <details className="rounded-xl border border-warning/30 bg-card overflow-hidden">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-4 [&::-webkit-details-marker]:hidden">
        <Wrench className="h-4 w-4 text-warning shrink-0" />
        <span className="text-sm font-semibold">{L.title}</span>
        <span className="text-[11px] text-muted-foreground ml-auto">open ▾</span>
      </summary>
      <div className="border-t border-border p-5 space-y-4">
        <p className="text-xs text-muted-foreground">{L.intro}</p>

        {step === "edit" && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="py-2 pr-3 font-semibold">Holding</th>
                    <th className="py-2 pr-3 font-semibold text-right">Now in app</th>
                    <th className="py-2 pr-3 font-semibold text-right">True units</th>
                    <th className="py-2 font-semibold text-right">True value (S$, optional)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => (
                    <tr key={r.holdingId}>
                      <td className="py-2 pr-3 font-bold whitespace-nowrap">{r.ticker}<span className="ml-2 font-normal text-muted-foreground hidden sm:inline">{r.name}</span></td>
                      <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground whitespace-nowrap">{fmtU(r.units)} u · {fmtS(r.valueSgd)}</td>
                      <td className="py-2 pr-3 text-right">
                        <input
                          type="number" min="0" step="0.0001"
                          value={draftUnits[r.holdingId] ?? ""}
                          onChange={(e) => setDraftUnits((prev) => ({ ...prev, [r.holdingId]: e.target.value }))}
                          className="w-24 rounded border border-border bg-background px-2 py-1 text-right tabular-nums focus:outline-none focus:ring-1 focus:ring-primary"
                          aria-label={`True units of ${r.ticker}`}
                        />
                      </td>
                      <td className="py-2 text-right">
                        <input
                          type="number" min="0" step="0.01" placeholder="auto"
                          value={draftValue[r.holdingId] ?? ""}
                          onChange={(e) => setDraftValue((prev) => ({ ...prev, [r.holdingId]: e.target.value }))}
                          className="w-28 rounded border border-border bg-background px-2 py-1 text-right tabular-nums focus:outline-none focus:ring-1 focus:ring-primary"
                          aria-label={`True SGD value of ${r.ticker}`}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => { setMsg(null); if (changes.length > 0) setStep("review") }}
                disabled={changes.length === 0}
                className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
              >
                {L.review}{changes.length > 0 ? ` (${changes.length})` : ""}
              </button>
              <button
                onClick={() => setDraftUnits(Object.fromEntries(rows.map((r) => [r.holdingId, "0"])))}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-accent"
              >
                <Eraser className="h-3.5 w-3.5" /> {L.zeroAll}
              </button>
            </div>
          </>
        )}

        {step === "review" && (
          <>
            <div className="rounded-lg border border-warning/30 bg-warning/[0.06] p-3 space-y-1.5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-warning">
                {plainEnglish ? "You are about to change" : `Current → proposed (${changes.length} change${changes.length === 1 ? "" : "s"})`}
              </p>
              {changes.map((c) => (
                <p key={c.row.holdingId} className="text-xs tabular-nums">
                  <span className="font-bold">{c.row.ticker}</span>
                  {" · "}{fmtU(c.row.units)} u ({fmtS(c.row.valueSgd)}) → <span className="font-bold">{fmtU(c.units)} u ({c.units === 0 ? "S$0" : `≈${fmtS(c.projectedValue)}`})</span>
                  {c.noPrice && <span className="text-warning"> — no price on file; value stays S$0 until the next price refresh</span>}
                </p>
              ))}
              <p className="text-[11px] text-muted-foreground pt-1">
                {plainEnglish
                  ? "Every change is written as a new entry and noted in the log — nothing is erased."
                  : "Each change writes a corrective snapshot and a governance-log exception; stale cost basis is cleared until the next IBKR sync."}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleApply}
                disabled={pending}
                className="flex items-center gap-1.5 rounded-lg bg-warning px-4 py-2 text-xs font-bold text-black disabled:opacity-60"
              >
                {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                {L.apply}
              </button>
              <button onClick={() => setStep("edit")} className="text-xs text-muted-foreground hover:text-foreground">← Back</button>
            </div>
          </>
        )}

        {msg && (
          <p className={`flex items-center gap-1.5 text-xs font-semibold ${msg.type === "success" ? "text-success" : "text-danger"}`}>
            {msg.type === "success" ? <Check className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
            {msg.text}
          </p>
        )}
      </div>
    </details>
  )
}
