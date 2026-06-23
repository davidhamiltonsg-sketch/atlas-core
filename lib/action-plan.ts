// ─────────────────────────────────────────────────────────────────────────────
// Atlas Core — The Action Plan (v6.0)
//
// THE single source of truth for what to do and when. This ordered, time-staged
// sequence is rendered by BOTH:
//   • the Dashboard  → "Your Action Plan — Step by Step"
//   • the Command Centre → "When to Act" calendar
//
// Edit the sequence here once; both surfaces stay in sync. Steps are ordered the
// way you execute them: immediate first, then this week, then the conditional /
// triggered steps in the order they unlock. The 3-month hold rule is already
// baked into each step — nothing here asks you to break it.
//
// Core principle: a loss is not a sell signal. Conviction holdings (incl. BTC) are
// accumulated on weakness toward target and sold only on a broken thesis; the SGOV
// buffer is built from new contributions, never by liquidating a position.
//
// Macro states and SGOV/SMH levels were re-verified against market sources on
// 24 Jun 2026 (see lib/next-best-move.ts → MARKET_STATE for sourcing notes).
// ─────────────────────────────────────────────────────────────────────────────

export type Urgency = "CRITICAL" | "HIGH" | "MEDIUM"

export interface ActionStep {
  // Plain-English timing — the "when" stage (e.g. "Right now", "This week",
  // "When SMH drops to $590"). Either a fixed date/cadence or a price/event trigger.
  when: string
  urgency: Urgency
  // Which position the step concerns ("ALL" for portfolio-wide steps).
  ticker: string
  // The action itself, in plain English — exactly what to do.
  what: string
  // Why it matters, with the number that drives it.
  why: string
}

export const ACTION_PLAN: ActionStep[] = [
  {
    when: "This month, and each month it stays below target",
    urgency: "HIGH",
    ticker: "BTC",
    what: "Keep BTC — and accumulate it on weakness toward its 7% target (it's currently underweight). Do not sell it.",
    why: "A loss is not a sell signal. The unrealised loss is a sunk cost; what matters is whether you'd buy at today's price — and at a lower weight, adding moves you toward target at a better cost basis. BTC is a held conviction position, capped at 8%. Sell only if the thesis breaks, never because of a red number.",
  },
  {
    when: "This week",
    urgency: "HIGH",
    ticker: "SMH",
    what: "Set price alerts on your phone: SMH @ $590, $550, $510",
    why: "SMH is at its peak (~$669, near its 52-week high). You don't add at the peak — you prepare your orders and wait. When the alert fires, you move fast with your pre-planned tranches.",
  },
  {
    when: "This week",
    urgency: "HIGH",
    ticker: "VWO",
    what: "Make a binary decision on VWO: either add 71 more shares OR trim it to zero",
    why: "129 shares at ~5% of your portfolio is the worst of both worlds — not enough to matter if EM wins, enough to drag if it doesn't. Commit to a meaningful size or exit. No middle ground. (This is a sizing decision, not a loss-driven sale.)",
  },
  {
    when: "Start this month — build gradually",
    urgency: "HIGH",
    ticker: "SGOV",
    what: "Start an SGOV (iShares 0–3 Month Treasury) position and grow it toward 8–10% of NAV using your new monthly contributions — never by selling another holding",
    why: "This is your shock absorber. Yielding about 3.85% (SEC 3.55%) with zero equity correlation. When the next market shock hits (Hormuz, tariffs, rate hike), SGOV holds value while everything else drops — and you use it to buy the dip cheaply. Build it from contributions over a few months so you never have to liquidate a position to be protected.",
  },
  {
    when: "When SMH drops to $590",
    urgency: "MEDIUM",
    ticker: "SMH",
    what: "Buy Tranche 1: spend 30% of what you planned to invest in SMH",
    why: "Don't go all-in on the first dip. The three-tranche rule means you average into the entry — reducing timing risk. If SMH keeps falling, your later tranches get a better price.",
  },
  {
    when: "3 weeks after SMH bottoms",
    urgency: "MEDIUM",
    ticker: "SMH",
    what: "After 3 consecutive green weekly closes: buy Tranche 2 (40% of your planned SMH investment)",
    why: "Three green weeks from the bottom is the historical confirmation signal. Every sustained SMH recovery in the last 5 years showed this pattern. Tranche 2 is the main deployment.",
  },
  {
    when: "Monthly — every month",
    urgency: "MEDIUM",
    ticker: "VT",
    what: "On any week VT drops to $148 or below: buy 10–15 shares",
    why: "VT is your retirement anchor. It has the lowest volatility in your portfolio. Steady accumulation at fair prices compounds powerfully over your 2045 timeline.",
  },
  {
    when: "Sep – Oct 2026",
    urgency: "MEDIUM",
    ticker: "ALL",
    what: "Monitor US–China tariff news — if negotiations are failing, reduce SMH by 5–8 shares",
    why: "The tariff truce expires Nov 10. If it's looking shaky in September, reduce your biggest risk position before the event rather than reacting after.",
  },
  {
    when: "Nov 10, 2026",
    urgency: "HIGH",
    ticker: "SMH + QQQM",
    what: "If tariff talks break down: wait 2 weeks, THEN buy SMH and QQQM aggressively",
    why: "The April 2025 tariff shock was devastating for 2 weeks — then reversed completely in 6. Don't sell. Don't panic. Have your limit orders pre-set and deploy in week 2 of any breakdown.",
  },
  {
    when: "Whenever the Fed cuts rates",
    urgency: "HIGH",
    ticker: "QQQM",
    what: "Execute immediately on cut announcement: buy 15 shares of QQQM, 30 shares of VT",
    why: "When the Fed cuts, QQQM historically gains 12–18% in the following 90 days. This is a same-day trade. Have your orders ready. Don't wait for confirmation — the market front-runs the cut.",
  },
]

// Shared urgency styling — used by both the dashboard timeline and the
// Command Centre calendar so the two surfaces read identically.
export const URGENCY_STYLES: Record<Urgency, { dot: string; border: string; badge: string }> = {
  CRITICAL: { dot: "bg-red-500", border: "border-red-500/25 bg-red-500/[0.04]", badge: "bg-red-500/10 text-red-600 dark:text-red-400" },
  HIGH: { dot: "bg-amber-500", border: "border-amber-500/25 bg-amber-500/[0.04]", badge: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  MEDIUM: { dot: "bg-blue-500", border: "border-border bg-card", badge: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
}
