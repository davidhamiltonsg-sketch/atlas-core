import { ShieldAlert, ShoppingCart, Ruler, Lock, CalendarClock } from "lucide-react"

// Behavioural Pre-Commitments (GOVERNANCE-precommitments.md) — binding rules decided
// in advance so no decision is made in the heat of a shock. Where two conflict, the
// most conservative (do-less, sell-nothing) interpretation wins.

type Group = {
  id: string
  title: string
  Icon: typeof ShieldAlert
  accent: string
  rules: { id: string; name: string; body: string }[]
}

const GROUPS: Group[] = [
  {
    id: "A", title: "Shock response (decided before the shock)", Icon: ShieldAlert, accent: "text-red-500 bg-red-500/10",
    rules: [
      { id: "A1", name: "Policy shock", body: "On a >~10% drop from a discrete event (tariff, geopolitics, regulation): take NO action for 14 calendar days, then deploy the buffer into the most beaten-down quality holding in tranches. Sell nothing." },
      { id: "A2", name: "Macro shock", body: "On a sustained decline (rate cycle, recession, de-rating): hold everything, continue scheduled contributions unchanged, do not redesign. The 2022 rule — holders who kept buying recovered." },
      { id: "A3", name: "A loss is never a sell trigger", body: "Being down is a sunk cost. Sell a conviction holding only when its thesis breaks — never the colour of the number. Ask: “Would I buy this at today's price?” If yes, do not sell." },
      { id: "A4", name: "Never crystallise a loss to fund something else", body: "Buffers, new positions and rebalances are funded from new contributions — never by selling an underwater position. Stops loss-aversion disguising itself as risk management." },
    ],
  },
  {
    id: "B", title: "Buying discipline", Icon: ShoppingCart, accent: "text-amber-500 bg-amber-500/10",
    rules: [
      { id: "B1", name: "Don't buy the top", body: "Do not add to any position within ~3% of its 52-week high. The broad-market anchor (VT) is exempt. Redirect skipped money to the anchor or hold it." },
      { id: "B2", name: "Three-tranche entry", body: "Never deploy full intended capital on the first signal. Split 30% / 40% / 30%: 30% on the first dip, 40% after three green weeks from the trough, 30% once the uptrend confirms." },
      { id: "B3", name: "Accumulate conviction on weakness", body: "An underweight conviction holding (e.g. BTC below its 7% target) is accumulated on weakness toward target, under its cap — never exited for being down." },
    ],
  },
  {
    id: "C", title: "Structural limits", Icon: Ruler, accent: "text-indigo-500 bg-indigo-500/10",
    rules: [
      { id: "C1", name: "Hard caps are inviolable", body: "SMH ≤ 12%, BTC ≤ its cycle cap, combined QQQM+SMH ≤ 42% (§4.3). A breach triggers a trim back to target. No debate, no exceptions." },
      { id: "C2", name: "Maintain an 8–10% defensive buffer at all times once built", body: "Built only from new contributions (see A4)." },
      { id: "C3", name: "No half-convictions", body: "Every position is either sized to matter when it wins or exited. No orphan positions too small to help and large enough to drag." },
    ],
  },
  {
    id: "D", title: "Anti-tinkering throttles (protection from self)", Icon: Lock, accent: "text-violet-500 bg-violet-500/10",
    rules: [
      { id: "D1", name: "One discretionary change per quarter, maximum", body: "Rule-mandated actions (cap trims, scheduled DCA) are unlimited. Discretionary changes — new ideas, re-weights, additions — are capped at one per calendar quarter." },
      { id: "D2", name: "72-hour cooling-off", body: "Any action not already mandated by a written rule waits 72 hours before execution. Most urges do not survive three days." },
      { id: "D3", name: "New positions require a written thesis and a one-quarter wait", body: "No impulse tickers. The five/six-position structure is the default and changing it is deliberately slow." },
    ],
  },
  {
    id: "E", title: "Cadence", Icon: CalendarClock, accent: "text-green-500 bg-green-500/10",
    rules: [
      { id: "E1", name: "The monthly 5-minute check", body: "Once a month: check caps (trim if breached) → check underweights (route the contribution) → check the scheduled-events calendar → act only if a rule fires. Otherwise, close the app." },
    ],
  },
]

export function PreCommitments() {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden mb-6">
      <div className="px-5 py-4 border-b border-border">
        <h2 className="text-sm font-semibold">Behavioural Pre-Commitments</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Binding rules decided in advance, so no decision is made in the heat of a shock. Where two
          conflict, the most conservative (do-less, sell-nothing) interpretation wins. The larger long-term
          threat is not the shock — it is well-intentioned tinkering.
        </p>
      </div>

      <div className="divide-y divide-border">
        {GROUPS.map((g) => {
          const { Icon } = g
          return (
            <div key={g.id} className="px-5 py-4">
              <div className="flex items-center gap-2 mb-3">
                <span className={`inline-flex h-6 w-6 items-center justify-center rounded-lg ${g.accent}`}>
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <h3 className="text-xs font-bold uppercase tracking-wide text-foreground">{g.id}. {g.title}</h3>
              </div>
              <div className="space-y-2.5 pl-8">
                {g.rules.map((r) => (
                  <div key={r.id}>
                    <p className="text-xs font-semibold">
                      <span className="text-muted-foreground mr-1.5">{r.id}</span>{r.name}
                    </p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">{r.body}</p>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      <div className="px-5 py-3 border-t border-border bg-muted/20">
        <p className="text-[11px] text-muted-foreground italic">
          Pre-decide behaviour, automate away the chances to override it, and keep a buffer that needs no
          prediction. Shocks recover; accumulated tinkering does not.
        </p>
      </div>
    </div>
  )
}
