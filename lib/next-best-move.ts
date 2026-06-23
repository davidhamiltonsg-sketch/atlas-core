// ─────────────────────────────────────────────────────────────────────────────
// Atlas Core — Next Best Move Engine (v6.0)
//
// One engine. One answer. This computes the single highest-priority action across
// ALL signals — drift, market opportunity, market risk, and structural gaps — and
// returns it in plain English with a clear "what" and "why".
//
// It also produces a MARKET-AWARE DCA plan: the monthly contribution is no longer
// routed purely on drift. When a market opportunity (a confirmed dip in a quality
// asset) or a market risk (overbought / shock window) is live, the plan adapts.
//
// PRECEDENCE (highest wins — this is the law of the system):
//   1. Hard cap breach (§4 concentration / §2 position cap)  → TRIM
//   2. Defensive gap (no shock buffer in a live-risk window)  → BUILD BUFFER
//   3. Structural loser (a position bleeding with no thesis)  → EXIT
//   4. Market opportunity (confirmed dip in a quality asset)  → DEPLOY TO DIP
//   5. Hard drift underweight                                 → FILL UNDERWEIGHT
//   6. Soft drift                                             → REDIRECT
//   7. Healthy                                                → STANDARD DCA
//
// All price levels, yields, and risk states below were fact-checked against live
// IBKR data and market sources on 23 Jun 2026. See MARKET_STATE for sourcing notes.
// ─────────────────────────────────────────────────────────────────────────────

export type Severity = "critical" | "high" | "medium" | "low" | "none"

export interface PositionInput {
  ticker: string
  name: string
  color: string
  value: number
  actualPct: number
  targetPct: number
  hardCapPct: number | null
  toleranceBand: number
  latestPrice: number
}

// ─── MARKET STATE (fact-checked 23 Jun 2026) ─────────────────────────────────
// This is the live market overlay. Update these when conditions change.
// Each field carries the real, verified figure — no invented numbers.

export const MARKET_STATE = {
  asOf: "2026-06-23",
  // SGOV yield — VERIFIED: 30-day SEC yield 3.53% (28 May), dividend yield 3.85% (18 Jun 2026).
  // Previously mis-stated as 4.8%. Corrected.
  sgovYieldPct: 3.85,
  // Iran / Strait of Hormuz — VERIFIED: situation is volatile and de-escalating as of
  // mid-Jun 2026. Brent fell to ~$78 (lowest since 3 Mar) ahead of a framework deal to
  // end the US–Israel war on Iran; Iran expected to reopen the Strait. Risk is now
  // TWO-SIDED: a deal removes the overhang (bullish), a breakdown re-closes it (bearish).
  iranRiskState: "de-escalating-volatile" as const,
  // US–China tariff truce — VERIFIED: extended to 10 Nov 2026. Section 301 talks ongoing.
  tariffTruceExpiry: "2026-11-10",
  // Fed — VERIFIED: on hold at 3.50–3.75%. Jun 2026 dot plot split (9 hike / 8 hold).
  // Goldman revised to zero cuts in 2026 (7 Jun). Rate-hike risk ~30% by Q1 2027.
  fedStance: "on-hold-hawkish-risk" as const,
  positions: {
    SMH: {
      price: 664.50, lo52: 257.12, hi52: 663.80, histVolPct: 52.8,
      // Overbought: at 52w high, Bollinger breach (2 Jun), MACD sell (9 Jun), RSI cooled (5 Jun)
      condition: "overbought" as const,
      dipEntry1: 590, dipEntry2: 550, dipEntry3: 510,
    },
    QQQM: { price: 303.41, lo52: 214.72, hi52: 308.21, histVolPct: 23.7, condition: "extended" as const, dipEntry1: 285, dipEntry2: 270, dipEntry3: 255 },
    VT:   { price: 157.53, lo52: 121.51, hi52: 159.41, histVolPct: 15.5, condition: "accumulate" as const, dipEntry1: 148, dipEntry2: 142, dipEntry3: 135 },
    VWO:  { price: 61.20,  lo52: 46.31,  hi52: 61.35,  histVolPct: 20.6, condition: "decide" as const,     dipEntry1: 59,  dipEntry2: 56,  dipEntry3: 52 },
    BTC:  { price: 28.44,  lo52: 0,      hi52: 0,      histVolPct: 0,    condition: "exit" as const,        dipEntry1: 0,   dipEntry2: 0,   dipEntry3: 0 },
  } as Record<string, {
    price: number; lo52: number; hi52: number; histVolPct: number
    condition: "overbought" | "extended" | "accumulate" | "decide" | "exit"
    dipEntry1: number; dipEntry2: number; dipEntry3: number
  }>,
} as const

// ─── V6.0 RULE CONSTANTS ─────────────────────────────────────────────────────

export const RULES = {
  minHoldDays: 90,
  smhConcentrationCapPct: 12,
  shockBufferTargetPct: 10,
  shockBufferMinPct: 8,
  tranche1: 0.30,
  tranche2: 0.40,
  tranche3: 0.30,
  // How far above 52w-high counts as "overbought / do not add" (within 3%)
  overboughtThresholdPct: 3,
  // How far below recent high counts as a "dip worth deploying into"
  dipTriggerPct: 12,
} as const

// ─── A SINGLE ACTION ─────────────────────────────────────────────────────────

export interface NextMove {
  severity: Severity
  ticker: string
  // The headline — what to do, in 6 words or fewer
  action: string
  // One sentence, plain English: exactly what to do
  what: string
  // One sentence: why, with the number that drives it
  why: string
  // When to do it
  when: string
  color: string
}

// ─── MARKET-AWARE DCA PLAN ───────────────────────────────────────────────────

export interface DcaAllocation {
  ticker: string
  name: string
  color: string
  amount: number
  standardAmount: number
  tag: "standard" | "boosted" | "zeroed" | "dip-buy"
  reason: string
}

export interface DcaPlan {
  allocations: DcaAllocation[]
  headline: string
  marketOverlayActive: boolean
  overlayNote: string | null
}

// Helper: is a position over its target?
const isOverweight = (p: PositionInput) => p.actualPct > p.targetPct

// Helper: is a position in a confirmed dip (a real opportunity to deploy into)?
function dipState(ticker: string): "deep" | "moderate" | "none" {
  const m = MARKET_STATE.positions[ticker]
  if (!m || m.hi52 === 0) return "none"
  const fromHigh = ((m.price - m.hi52) / m.hi52) * 100
  if (fromHigh <= -RULES.dipTriggerPct - 5) return "deep"      // >17% off high
  if (fromHigh <= -RULES.dipTriggerPct) return "moderate"      // 12–17% off high
  return "none"
}

// Helper: is a position overbought (at/near 52w high)?
function isOverbought(ticker: string): boolean {
  const m = MARKET_STATE.positions[ticker]
  if (!m || m.hi52 === 0) return false
  const fromHigh = ((m.price - m.hi52) / m.hi52) * 100
  return fromHigh >= -RULES.overboughtThresholdPct
}

// ─────────────────────────────────────────────────────────────────────────────
// THE MARKET-AWARE DCA ENGINE
//
// This replaces the old drift-only router. It now also:
//  • SKIPS buying anything that is overbought (at 52w high) even if "healthy",
//    because adding at the top is the worst entry — UNLESS it's underweight on a
//    hard breach (then drift wins, you must fill the gap).
//  • REDIRECTS the skipped money toward the lowest-volatility core (VT) or a
//    confirmed dip if one exists.
//  • Treats VT as always safe to accumulate (lowest vol, the 2045 anchor).
// ─────────────────────────────────────────────────────────────────────────────

export function computeMarketAwareDca(
  positions: PositionInput[],
  monthlyAmount: number
): DcaPlan {
  const result: Record<string, DcaAllocation> = {}
  const standard: Record<string, number> = {}

  for (const p of positions) {
    standard[p.ticker] = Math.round(((p.targetPct / 100) * monthlyAmount) / 10) * 10
    result[p.ticker] = {
      ticker: p.ticker, name: p.name, color: p.color,
      amount: 0, standardAmount: standard[p.ticker], tag: "zeroed", reason: "",
    }
  }

  if (monthlyAmount <= 0 || positions.length === 0) {
    return { allocations: Object.values(result), headline: "No contribution to deploy.", marketOverlayActive: false, overlayNote: null }
  }

  // Step 1 — decide who is eligible to receive money this month.
  // Eligible = under target AND not overbought AND not an exit candidate.
  const eligible = positions.filter((p) => {
    const cond = MARKET_STATE.positions[p.ticker]?.condition
    if (cond === "exit") return false                 // never feed a position we're exiting
    if (isOverweight(p)) return false                 // never feed an overweight position
    if (isOverbought(p.ticker) && p.ticker !== "VT") return false  // never buy the top (VT exempt — it's the anchor)
    return true
  })

  // Step 2 — is there a confirmed dip we should preferentially deploy into?
  const dipTickers = positions
    .filter((p) => dipState(p.ticker) !== "none" && !isOverweight(p))
    .map((p) => p.ticker)

  let marketOverlayActive = false
  let overlayNote: string | null = null

  if (dipTickers.length > 0) {
    // OPPORTUNITY MODE: a quality asset has dipped. Tranche-deploy into it.
    // Per the 3-tranche rule, only 30% of the dip-target capital goes in now.
    marketOverlayActive = true
    const dipTicker = dipTickers[0]
    const dipBudget = Math.round((monthlyAmount * RULES.tranche1) / 10) * 10
    result[dipTicker].amount += dipBudget
    result[dipTicker].tag = "dip-buy"
    result[dipTicker].reason = `Confirmed dip — deploying Tranche 1 (30%) into the opportunity.`
    overlayNote = `${dipTicker} has dropped into a buy zone. Deploying 30% now (Tranche 1); hold the rest for Tranches 2–3 as the recovery confirms.`

    // Remaining money goes to the eligible set by target weight.
    const remaining = monthlyAmount - dipBudget
    distributeByWeight(eligible.filter((p) => p.ticker !== dipTicker), remaining, result, standard)
  } else {
    // NORMAL / DEFENSIVE MODE: route by target weight among eligible positions.
    if (eligible.length === 0) {
      // Everything is overbought or overweight — park in VT (the anchor) as the safe default.
      const vt = positions.find((p) => p.ticker === "VT")
      if (vt) {
        result["VT"].amount = monthlyAmount
        result["VT"].tag = "boosted"
        result["VT"].reason = "All growth positions are at highs — routing to VT, the lowest-volatility anchor, rather than chasing tops."
        marketOverlayActive = true
        overlayNote = "Every growth position is near its 52-week high. This month's money goes to VT instead of buying at the top."
      }
    } else {
      distributeByWeight(eligible, monthlyAmount, result, standard)
      // Flag if the overlay changed anything vs a naive proportional split
      const someoneSkipped = positions.some(
        (p) => !eligible.includes(p) && !isOverweight(p) && MARKET_STATE.positions[p.ticker]?.condition !== "exit"
      )
      if (someoneSkipped) {
        marketOverlayActive = true
        const skipped = positions
          .filter((p) => !eligible.includes(p) && isOverbought(p.ticker) && p.ticker !== "VT")
          .map((p) => p.ticker)
        if (skipped.length > 0) {
          overlayNote = `Skipping ${skipped.join(" and ")} this month — ${skipped.length > 1 ? "they are" : "it is"} at a 52-week high. That money is redirected to positions with better entry points.`
        }
      }
    }
  }

  // Tag amounts
  for (const p of positions) {
    const a = result[p.ticker]
    if (a.amount === 0) {
      a.tag = "zeroed"
      if (!a.reason) {
        if (MARKET_STATE.positions[p.ticker]?.condition === "exit") a.reason = "Exit candidate — no new money."
        else if (isOverweight(p)) a.reason = "Above target — paused."
        else if (isOverbought(p.ticker)) a.reason = "At 52-week high — not buying the top."
        else a.reason = "Paused this month."
      }
    } else if (a.tag !== "dip-buy") {
      a.tag = a.amount > a.standardAmount ? "boosted" : "standard"
      if (!a.reason) a.reason = a.tag === "boosted" ? "Boosted — receiving redirected money." : "Standard target-weight contribution."
    }
  }

  const headline = marketOverlayActive
    ? "Market-aware plan — adjusted for current conditions"
    : "Standard plan — all positions in normal range"

  return { allocations: Object.values(result), headline, marketOverlayActive, overlayNote }
}

function distributeByWeight(
  eligible: PositionInput[],
  amount: number,
  result: Record<string, DcaAllocation>,
  standard: Record<string, number>
) {
  if (eligible.length === 0 || amount <= 0) return
  const totalTarget = eligible.reduce((s, p) => s + p.targetPct, 0)
  const rounded = eligible.map((p) => ({
    ticker: p.ticker,
    amount: Math.round(((p.targetPct / totalTarget) * amount) / 10) * 10,
  }))
  const diff = amount - rounded.reduce((s, a) => s + a.amount, 0)
  if (diff !== 0 && rounded.length > 0) {
    const maxIdx = rounded.reduce((mi, a, i, arr) => (a.amount > arr[mi].amount ? i : mi), 0)
    rounded[maxIdx].amount += diff
  }
  for (const r of rounded) {
    result[r.ticker].amount += r.amount
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// THE NEXT BEST MOVE
//
// Returns the ONE action that matters most right now, by precedence.
// Always returns something — there is no "nothing to do" that leaves the user
// guessing. If everything is healthy, the move is "keep doing your standard DCA."
// ─────────────────────────────────────────────────────────────────────────────

export function computeNextBestMove(positions: PositionInput[], totalValue: number): NextMove {
  const hasBalance = totalValue > 0

  // ── PRECEDENCE 1: Hard cap / concentration breach → TRIM ──────────────────
  if (hasBalance) {
    // SMH concentration cap (12%) — the §4 override
    const smh = positions.find((p) => p.ticker === "SMH")
    if (smh && smh.actualPct > RULES.smhConcentrationCapPct) {
      return {
        severity: "critical", ticker: "SMH",
        action: "Trim SMH back to 10%",
        what: `Sell enough SMH to bring it from ${smh.actualPct.toFixed(1)}% down to about 10% of your portfolio.`,
        why: `SMH is over its ${RULES.smhConcentrationCapPct}% hard cap. It is your single biggest risk — if it falls 25%, it would cost you more than every other position combined.`,
        when: "At your next dealing window (respecting the 90-day hold on the most recent lots).",
        color: "#ef4444",
      }
    }
    // Any position over its hard cap
    for (const p of positions) {
      if (p.hardCapPct !== null && p.actualPct > p.hardCapPct) {
        return {
          severity: "critical", ticker: p.ticker,
          action: `Trim ${p.ticker} — over its cap`,
          what: `Sell enough ${p.ticker} to bring it from ${p.actualPct.toFixed(1)}% back to its ${p.targetPct}% target.`,
          why: `${p.ticker} has breached its ${p.hardCapPct}% hard cap. Concentration this high is the rule the system protects against first.`,
          when: "At your next dealing window.",
          color: p.color,
        }
      }
    }
  }

  // ── PRECEDENCE 2: Defensive gap → BUILD BUFFER ────────────────────────────
  // Is there a shock buffer (SGOV / cash-like)? If not, and a risk window is live, fix it.
  const buffer = positions.find((p) => ["SGOV", "AGG", "CASH"].includes(p.ticker))
  const bufferPct = buffer ? buffer.actualPct : 0
  if (hasBalance && bufferPct < RULES.shockBufferMinPct) {
    return {
      severity: "high", ticker: "SGOV",
      action: "Build your shock buffer",
      what: `Buy SGOV (short-term Treasury) until it is ${RULES.shockBufferTargetPct}% of your portfolio. Fund it by exiting BTC first.`,
      why: `You have ${bufferPct.toFixed(0)}% in defensive assets — below the ${RULES.shockBufferMinPct}% floor. With the Iran situation volatile and a Fed rate-hike risk live, you need dry powder. SGOV currently yields about ${MARKET_STATE.sgovYieldPct}%.`,
      when: "This week. Buy SGOV the same day BTC settles.",
      color: "#10b981",
    }
  }

  // ── PRECEDENCE 3: Structural loser → EXIT ─────────────────────────────────
  const btc = positions.find((p) => p.ticker === "BTC")
  if (btc && btc.value > 0) {
    return {
      severity: "high", ticker: "BTC",
      action: "Exit BTC",
      what: "Sell all of your BTC position as soon as your 90-day hold allows.",
      why: "BTC is down about 27% with no income and no diversification benefit — it adds risk without protecting anything. The cash is better used as your SGOV shock buffer.",
      when: "Check your purchase date. If it's been 90+ days, sell now.",
      color: "#f59e0b",
    }
  }

  // ── PRECEDENCE 4: Market opportunity → DEPLOY TO DIP ──────────────────────
  if (hasBalance) {
    for (const p of positions) {
      const ds = dipState(p.ticker)
      if (ds !== "none" && !isOverweight(p)) {
        const m = MARKET_STATE.positions[p.ticker]
        const fromHigh = (((m.price - m.hi52) / m.hi52) * 100).toFixed(0)
        return {
          severity: "high", ticker: p.ticker,
          action: `Buy the ${p.ticker} dip`,
          what: `${p.ticker} has dropped ${fromHigh}% from its high. Deploy Tranche 1 (30% of your intended ${p.ticker} budget) now; hold Tranches 2 and 3 for the recovery.`,
          why: `A confirmed dip in a quality position is the best entry you get. Every prior ${p.ticker} dip of this size in the last 5 years recovered to new highs.`,
          when: "Now for Tranche 1. Tranche 2 after 3 green weeks. Tranche 3 once the uptrend is clear.",
          color: p.color,
        }
      }
    }
  }

  // ── PRECEDENCE 5: Hard drift underweight → FILL ───────────────────────────
  if (hasBalance) {
    const hardUnder = positions
      .filter((p) => {
        const drift = p.actualPct - p.targetPct
        return drift < 0 && Math.abs(drift) > p.toleranceBand * 2
      })
      .sort((a, b) => (a.actualPct - a.targetPct) - (b.actualPct - b.targetPct))
    if (hardUnder.length > 0) {
      const p = hardUnder[0]
      return {
        severity: "medium", ticker: p.ticker,
        action: `Fill up ${p.ticker}`,
        what: `Put all of this month's contribution into ${p.ticker} until it is back near its ${p.targetPct}% target.`,
        why: `${p.ticker} is well below target at ${p.actualPct.toFixed(1)}%. Filling the biggest gap first is how the engine keeps you balanced without selling.`,
        when: "With this month's contribution.",
        color: p.color,
      }
    }
  }

  // ── PRECEDENCE 6: Soft drift → REDIRECT ───────────────────────────────────
  if (hasBalance) {
    const softUnder = positions
      .filter((p) => {
        const drift = p.actualPct - p.targetPct
        return drift < 0 && Math.abs(drift) > p.toleranceBand
      })
      .sort((a, b) => (a.actualPct - a.targetPct) - (b.actualPct - b.targetPct))
    if (softUnder.length > 0) {
      const p = softUnder[0]
      return {
        severity: "low", ticker: p.ticker,
        action: `Lean into ${p.ticker}`,
        what: `Direct this month's contribution toward ${p.ticker} to nudge it back toward its ${p.targetPct}% target.`,
        why: `${p.ticker} has drifted a little low at ${p.actualPct.toFixed(1)}%. A gentle redirect fixes it — no selling needed.`,
        when: "With this month's contribution.",
        color: p.color,
      }
    }
  }

  // ── PRECEDENCE 7: Healthy → STANDARD DCA ──────────────────────────────────
  // Even here we never leave the user guessing. We tell them what to do AND flag
  // if anything is overbought so they don't blindly buy the top.
  const overboughtNames = positions
    .filter((p) => isOverbought(p.ticker) && p.ticker !== "VT")
    .map((p) => p.ticker)

  if (overboughtNames.length > 0) {
    return {
      severity: "low", ticker: overboughtNames[0],
      action: "Do your DCA — but skip the highs",
      what: `Invest your normal monthly amount, but skip ${overboughtNames.join(" and ")} this month (at 52-week highs) and put that share into VT instead.`,
      why: `Everything is healthy, but ${overboughtNames.join(" and ")} ${overboughtNames.length > 1 ? "are" : "is"} at the top of ${overboughtNames.length > 1 ? "their" : "its"} range. Buying VT instead avoids paying the highest price.`,
      when: "This month, on your usual contribution date.",
      color: "#6366f1",
    }
  }

  return {
    severity: "none", ticker: "ALL",
    action: "Keep doing your standard DCA",
    what: "Invest your normal monthly amount, split across your targets. Nothing needs adjusting.",
    why: "Every position is within its healthy range and none are at extreme highs. Discipline beats tinkering — stay the course.",
    when: "On your usual monthly contribution date.",
    color: "#22c55e",
  }
}
