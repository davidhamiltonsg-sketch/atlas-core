// ─────────────────────────────────────────────────────────────────────────────
// Atlas Core — Next Best Move Engine
//
// One engine. One answer. This computes the single highest-priority action across
// ALL signals — drift, market opportunity, market risk, and structural gaps — and
// returns it in plain English with a clear "what" and "why".
//
// It also produces a MARKET-AWARE DCA plan: the monthly contribution is not routed
// purely on drift. When a market opportunity (a confirmed dip in a quality
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
// Live market data is supplied at runtime from lib/finnhub (price + 52w levels).
// When unavailable, the engine runs with empty market overlay — skip rule applies
// conservatively (no positions near their 52w high unless live data confirms).
// ─────────────────────────────────────────────────────────────────────────────

import {
  getBtcModifier, COMBINED_TECH_RULE, HARD_THRESHOLDS, CRASH_DRAWDOWN_PCT,
  BITCOIN_TICKERS, BITCOIN_SLEEVE_TARGET_PCT, BITCOIN_RUNOFF_TICKER, BITCOIN_ACCUMULATION_TICKER,
  applyBitcoinSleeve,
  type BtcCyclePhase,
} from "@/lib/constants"
import { displayTicker } from "@/lib/approved-alternatives"

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


// ─── RULE CONSTANTS ──────────────────────────────────────────────────────────

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
export const CONVICTION_TICKERS = ["EQQQ", "SEMI", "BTC", "IBIT"] as const

// Re-exported from constants.ts — single source of truth for Bitcoin sleeve.
export { BITCOIN_TICKERS, BITCOIN_SLEEVE_TARGET_PCT, BITCOIN_RUNOFF_TICKER, BITCOIN_ACCUMULATION_TICKER, applyBitcoinSleeve }

// ─── LIVE MARKET OVERLAY (Finnhub, §F1) ──────────────────────────────────────
// A live overlay can replace price / 52-week levels for the recommendation logic.
// When absent (no Finnhub key, fetch failed), engine runs conservatively with no skip rule.
export interface LiveMarketPos { price: number; lo52: number; hi52: number; histVolPct: number }
export type EngineMarket = Record<string, LiveMarketPos>

export interface EngineOptions {
  /** Live price/52w/vol overlay per ticker (from lib/finnhub). Falls back to empty when unavailable. */
  market?: EngineMarket
  /** Current BTC halving-cycle phase, for the floating BTC hard cap (§4.1). */
  btcCyclePhase?: BtcCyclePhase
  /** Worst live §4 look-through breach (company/sector effective exposure over hard cap). */
  lookThroughBreach?: { label: string; pct: number; hard: number; trimTicker: string | null }
  /** Portfolio drawdown from its tracked peak (negative %, e.g. -22). For the slow-grind trigger (§1.2). */
  portfolioDrawdownPct?: number
  /** Days the drawdown has persisted (rules out a V-shaped bounce). */
  drawdownDays?: number
}

/** Return live market overlay. When absent, returns empty map (no stale fallback). */
function resolveMarket(override?: EngineMarket): EngineMarket {
  return override ?? {}
}

/** Combined EQQQ+SEMI exposure (§4.3) as a whole-number percent of NAV. */
export function combinedTechPct(positions: PositionInput[]): number {
  return positions
    .filter((p) => (COMBINED_TECH_RULE.tickers as readonly string[]).includes(p.ticker))
    .reduce((s, p) => s + p.actualPct, 0)
}

// ─── A SINGLE ACTION ─────────────────────────────────────────────────────────

export interface NextMove {
  severity: Severity
  ticker: string | null
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
//  • REDIRECTS the skipped money toward the lowest-volatility core (VWRA) or a
//    confirmed dip if one exists.
//  • Treats VWRA as always safe to accumulate (lowest vol, the 2045 anchor).
// ─────────────────────────────────────────────────────────────────────────────

export function computeMarketAwareDca(
  positions: PositionInput[],
  monthlyAmount: number,
  opts: EngineOptions = {}
): DcaPlan {
  const market = resolveMarket(opts.market)
  positions = applyBitcoinSleeve(positions) // BTC+IBIT as one sleeve (run-off vs accumulation)
  const ibitPresent = positions.some((p) => p.ticker === BITCOIN_ACCUMULATION_TICKER)
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

  // §4.3 — combined EQQQ+SEMI ceiling. At/above the soft ceiling, halt NEW buys of
  // both until combined falls back below it (concentration override on contributions).
  const combinedTech = combinedTechPct(positions)
  const techHalted = combinedTech >= COMBINED_TECH_RULE.softCeiling

  // Step 1 — decide who is eligible to receive money this month.
  // Eligible = under target AND not overbought. Underweight conviction holdings
  // (incl. BTC) ARE eligible — we accumulate on weakness toward target.
  const eligible = positions.filter((p) => {
    if (ibitPresent && p.ticker === BITCOIN_RUNOFF_TICKER) return false  // BTC is in run-off — new Bitcoin money goes to IBIT
    if (isOverweight(p)) return false                 // never feed an overweight position
    if (isOverbought(p.ticker, market) && p.ticker !== "VWRA") return false  // never buy the top (VWRA exempt — it's the anchor)
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
    overlayNote = `Combined EQQQ+SEMI is ${combinedTech.toFixed(1)}% — at/over the ${COMBINED_TECH_RULE.softCeiling}% tech-concentration ceiling (§4.3). New EQQQ and SEMI buys are paused this month; that money is redirected until combined falls below ${COMBINED_TECH_RULE.softCeiling - 2}%.`
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
    if (!overlayNote) overlayNote = `${displayTicker(dipTicker)} has dropped into a buy zone. Deploying 30% now (Tranche 1); hold the rest for Tranches 2–3 as the recovery confirms.`

    // Remaining money goes to the eligible set by target weight.
    const remaining = monthlyAmount - dipBudget
    distributeByWeight(eligible.filter((p) => p.ticker !== dipTicker), remaining, result, standard)
  } else {
    // NORMAL / DEFENSIVE MODE: route by target weight among eligible positions.
    if (eligible.length === 0) {
      // Everything is overbought or overweight — park in VWRA (the anchor) as the safe default.
      const vt = positions.find((p) => p.ticker === "VWRA")
      if (vt) {
        result["VWRA"].amount = monthlyAmount
        result["VWRA"].tag = "boosted"
        result["VWRA"].reason = `All growth positions are at highs — routing to VWRA, the lowest-volatility anchor, rather than chasing tops.`
        marketOverlayActive = true
        if (!overlayNote) overlayNote = `Every growth position is near its 52-week high. This month's money goes to VWRA instead of buying at the top.`
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
          .filter((p) => !eligible.includes(p) && isOverbought(p.ticker, market) && p.ticker !== "VWRA")
          .map((p) => p.ticker)
        if (skipped.length > 0 && !overlayNote) {
          overlayNote = `Skipping ${skipped.map(t => displayTicker(t)).join(" and ")} this month — ${skipped.length > 1 ? "they are" : "it is"} at a 52-week high. That money is redirected to positions with better entry points.`
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
        if (ibitPresent && p.ticker === BITCOIN_RUNOFF_TICKER) a.reason = "Held — transitioning into IBIT; new Bitcoin money goes to IBIT."
        else if (techHalted && (COMBINED_TECH_RULE.tickers as readonly string[]).includes(p.ticker)) a.reason = `Paused — combined tech over the ${COMBINED_TECH_RULE.softCeiling}% ceiling (§4.3).`
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
  positions = applyBitcoinSleeve(positions) // BTC+IBIT as one sleeve (run-off vs accumulation)
  const market = resolveMarket(opts.market)
  const btcCap = getBtcModifier(undefined, opts.btcCyclePhase).hardHigh

  // §4.3 — combined EQQQ+SEMI ceiling. At/above the soft ceiling, halt NEW buys of both
  // until combined falls back below it — same gate computeMarketAwareDca already applies,
  // so the headline recommendation never tells you to buy more of a paused position.
  const combinedTech = combinedTechPct(positions)
  const techHalted = combinedTech >= COMBINED_TECH_RULE.softCeiling
  const isTechHalted = (ticker: string) => techHalted && (COMBINED_TECH_RULE.tickers as readonly string[]).includes(ticker)

  // ── PRECEDENCE 1: Hard cap / concentration breach → TRIM ──────────────────
  if (hasBalance) {
    // §4 — look-through concentration is the highest law (overrides conviction). A single
    // company or sector seen through all ETFs combined is over its hard cap → trim.
    if (opts.lookThroughBreach) {
      const b = opts.lookThroughBreach
      const ticker = b.trimTicker ?? "SEMI"
      return {
        severity: "critical", ticker,
        action: `Trim ${ticker} — ${b.label} over cap`,
        what: `Your true ${b.label} exposure (seen through every fund combined) is ${b.pct.toFixed(1)}%, over the ${b.hard}% limit. Trim ${ticker}, its biggest source, until ${b.label} is back under ${b.hard}%.`,
        why: `Overlapping funds can hide how much of one company or sector you really own. This combined limit is the first thing the system protects — it comes before everything else.`,
        when: "At your next dealing window.",
        color: "#ef4444",
      }
    }
    // §4.3 — combined EQQQ+SEMI HARD ceiling. Trim the semis tilt (SEMI) first.
    if (combinedTech >= COMBINED_TECH_RULE.hardCeiling) {
      const semiPos = positions.find((p) => p.ticker === "SEMI")
      const trimTicker = semiPos ? "SEMI" : "EQQQ"
      return {
        severity: "critical", ticker: trimTicker,
        action: `Trim ${trimTicker} — combined tech over cap`,
        what: `Combined EQQQ+SEMI is ${combinedTech.toFixed(1)}%, over the ${COMBINED_TECH_RULE.hardCeiling}% hard ceiling (§4.3). Trim ${trimTicker} until combined is back under ${COMBINED_TECH_RULE.softCeiling}%.`,
        why: `${COMBINED_TECH_RULE.rationale} Combined concentration this high is the rule the system protects first.`,
        when: "At your next dealing window (respecting the 90-day hold on the most recent lots).",
        color: semiPos?.color ?? "#a78bfa",
      }
    }
    // SEMI concentration cap (12%) — the §4 override
    const smh = positions.find((p) => p.ticker === "SEMI")
    if (smh && smh.actualPct > RULES.smhConcentrationCapPct) {
      return {
        severity: "critical", ticker: "SEMI",
        action: "Trim SEMI back to 10%",
        what: `Sell enough SEMI to bring it from ${smh.actualPct.toFixed(1)}% down to about 10% of your portfolio.`,
        why: `SEMI is over its ${RULES.smhConcentrationCapPct}% hard cap. It is your single biggest risk — if it falls 25%, it would cost you more than every other position combined.`,
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
          action: `Trim ${displayTicker(p.ticker)} — over its cap`,
          what: `Sell enough ${displayTicker(p.ticker)} to bring it from ${p.actualPct.toFixed(1)}% back to its ${p.targetPct}% target.`,
          why: `${displayTicker(p.ticker)} has breached its ${p.hardCapPct}% hard cap. Concentration this high is the rule the system protects against first.`,
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
      why: `You have ${bufferPct.toFixed(0)}% in defensive assets — below the ${RULES.shockBufferMinPct}% floor. You need dry powder for market dislocations. SGOV provides short-term Treasury yield with zero equity correlation. Build it from contributions — never by liquidating a holding.`,
      when: "Start this month; add a little each month until it reaches the 8–10% floor.",
      color: "#10b981",
    }
  }

  // ── PRECEDENCE 2.3: Deep crash (≥25% drawdown) → A2 crash protocol ────────────
  // Art. XIV / Art. XXI A2: a sustained decline at or past the crash threshold. The
  // pre-committed response is to keep scheduled contributions running and NOT redesign —
  // the SAME instruction the Art. XIII ladder gives at its crash step, so the dashboard
  // (ladder) and the calendar (this engine) never disagree at deep drawdowns. Fires only
  // once the buffer is built (handled above), matching the ladder's step-5-before-step-6 order.
  if (hasBalance
      && opts.portfolioDrawdownPct !== undefined
      && opts.portfolioDrawdownPct <= CRASH_DRAWDOWN_PCT) {
    const pct = Math.abs(opts.portfolioDrawdownPct).toFixed(0)
    return {
      severity: "high", ticker: null,
      action: "Crash protocol — keep buying",
      what: `The portfolio is down ${pct}% from its high. Per pre-committed response A2, keep your scheduled contributions running unchanged and do not redesign. Sell nothing.`,
      why: `A sustained decline past ${Math.abs(CRASH_DRAWDOWN_PCT)}% triggers the crash protocol (Art. XIV). The 2022 rule: keep buying through a rate-driven bear market — never redesign at the bottom.`,
      when: "Continue contributions as normal until the drawdown clears.",
      color: "#10b981",
    }
  }

  // ── PRECEDENCE 2.4: Sharp policy shock → A1 (14-day wait, then tranches) ──────
  // Art. XXI A1: a sharp, recent drop from a discrete event (tariff/geopolitical/regulatory)
  // — proxied here as ≤ −10% over a short window (≤ ~21 days), distinct from the slow grind
  // below. The pre-committed response is to WAIT 14 calendar days, then deploy the SGOV
  // buffer 30/40/30 into the most beaten-down quality holding. Advisory only — sells nothing.
  if (hasBalance
      && opts.portfolioDrawdownPct !== undefined && opts.portfolioDrawdownPct <= -10
      && opts.portfolioDrawdownPct > -20
      && (opts.drawdownDays ?? 0) <= 21
      && bufferPct >= RULES.shockBufferMinPct) {
    const waiting = (opts.drawdownDays ?? 0) < 14
    let worst: { ticker: string; color: string; fromHigh: number } | null = null
    for (const p of positions) {
      if (["SGOV", "AGG", "CASH"].includes(p.ticker)) continue
      const m = market[p.ticker]
      if (!m || m.hi52 === 0) continue
      const fromHigh = ((m.price - m.hi52) / m.hi52) * 100
      if (!worst || fromHigh < worst.fromHigh) worst = { ticker: p.ticker, color: p.color, fromHigh }
    }
    const tk = worst?.ticker ?? "VWRA"
    return {
      severity: "high", ticker: tk,
      action: waiting ? "Policy shock — hold 14 days" : "Policy shock — deploy Tranche 1",
      what: waiting
        ? `The portfolio is down ${Math.abs(opts.portfolioDrawdownPct).toFixed(0)}% in a sharp, event-driven drop. Per pre-committed response A1, take NO action for 14 calendar days (day ${opts.drawdownDays ?? 0} of 14). Sell nothing. Keep scheduled contributions running.`
        : `The 14-day A1 cooling-off has elapsed. Deploy the SGOV buffer in three tranches (30% → 40% → 30%) into ${displayTicker(tk)}, the most beaten-down quality holding. Sell nothing.`,
      why: `A1 is written while calm: sharp shocks recover, and acting inside the first 14 days is where judgement fails. The buffer exists precisely to deploy into this — not to sit out the fear.`,
      when: waiting ? "Reassess after the 14-day window." : "At your next dealing window. Hold Tranches 2–3 for the recovery.",
      color: worst?.color ?? "#10b981",
    }
  }

  // ── PRECEDENCE 2.5: Slow-grind drawdown → DEPLOY tranche 1 (§1.2 condition 2) ──
  // A sustained fall (≥20% over ≥30 days) with no V-shaped bounce, when the buffer is
  // already built (≥ floor), deploys ONE tranche of SGOV into the most beaten-down quality
  // holding. Distinct from a sharp policy shock (A1) — this catches a grinding bear market.
  if (hasBalance
      && opts.portfolioDrawdownPct !== undefined && opts.portfolioDrawdownPct <= -20
      && (opts.drawdownDays ?? 0) >= 30
      && bufferPct >= RULES.shockBufferMinPct) {
    let worst: { ticker: string; color: string; fromHigh: number } | null = null
    for (const p of positions) {
      if (["SGOV", "AGG", "CASH"].includes(p.ticker)) continue
      const m = market[p.ticker]
      if (!m || m.hi52 === 0) continue
      const fromHigh = ((m.price - m.hi52) / m.hi52) * 100
      if (!worst || fromHigh < worst.fromHigh) worst = { ticker: p.ticker, color: p.color, fromHigh }
    }
    const tk = worst?.ticker ?? "VWRA"
    return {
      severity: "high", ticker: tk,
      action: "Deploy buffer — Tranche 1",
      what: `The portfolio is down ${Math.abs(opts.portfolioDrawdownPct).toFixed(0)}% over ${opts.drawdownDays}+ days — a slow grind, not a sudden shock. Deploy Tranche 1 (30% of SGOV) into ${displayTicker(tk)}, the most beaten-down quality holding. Hold the rest.`,
      why: `A sustained decline with no V-shaped bounce is the second buffer-deployment trigger (§1.2). Averaging in over tranches beats waiting for a bottom you can't time — and the buffer is what it's for.`,
      when: "At your next dealing window. Hold Tranches 2–3 for the recovery.",
      color: worst?.color ?? "#10b981",
    }
  }

  // ── PRECEDENCE 3: Market opportunity → DEPLOY TO DIP ──────────────────────
  if (hasBalance) {
    for (const p of positions) {
      const ds = dipState(p.ticker, market)
      if (ds !== "none" && !isOverweight(p) && !isTechHalted(p.ticker)) {
        const m = market[p.ticker]
        const fromHigh = (((m.price - m.hi52) / m.hi52) * 100).toFixed(0)
        return {
          severity: "high", ticker: p.ticker,
          action: `Buy the ${displayTicker(p.ticker)} dip`,
          what: `${displayTicker(p.ticker)} has dropped ${fromHigh}% from its high. Deploy Tranche 1 (30% of your intended ${displayTicker(p.ticker)} budget) now; hold Tranches 2 and 3 for the recovery.`,
          why: `A confirmed dip in a quality position is the best entry you get. Every prior ${displayTicker(p.ticker)} dip of this size in the last 5 years recovered to new highs.`,
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
        && !isOverbought(p.ticker, market)
        && !isTechHalted(p.ticker))
      .sort((a, b) => (a.actualPct - a.targetPct) - (b.actualPct - b.targetPct))
    if (convictionUnder.length > 0) {
      const p = convictionUnder[0]
      // Bitcoin sleeve: when the underweight conviction asset is IBIT, frame it as the sleeve
      // and make it explicit that new Bitcoin money goes to IBIT, not BTC (which is in run-off).
      if (p.ticker === BITCOIN_ACCUMULATION_TICKER) {
        const sleevePct = positions
          .filter((q) => (BITCOIN_TICKERS as readonly string[]).includes(q.ticker))
          .reduce((s, q) => s + q.actualPct, 0)
        return {
          severity: "medium", ticker: BITCOIN_ACCUMULATION_TICKER,
          action: "Add to Bitcoin via IBIT",
          what: `Your Bitcoin sleeve (BTC + IBIT) is ${sleevePct.toFixed(1)}% versus its ${BITCOIN_SLEEVE_TARGET_PCT}% target. Direct this month's Bitcoin contribution into IBIT — the tax-effective vehicle you're transitioning into — not BTC.`,
          why: `BTC and IBIT are one position (the same Bitcoin exposure). You're moving from BTC to IBIT like-for-like, so new money goes to IBIT while BTC runs off. A red number on BTC is a sunk cost — never a reason to sell.`,
          when: `With this month's contribution, while the sleeve stays below ${BITCOIN_SLEEVE_TARGET_PCT}%.`,
          color: p.color,
        }
      }
      const capLine = p.hardCapPct !== null ? ` Keep it under its ${p.hardCapPct}% cap.` : ""
      // Art. XXI A5: a conviction position ≥50% below its high triggers a documented
      // thesis review — a review, NOT a sell. Continue accumulating unless the structural
      // criteria are met. Surfaced as an advisory clause; it never flips the action to a sell.
      const mkt = market[p.ticker]
      const offHigh = mkt && mkt.hi52 > 0 ? ((mkt.price - mkt.hi52) / mkt.hi52) * 100 : 0
      const reviewLine = offHigh <= -50
        ? ` ${displayTicker(p.ticker)} is ${Math.abs(offHigh).toFixed(0)}% below its high — log a documented thesis review (Art. XXI A5): a review, not a sell. Keep accumulating unless the structural criteria are met.`
        : ""
      return {
        severity: "medium", ticker: p.ticker,
        action: `Accumulate ${displayTicker(p.ticker)} toward ${p.targetPct}%`,
        what: `${displayTicker(p.ticker)} is underweight at ${p.actualPct.toFixed(1)}% versus its ${p.targetPct}% target. Direct this month's contribution into it to accumulate on weakness toward target.${capLine}${reviewLine}`,
        why: `${displayTicker(p.ticker)} is a held conviction position. What matters is today's price, not any past loss: at a lower weight you are adding toward target at a better cost basis. A red number is a sunk cost — never a reason to sell.`,
        when: "With this month's contribution, while it stays below target.",
        color: p.color,
      }
    }
  }

  // ── PRECEDENCE 5: Hard drift underweight → FILL ───────────────────────────
  if (hasBalance) {
    const hardUnder = positions
      .filter((p) => {
        const ht = HARD_THRESHOLDS[p.ticker]
        return ht?.low !== undefined && p.actualPct < ht.low && !isTechHalted(p.ticker)
      })
      .sort((a, b) => (a.actualPct - a.targetPct) - (b.actualPct - b.targetPct))
    if (hardUnder.length > 0) {
      const p = hardUnder[0]
      return {
        severity: "medium", ticker: p.ticker,
        action: `Fill up ${displayTicker(p.ticker)}`,
        what: `Put all of this month's contribution into ${displayTicker(p.ticker)} until it is back near its ${p.targetPct}% target.`,
        why: `${displayTicker(p.ticker)} is well below target at ${p.actualPct.toFixed(1)}%. Filling the biggest gap first is how the engine keeps you balanced without selling.`,
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
        return drift < 0 && Math.abs(drift) > p.toleranceBand && !isTechHalted(p.ticker)
      })
      .sort((a, b) => (a.actualPct - a.targetPct) - (b.actualPct - b.targetPct))
    if (softUnder.length > 0) {
      const p = softUnder[0]
      return {
        severity: "low", ticker: p.ticker,
        action: `Lean into ${displayTicker(p.ticker)}`,
        what: `Direct this month's contribution toward ${displayTicker(p.ticker)} to nudge it back toward its ${p.targetPct}% target.`,
        why: `${displayTicker(p.ticker)} has drifted a little low at ${p.actualPct.toFixed(1)}%. A gentle redirect fixes it — no selling needed.`,
        when: "With this month's contribution.",
        color: p.color,
      }
    }
  }

  // ── PRECEDENCE 7: Healthy → STANDARD DCA ──────────────────────────────────
  // Even here we never leave the user guessing. We tell them what to do AND flag
  // if anything is overbought — or combined tech is paused — so they don't blindly
  // buy the top or wonder why EQQQ/SEMI weren't picked despite being underweight.
  if (techHalted) {
    return {
      severity: "low", ticker: null,
      action: "Do your DCA — but pause tech",
      what: `Invest your normal monthly amount, but skip EQQQ and SEMI this month. Combined EQQQ+SEMI is ${combinedTech.toFixed(1)}%, at/over the ${COMBINED_TECH_RULE.softCeiling}% tech-concentration ceiling (§4.3). Redirect their share to VWRA instead.`,
      why: `${COMBINED_TECH_RULE.rationale} New tech buys pause until combined falls back below ${COMBINED_TECH_RULE.softCeiling - 2}%.`,
      when: "This month, on your usual contribution date.",
      color: "#8b5cf6",
    }
  }

  const overboughtNames = positions
    .filter((p) => isOverbought(p.ticker, market) && p.ticker !== "VWRA")
    .map((p) => p.ticker)

  if (overboughtNames.length > 0) {
    return {
      severity: "low", ticker: overboughtNames[0],
      action: "Do your DCA — but skip the highs",
      what: `Invest your normal monthly amount, but skip ${overboughtNames.join(" and ")} this month (at 52-week highs) and put that share into VWRA instead.`,
      why: `Everything is healthy, but ${overboughtNames.join(" and ")} ${overboughtNames.length > 1 ? "are" : "is"} at the top of ${overboughtNames.length > 1 ? "their" : "its"} range. Buying VWRA instead avoids paying the highest price.`,
      when: "This month, on your usual contribution date.",
      color: "#8b5cf6",
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
