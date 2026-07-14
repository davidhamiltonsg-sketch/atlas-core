import { formatCurrency } from "@/lib/utils"

export interface ContributionMonthRow {
  key: string          // "YYYY-MM"
  label: string        // "Jan 2026"
  contributed: number  // SGD net new money recorded that month
  planned: number      // SGD constitution plan for that month (incl. January boost for Atlas)
  isCurrentMonth: boolean
}

function statusFor(row: ContributionMonthRow): { label: string; color: string } {
  if (row.isCurrentMonth && row.contributed < row.planned) return { label: "In progress", color: "text-muted-foreground" }
  if (row.planned <= 0) return { label: "—", color: "text-muted-foreground" }
  if (row.contributed >= row.planned * 0.98) return { label: "On plan", color: "text-green-500" }
  if (row.contributed > 0) return { label: "Partial", color: "text-yellow-400" }
  return { label: "Missed", color: "text-red-500" }
}

/** Month-by-month contributed-vs-planned table. Pure presentation — the page owns the data. */
export function ContributionLedger({ rows }: { rows: ContributionMonthRow[] }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-5 py-4 border-b border-border">
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Month by month</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="px-5 py-2.5 text-left font-semibold text-muted-foreground">Month</th>
              <th className="px-5 py-2.5 text-right font-semibold text-muted-foreground">Added</th>
              <th className="px-5 py-2.5 text-right font-semibold text-muted-foreground">Planned</th>
              <th className="px-5 py-2.5 text-right font-semibold text-muted-foreground">Difference</th>
              <th className="px-5 py-2.5 text-right font-semibold text-muted-foreground">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => {
              const diff = row.contributed - row.planned
              const status = statusFor(row)
              return (
                <tr key={row.key} className="hover:bg-accent/30 transition-colors">
                  <td className="px-5 py-3 font-semibold">{row.label}</td>
                  <td className="px-5 py-3 text-right tabular-nums font-semibold">{formatCurrency(row.contributed, "SGD")}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">{formatCurrency(row.planned, "SGD")}</td>
                  <td className={`px-5 py-3 text-right tabular-nums ${diff >= 0 ? "text-green-500" : "text-muted-foreground"}`}>
                    {diff >= 0 ? "+" : "−"}{formatCurrency(Math.abs(diff), "SGD")}
                  </td>
                  <td className={`px-5 py-3 text-right font-semibold ${status.color}`}>{status.label}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export interface CashBankEntryRow {
  id: string
  date: string          // pre-formatted date label
  type: string          // CONTRIBUTION | PURCHASE | COMMISSION | FX | ADJUSTMENT
  description: string | null
  amount: number
  balanceAfter: number
}

const TYPE_LABEL: Record<string, string> = {
  CONTRIBUTION: "Money in",
  PURCHASE: "Purchase",
  COMMISSION: "Commission",
  FX: "Currency conversion",
  ADJUSTMENT: "Adjustment",
}

/** Carry-forward history of the contribution cash bank (money that is waiting for the next
 *  whole-share purchase). Plain-English row labels so the SBR surface needs no glossary. */
export function CashBankHistory({ entries, bankLabel }: { entries: CashBankEntryRow[]; bankLabel: string }) {
  if (entries.length === 0) return null
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-5 py-4 border-b border-border">
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{bankLabel}</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="px-5 py-2.5 text-left font-semibold text-muted-foreground">Date</th>
              <th className="px-5 py-2.5 text-left font-semibold text-muted-foreground">What happened</th>
              <th className="px-5 py-2.5 text-right font-semibold text-muted-foreground">Amount</th>
              <th className="px-5 py-2.5 text-right font-semibold text-muted-foreground">Balance after</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {entries.map((e) => (
              <tr key={e.id} className="hover:bg-accent/30 transition-colors">
                <td className="px-5 py-3 text-muted-foreground whitespace-nowrap">{e.date}</td>
                <td className="px-5 py-3">
                  <span className="font-semibold">{TYPE_LABEL[e.type] ?? e.type}</span>
                  {e.description && <span className="text-muted-foreground ml-2 hidden sm:inline">{e.description}</span>}
                </td>
                <td className={`px-5 py-3 text-right tabular-nums font-semibold ${e.amount < 0 ? "text-red-500" : "text-green-500"}`}>
                  {e.amount >= 0 ? "+" : "−"}{formatCurrency(Math.abs(e.amount), "SGD")}
                </td>
                <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">{formatCurrency(e.balanceAfter, "SGD")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
