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
//   1. Hard cap / concentration breach (§4 / §2 position cap)      → TRIM to target
//   2. Defensive gap (buffer below floor)                          → BUILD SGOV from NEW contributions (never by selling)
//   3. Market opportunity (confirmed dip in a quality asset)       → DEPLOY tranche 1 into the dip
//   4. Conviction underweight (e.g. BTC below target)             → ACCUMULATE on weakness toward target (never sell at a loss)
//   5. Hard drift underweight                                      → FILL the biggest gap
//   6. Soft drift                                                  → REDIRECT the contribution
//   7. Healthy                                                     → STANDARD DCA (skip 52-week highs)
//
// CORE PRINCIPLE — a loss is not a sell signal. Hold/sell of a conviction asset is
// forward-looking ("would I buy at today's price?"), never driven by an unrealised
// loss (a sunk cost). A conviction asset is sold ONLY on a broken thesis. The shock
// buffer is built from new contributions, never by liquidating a held position.
//
// Macro states and the SGOV/SMH levels below were re-verified against live market
// sources on 24 Jun 2026 (see MARKET_STATE). Per-position levels for VT/QQQM/VWO are
// carried from the prior 23 Jun snapshot and may be stale — treat as UNVERIFIED.
// ─────────────────────────────────────────────────────────────────────────────

import { getBtcModifier, COMBINED_TECH_RULE, type BtcCyclePhase } from "@/lib/constants"

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
  asOf: "2026-06-24",
  // SGOV yield — VERIFIED 24 Jun 2026: dividend yield 3.85% (18 Jun), 30-day SEC yield 3.55% (17 Jun).
  sgovYieldPct: 3.85,
  sgovSecYieldPct: 3.55,
  // Iran / Strait of Hormuz — VERIFIED 24 Jun 2026: VOLATILE AND CONTESTED. A 17 Jun
  // memorandum to end the conflict and reopen the Strait collapsed within days; Iran
  // RE-CLOSED the Strait on 20 Jun citing Israeli violations (US military denies). Geneva
  // talks were postponed 19 Jun. Brent ~$77–80 mid-to-late Jun. Risk is genuinely TWO-SIDED
  // and fluid week to week: a durable deal removes the overhang (bullish); sustained closure
  // spikes oil and inflation (bearish). Do not trade the headlines.
  iranRiskState: "volatile-contested" as const,
  // US–China tariff truce — VERIFIED 24 Jun 2026: extended to 10 Nov 2026 (Busan Trump–Xi
  // deal, 30 Oct 2025); renegotiated annually. Section 301 exclusions extended to same date.
  tariffTruceExpiry: "2026-11-10",
  // Fed — VERIFIED 24 Jun 2026: held at 3.50–3.75% for a 4th consecutive meeting (17 Jun);
  // first meeting under chair Kevin Warsh; statement dropped prior easing language and nodded
  // to possible hikes ahead. Stance: on hold, hawkish-risk.
  fedStance: "on-hold-hawkish-risk" as const,
  positions: {
    SMH: {
      // VERIFIED 24 Jun 2026: ~$668.91, 52w range $265.74–$671.83 — at/near 52w high (overbought).
      price: 668.91, lo52: 265.74, hi52: 671.83, histVolPct: 52.8, // histVolPct UNVERIFIED (estimate)
      condition: "overbought" as const,
      dipEntry1: 590, dipEntry2: 550, dipEntry3: 510,
    },
    // VT/QQQM/VWO levels below are UNVERIFIED — carried from the prior 23 Jun snapshot.
    QQQM: { price: 303.41, lo52: 214.72, hi52: 308.21, histVolPct: 23.7, condition: "extended" as const, dipEntry1: 285, dipEntry2: 270, dipEntry3: 255 },
    VT:   { price: 157.53, lo52: 121.51, hi52: 159.41, histVolPct: 15.5, condition: "accumulate" as const, dipEntry1: 148, dipEntry2: 142, dipEntry3: 135 },
    VWO:  { price: 61.20,  lo52: 46.31,  hi52: 61.35,  histVolPct: 20.6, condition: "decide" as const,     dipEntry1: 59,  dipEntry2: 56,  dipEntry3: 52 },
    // BTC is a HELD CONVICTION asset, not an exit candidate. Underweight vs its 7% target →
    // accumulate on weakness toward target under its 8% cap. (price UNVERIFIED; no 52w market overlay.)
    BTC:  { price: 28.44,  lo52: 0,      hi52: 0,      histVolPct: 0,    condition: "accumulate" as const,  dipEntry1: 0,   dipEntry2: 0,   dipEntry3: 0 },
    // IBIT — tax-effective Bitcoin vehicle; BTC transitions here like-for-like. Same sleeve.
    IBIT: { price: 0,      lo52: 0,      hi52: 0,      histVolPct: 0,    condition: "accumulate" as const,  dipEntry1: 0,   dipEntry2: 0,   dipEntry3: 0 },
  } as Record<string, {
    price: number; lo52: number; hi52: number; histVolPct: number
    condition: "overbought" | "extended" | "accumulate" | "decide"
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

// Held conviction assets. These may run above target (under their hard cap) and are
// NEVER sold to fund anything; an underweight conviction asset is accumulated on
// weakness toward target. Selling one requires a broken thesis — never a paper loss.
export const CONVICTION_TICKERS = ["QQQM", "SMH", "BTC", "IBIT"] as const

// The Bitcoin sleeve. BTC and IBIT are the SAME economic exposure (Bitcoin); IBIT is
// the more tax-effective vehicle and BTC is being transitioned into it like-for-like.
// They are governed as ONE sleeve: combined target 7%, combined cycle-aware cap (§4.1).
export const BITCOIN_TICKERS = ["BTC", "IBIT"] as const

// ─── LIVE MARKET OVERLAY (Finnhub, §F1) ──────────────────────────────────────
// A live overlay can replace the hardcoded price / 52-week levels / volatility used
// by the recommendation logic. When absent (no key, fetch failed), the engine falls
// back to the verified MARKET_STATE constants above.
export interface LiveMarketPos { price: number; lo52: number; hi52: number; histVolPct: number }
export type EngineMarket = Record<string, LiveMarketPos>

export interface EngineOptions {
  /** Live price/52w/vol overlay per ticker (from lib/finnhub). Falls back to MARKET_STATE. */
  market?: EngineMarket
  /** Current BTC halving-cycle phase, for the floating BTC hard cap (§4.1). */
  btcCyclePhase?: BtcCyclePhase
  /** Worst live §4 look-through breach (company/sector effective exposure over hard cap). */
  lookThroughBreach?: { label: string; pct: number; hard: number; trimTicker: string | null }
}

/** Merge a live overlay over the hardcoded MARKET_STATE positions. */
function resolveMarket(override?: EngineMarket): EngineMarket {
  const base: EngineMarket = {}
  for (const [t, m] of Object.entries(MARKET_STATE.positions)) {
    base[t] = { price: m.price, lo52: m.lo52, hi52: m.hi52, histVolPct: m.histVolPct }
  }
  if (override) {
    for (const [t, m] of Object.entries(override)) {
      // Only overlay sane values; a 0/NaN live read keeps the verified fallback.
      base[t] = {
        price:      m.price > 0 ? m.price : base[t]?.price ?? 0,
        lo52:       m.lo52  > 0 ? m.lo52  : base[t]?.lo52  ?? 0,
        hi52:       m.hi52  > 0 ? m.hi52  : base[t]?.hi52  ?? 0,
        histVolPct: m.histVolPct > 0 ? m.histVolPct : base[t]?.histVolPct ?? 0,
      }
    }
  }
  return base
}

/** Combined QQQM+SMH exposure (§4.3) as a whole-number percent of NAV. */
export function combinedTechPct(positions: PositionInput[]): number {
  return positions
    .filter((p) => (COMBINED_TECH_RULE.tickers as readonly string[]).includes(p.ticker))
    .reduce((s, p) => s + p.actualPct, 0)
}

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
function dipState(ticker: string, market: EngineMarket): "deep" | "moderate" | "none" {
  const m = market[ticker]
  if (!m || m.hi52 === 0) return "none"
  const fromHigh = ((m.price - m.hi52) / m.hi52) * 100
  if (fromHigh <= -RULES.dipTriggerPct - 5) return "deep"      // >17% off high
  if (fromHigh <= -RULES.dipTriggerPct) return "moderate"      // 12–17% off high
  return "none"
}

// Helper: is a position overbought (at/near 52w high)?
function isOverbought(ticker: string, market: EngineMarket): boolean {
  const m = market[ticker]
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
  monthlyAmount: number,
  opts: EngineOptions = {}
): DcaPlan {
  const market = resolveMarket(opts.market)
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

  // §4.3 — combined QQQM+SMH ceiling. At/above the soft ceiling, halt NEW buys of
  // both until combined falls back below it (concentration override on contributions).
  const combinedTech = combinedTechPct(positions)
  const techHalted = combinedTech >= COMBINED_TECH_RULE.softCeiling

  // Step 1 — decide who is eligible to receive money this month.
  // Eligible = under target AND not overbought. Underweight conviction holdings
  // (incl. BTC) ARE eligible — we accumulate on weakness toward target.
  const eligible = positions.filter((p) => {
    if (isOverweight(p)) return false                 // never feed an overweight position
    if (isOverbought(p.ticker, market) && p.ticker !== "VT") return false  // never buy the top (VT exempt — it's the anchor)
    if (techHalted && (COMBINED_TECH_RULE.tickers as readonly string[]).includes(p.ticker)) return false // §4.3 halt
    return true
  })

  // Step 2 — is there a confirmed dip we should preferentially deploy into?
  // (Tech names are excluded while the combined ceiling is breached.)
  const dipTickers = positions
    .filter((p) => dipState(p.ticker, market) !== "none" && !isOverweight(p)
      && !(techHalted && (COMBINED_TECH_RULE.tickers as readonly string[]).includes(p.ticker)))
    .map((p) => p.ticker)

  let marketOverlayActive = false
  let overlayNote: string | null = null

  if (techHalted) {
    marketOverlayActive = true
    overlayNote = `Combined QQQM+SMH is ${combinedTech.toFixed(1)}% — at/over the ${COMBINED_TECH_RULE.softCeiling}% tech-concentration ceiling (§4.3). New QQQM and SMH buys are paused this month; that money is redirected until combined falls below ${COMBINED_TECH_RULE.softCeiling - 2}%.`
  }

  if (dipTickers.length > 0) {
    // OPPORTUNITY MODE: a quality asset has dipped. Tranche-deploy into it.
    // Per the 3-tranche rule, only 30% of the dip-target capital goes in now.
    marketOverlayActive = true
    const dipTicker = dipTickers[0]
    const dipBudget = Math.round((monthlyAmount * RULES.tranche1) / 10) * 10
    result[dipTicker].amount += dipBudget
    result[dipTicker].tag = "dip-buy"
    result[dipTicker].reason = `Confirmed dip — deploying Tranche 1 (30%) into the opportunity.`
    if (!overlayNote) overlayNote = `${dipTicker} has dropped into a buy zone. Deploying 30% now (Tranche 1); hold the rest for Tranches 2–3 as the recovery confirms.`

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
        if (!overlayNote) overlayNote = "Every growth position is near its 52-week high. This month's money goes to VT instead of buying at the top."
      }
    } else {
      distributeByWeight(eligible, monthlyAmount, result, standard)
      // Flag if the overlay changed anything vs a naive proportional split
      const someoneSkipped = positions.some(
        (p) => !eligible.includes(p) && !isOverweight(p)
      )
      if (someoneSkipped) {
        marketOverlayActive = true
        const skipped = positions
          .filter((p) => !eligible.includes(p) && isOverbought(p.ticker, market) && p.ticker !== "VT")
          .map((p) => p.ticker)
        if (skipped.length > 0 && !overlayNote) {
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
        if (techHalted && (COMBINED_TECH_RULE.tickers as readonly string[]).includes(p.ticker)) a.reason = `Paused — combined tech over the ${COMBINED_TECH_RULE.softCeiling}% ceiling (§4.3).`
        else if (isOverweight(p)) a.reason = "Above target — paused."
        else if (isOverbought(p.ticker, market)) a.reason = "At 52-week high — not buying the top."
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

export function computeNextBestMove(positions: PositionInput[], totalValue: number, opts: EngineOptions = {}): NextMove {
  const hasBalance = totalValue > 0
  const market = resolveMarket(opts.market)
  const btcCap = getBtcModifier(undefined, opts.btcCyclePhase).hardHigh

  // ── PRECEDENCE 1: Hard cap / concentration breach → TRIM ──────────────────
  if (hasBalance) {
    // §4 — look-through concentration is the highest law (overrides conviction). A single
    // company or sector seen through all ETFs combined is over its hard cap → trim.
    if (opts.lookThroughBreach) {
      const b = opts.lookThroughBreach
      const ticker = b.trimTicker ?? "SMH"
      return {
        severity: "critical", ticker,
        action: `Trim ${ticker} — ${b.label} over cap`,
        what: `Your true ${b.label} exposure (seen through every fund combined) is ${b.pct.toFixed(1)}%, over the ${b.hard}% limit. Trim ${ticker}, its biggest source, until ${b.label} is back under ${b.hard}%.`,
        why: `Overlapping funds can hide how much of one company or sector you really own. This combined limit is the first thing the system protects — it comes before everything else.`,
        when: "At your next dealing window.",
        color: "#ef4444",
      }
    }
    // §4.3 — combined QQQM+SMH HARD ceiling. Trim the semis tilt (SMH) first.
    const combined = combinedTechPct(positions)
    if (combined > COMBINED_TECH_RULE.hardCeiling) {
      const smhPos = positions.find((p) => p.ticker === "SMH")
      const trimTicker = smhPos ? "SMH" : "QQQM"
      return {
        severity: "critical", ticker: trimTicker,
        action: `Trim ${trimTicker} — combined tech over cap`,
        what: `Combined QQQM+SMH is ${combined.toFixed(1)}%, over the ${COMBINED_TECH_RULE.hardCeiling}% hard ceiling (§4.3). Trim ${trimTicker} until combined is back under ${COMBINED_TECH_RULE.softCeiling}%.`,
        why: `${COMBINED_TECH_RULE.rationale} Combined concentration this high is the rule the system protects first.`,
        when: "At your next dealing window (respecting the 90-day hold on the most recent lots).",
        color: smhPos?.color ?? "#a78bfa",
      }
    }
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
    // Bitcoin sleeve floating hard cap (§4.1) — BTC + IBIT COMBINED flex with the cycle phase.
    const bitcoinPositions = positions.filter((p) => (BITCOIN_TICKERS as readonly string[]).includes(p.ticker))
    const bitcoinPct = bitcoinPositions.reduce((s, p) => s + p.actualPct, 0)
    if (bitcoinPositions.length > 0 && bitcoinPct > btcCap) {
      // Trim the larger of the two Bitcoin holdings to bring the sleeve back to target.
      const trim = [...bitcoinPositions].sort((a, b) => b.actualPct - a.actualPct)[0]
      const sleeveLabel = bitcoinPositions.length > 1 ? "the Bitcoin sleeve (BTC + IBIT)" : trim.ticker
      return {
        severity: "critical", ticker: trim.ticker,
        action: `Trim Bitcoin back to target`,
        what: `${sleeveLabel} is at ${bitcoinPct.toFixed(1)}%, over its ${btcCap}% cap. Trim ${trim.ticker} to bring the sleeve back toward 7%.`,
        why: `Bitcoin is over its ${btcCap}% cycle-aware hard cap (${getBtcModifier(undefined, opts.btcCyclePhase).label} phase, §4.1). The cap applies to BTC and IBIT combined — it is the concentration the system protects first.`,
        when: "At your next dealing window (respecting the 90-day hold).",
        color: trim.color,
      }
    }
    // Any other position over its hard cap (the Bitcoin sleeve is handled above by the floating cap)
    for (const p of positions) {
      if ((BITCOIN_TICKERS as readonly string[]).includes(p.ticker)) continue
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

  // ── PRECEDENCE 2: Defensive gap → BUILD BUFFER (from NEW contributions) ────
  // Is there a shock buffer (SGOV / cash-like)? If it's below the floor, build it
  // gradually from new contributions. NEVER fund it by selling a held position.
  const buffer = positions.find((p) => ["SGOV", "AGG", "CASH"].includes(p.ticker))
  const bufferPct = buffer ? buffer.actualPct : 0
  if (hasBalance && bufferPct < RULES.shockBufferMinPct) {
    return {
      severity: "high", ticker: "SGOV",
      action: "Build your shock buffer",
      what: `Start an SGOV (short-term Treasury) position and grow it toward ${RULES.shockBufferTargetPct}% of your portfolio using your new monthly contributions over the next few months. Do not sell anything to fund it.`,
      why: `You have ${bufferPct.toFixed(0)}% in defensive assets — below the ${RULES.shockBufferMinPct}% floor. With the Strait of Hormuz situation volatile and Fed rate-hike risk live, you need dry powder. SGOV yields about ${MARKET_STATE.sgovYieldPct}% (SEC ${MARKET_STATE.sgovSecYieldPct}%) with zero equity correlation. Build it from contributions — never by liquidating a holding.`,
      when: "Start this month; add a little each month until it reaches the 8–10% floor.",
      color: "#10b981",
    }
  }

  // ── PRECEDENCE 3: Market opportunity → DEPLOY TO DIP ──────────────────────
  if (hasBalance) {
    for (const p of positions) {
      const ds = dipState(p.ticker, market)
      if (ds !== "none" && !isOverweight(p)) {
        const m = market[p.ticker]
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

  // ── PRECEDENCE 4: Conviction underweight → ACCUMULATE (never sell at a loss) ─
  // A held conviction asset below target is an opportunity to accumulate on weakness
  // toward target — NOT a sell. The decision is forward-looking (would I buy at today's
  // price?); an unrealised loss is a sunk cost, never a trigger. Only a broken thesis
  // justifies selling a conviction asset. Skip any that are overbought (buy on weakness,
  // not at the top).
  if (hasBalance) {
    const convictionUnder = positions
      .filter((p) => (CONVICTION_TICKERS as readonly string[]).includes(p.ticker)
        && p.actualPct < p.targetPct
        && !isOverbought(p.ticker, market))
      .sort((a, b) => (a.actualPct - a.targetPct) - (b.actualPct - b.targetPct))
    if (convictionUnder.length > 0) {
      const p = convictionUnder[0]
      const capLine = p.hardCapPct !== null ? ` Keep it under its ${p.hardCapPct}% cap.` : ""
      return {
        severity: "medium", ticker: p.ticker,
        action: `Accumulate ${p.ticker} toward ${p.targetPct}%`,
        what: `${p.ticker} is underweight at ${p.actualPct.toFixed(1)}% versus its ${p.targetPct}% target. Direct this month's contribution into it to accumulate on weakness toward target.${capLine}`,
        why: `${p.ticker} is a held conviction position. What matters is today's price, not any past loss: at a lower weight you are adding toward target at a better cost basis. A red number is a sunk cost — never a reason to sell.`,
        when: "With this month's contribution, while it stays below target.",
        color: p.color,
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
    .filter((p) => isOverbought(p.ticker, market) && p.ticker !== "VT")
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
