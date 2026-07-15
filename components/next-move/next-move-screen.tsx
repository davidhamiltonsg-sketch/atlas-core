import { formatCurrency } from "@/lib/utils"

export interface NextMoveScreenProps {
  action: string          // headline instruction, e.g. "Route cash to VWRA"
  what: string            // one plain sentence of detail
  ticker: string | null
  amount: number          // this month's contribution (SGD)
  shares: number | null   // whole shares the amount buys at the latest snapshot price
  latestPrice: number | null
  windowOpen: boolean
  windowLabel: string     // "Closes 31 Jul" or "Opens in 4 days" or "Opens 18 Aug"
  accent: "violet" | "sky"
}

/** One-screen, phone-first answer: what to buy, how much, how many shares, and when.
 *  Big type, no charts — everything above the fold on a small screen. */
export function NextMoveScreen(p: NextMoveScreenProps) {
  const accentText = p.accent === "sky" ? "text-sky-500" : "text-violet-500"
  return (
    <div className="mx-auto max-w-md space-y-4 pb-8">
      {/* The action */}
      <div className="rounded-2xl border border-border bg-card p-6 card-elevated text-center">
        <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">This month</p>
        <h1 className="mt-2 text-3xl font-black leading-tight">{p.action}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{p.what}</p>
      </div>

      {/* The amount and the share count */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-border bg-card p-5 text-center card-elevated">
          <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Amount</p>
          <p className="mt-1 text-3xl font-black tabular-nums">{formatCurrency(p.amount, "SGD")}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5 text-center card-elevated">
          <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Whole shares</p>
          {p.shares !== null && p.ticker ? (
            <>
              <p className={`mt-1 text-3xl font-black tabular-nums ${accentText}`}>{p.shares}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                × {p.ticker}{p.latestPrice && p.latestPrice > 0 ? ` at ${formatCurrency(p.latestPrice, "SGD")}` : ""}
              </p>
            </>
          ) : (
            <>
              <p className="mt-1 text-3xl font-black text-muted-foreground">—</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">No price on file yet</p>
            </>
          )}
        </div>
      </div>

      {/* The window */}
      <div className={`rounded-2xl border p-5 text-center ${
        p.windowOpen
          ? "border-green-500/40 bg-green-500/10"
          : "border-border bg-card card-elevated"
      }`}>
        <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Buying window</p>
        <p className={`mt-1 text-2xl font-black ${p.windowOpen ? "text-green-600 dark:text-green-400" : ""}`}>
          {p.windowOpen ? "Open now" : "Not yet open"}
        </p>
        <p className="text-sm text-muted-foreground mt-0.5">{p.windowLabel}</p>
      </div>
    </div>
  )
}
