import { formatCurrency } from "@/lib/utils"

export interface NextMoveScreenProps {
  action: string             // headline instruction, e.g. "Route cash to VWRA"
  what: string               // one plain sentence of detail
  ticker: string | null
  amountPrimary: string      // plan-currency figure: "US$3,000" (Atlas, Art. XIII) / "S$1,000" (SBR)
  amountSecondary: string | null // SGD reporting equivalent for Atlas, e.g. "≈ S$4,065 at 1.3550"
  shares: number | null      // whole shares the planner funds (cash bank + this month)
  sgdPrice: number | null    // SGD price per share the planner used
  planLine: string | null    // full planner sentence incl. cash bank and carry-forward
  windowOpen: boolean
  windowLabel: string        // "Closes 31 Jul" / "Opens in 6 days — 20 Jul" / next-month line
  accent: "violet" | "sky"
  children?: React.ReactNode // log-execution button and "why this move" ladder, composed by the page
}

/** One-screen, phone-first answer: what to buy, how much, how many whole shares, and when.
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

      {/* The amount and the whole-share count */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-border bg-card p-5 text-center card-elevated">
          <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Amount</p>
          <p className="mt-1 text-3xl font-black tabular-nums">{p.amountPrimary}</p>
          {p.amountSecondary && <p className="text-[11px] text-muted-foreground mt-0.5 tabular-nums">{p.amountSecondary}</p>}
        </div>
        <div className="rounded-2xl border border-border bg-card p-5 text-center card-elevated">
          <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Whole shares</p>
          {p.shares !== null && p.ticker ? (
            <>
              <p className={`mt-1 text-3xl font-black tabular-nums ${accentText}`}>{p.shares}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                × {p.ticker}{p.sgdPrice && p.sgdPrice > 0 ? ` at ${formatCurrency(p.sgdPrice, "SGD")}` : ""}
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

      {/* Whole-share plan incl. carried-forward cash */}
      {p.planLine && <p className="text-xs text-muted-foreground text-center px-2">{p.planLine}</p>}

      {/* The window */}
      <div className={`rounded-2xl border p-5 text-center ${
        p.windowOpen ? "border-success/40 bg-success/10" : "border-border bg-card card-elevated"
      }`}>
        <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Buying window</p>
        <p className={`mt-1 text-2xl font-black ${p.windowOpen ? "text-success" : ""}`}>
          {p.windowOpen ? "Open now" : "Not yet open"}
        </p>
        <p className="text-sm text-muted-foreground mt-0.5">{p.windowLabel}</p>
      </div>

      {p.children}
    </div>
  )
}
