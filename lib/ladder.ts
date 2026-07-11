/**
 * Atlas Core — Art. XIII Decision Ladder (Constitution v1.5)
 *
 * The sole decision engine for Atlas Core. One function: computeLadder().
 * Walk the 8 steps in order, stop at the first that fires and return its instruction.
 *
 * Precedence rule (introduced in v1.1, unchanged through v1.5):
 *   Skip rule (B1 — don't buy within 3% of 52w high) applies at STEP 7 ONLY.
 *   At step 2 (underweight redirect), buy anyway and log an exception.
 *   Drift correction is law; entry timing is preference. Law wins.
 *
 * Source: public/atlas-core-constitution.html, Art. XIII + Art. XVIII precedence.
 */

import {
  COMBINED_TECH_RULE,
  CRASH_DRAWDOWN_PCT,
  HARD_THRESHOLDS,
  getBtcModifier,
  BITCOIN_TICKERS,
  BITCOIN_RUNOFF_TICKER,
  BITCOIN_ACCUMULATION_TICKER,
  BITCOIN_SLEEVE_TARGET_PCT,
  applyBitcoinSleeve,
  type BtcCyclePhase,
} from "@/lib/constitution"
import { displayTicker } from "@/lib/approved-alternatives"
import { ATLAS_CORE } from "@/lib/constitutions"
import { decidePortfolio } from "@/lib/portfolio-engine-v2"

// ─── Input types ─────────────────────────────────────────────────────────────

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

export interface LiveMarketPos {
  price: number
  lo52: number
  hi52: number
}

export interface LadderOptions {
  market?: Record<string, LiveMarketPos>
  btcCyclePhase?: BtcCyclePhase
  /** A hard look-through breach (Art. IX) — fires step 1. */
  lookThroughHardBreach?: {
    label: string    // e.g. "NVIDIA exposure"
    pct: number      // current effective %
    hard: number     // hard cap %
    trimTicker: string | null
  }
  /** A soft look-through approach (Art. IX) — fires step 4 warning, non-terminal. */
  lookThroughSoftWarning?: {
    label: string
    pct: number
    soft: number
  }
  /** Portfolio drawdown from tracked all-time high, as a negative number (e.g. -30). */
  portfolioDrawdownPct?: number
}

// ─── Output types ─────────────────────────────────────────────────────────────

export type StepStatus = "fired" | "passed" | "warning" | "not_reached"

export interface LadderStep {
  step: number
  label: string
  citation: string
  status: StepStatus
  /** Why this step fired or passed. */
  reason?: string
}

export interface LadderInstruction {
  firedStep: number           // 1–8; step 8 = healthy / close the app
  headline: string            // ≤6 words
  instruction: string         // one sentence, plain English, what to do
  rationale: string           // why — with the number that drives it
  when: string                // timing guidance
  ticker: string | null       // primary position to act on (null = portfolio-level)
  severity: "critical" | "high" | "medium" | "low" | "none"
  citation: string            // e.g. "Art. XIII Step 2"
  exceptions: string[]        // constitution exceptions logged this cycle
  steps: LadderStep[]
  /** true when step 7 or 8 fires — display terminal-state card ("close the app"). */
  isTerminal: boolean
}

// ─── Constants ────────────────────────────────────────────────────────────────

// Art. XIII B1: skip any position trading within this % of its 52-week high
const NEAR_HIGH_THRESHOLD = 0.03
// Art. XI: SGOV shock buffer floor
const SGOV_FLOOR_PCT = 8
// Art. XIII step 6: crash protocol trigger
const EQQQ_HARD_CAP = HARD_THRESHOLDS["EQQQ"]?.high ?? 30
const SEMI_HARD_CAP = HARD_THRESHOLDS["SEMI"]?.high ?? 12
// Tickers that are buffer assets (not target allocations)
const BUFFER_TICKERS = new Set(["SGOV", "AGG", "CASH"])

// ─── Helpers ─────────────────────────────────────────────────────────────────

function combinedTechPct(positions: PositionInput[]): number {
  return positions
    .filter((p) => (COMBINED_TECH_RULE.tickers as readonly string[]).includes(p.ticker))
    .reduce((s, p) => s + p.actualPct, 0)
}

function isNearHigh(ticker: string, market: Record<string, LiveMarketPos>): boolean {
  const m = market[ticker]
  if (!m || m.hi52 === 0) return false
  return m.price >= m.hi52 * (1 - NEAR_HIGH_THRESHOLD)
}

// ─── Main engine ─────────────────────────────────────────────────────────────

export function computeLadder(
  rawPositions: PositionInput[],
  totalValue: number,
  opts: LadderOptions = {}
): LadderInstruction {
  if (ATLAS_CORE.version === "2.2") {
    const decision = decidePortfolio(ATLAS_CORE, rawPositions)
    const m = decision.move
    const firedStep = decision.state === "transition" ? 1 : m.severity === "critical" ? 2 : m.severity === "medium" ? 3 : 4
    const labels = ["Legacy migration", "Hard limits", "Contribution routing", "Hold course"]
    const steps: LadderStep[] = labels.map((label, i) => ({
      step: i + 1,
      label,
      citation: `Constitution v2.2 · Article ${i + 3}`,
      status: i + 1 < firedStep ? "passed" : i + 1 === firedStep ? "fired" : "not_reached",
    }))
    return {
      firedStep,
      headline: m.action,
      instruction: m.what,
      rationale: m.why,
      when: m.when,
      ticker: m.ticker,
      severity: m.severity,
      citation: decision.state === "transition" ? "Constitution v2.2 · Migration protocol" : "Constitution v2.2 · Contribution and limits",
      exceptions: decision.legacyTickers.length ? [`Legacy positions: ${decision.legacyTickers.join(", ")}`] : [],
      steps,
      isTerminal: m.severity === "none",
    }
  }
  const hasBalance = totalValue > 0
  const positions   = applyBitcoinSleeve(rawPositions)
  const market      = opts.market ?? {}
  const btcMod      = getBtcModifier(undefined, opts.btcCyclePhase)
  const btcCap      = btcMod.hardHigh
  const exceptions: string[] = []

  // Step tracking — all start as not_reached
  const steps: LadderStep[] = [
    { step: 1, label: "Hard cap breach",        citation: "Art. VII / VIII / IX", status: "not_reached" },
    { step: 2, label: "Position underweight",    citation: "Art. VII",             status: "not_reached" },
    { step: 3, label: "Position overweight",     citation: "Art. VII",             status: "not_reached" },
    { step: 4, label: "Look-through soft limit", citation: "Art. IX",              status: "not_reached" },
    { step: 5, label: "Capital floor (SGOV)",    citation: "Art. XI",              status: "not_reached" },
    { step: 6, label: "Portfolio drawdown",      citation: "Art. XIV",             status: "not_reached" },
    { step: 7, label: "Standard DCA",            citation: "Art. XIII",            status: "not_reached" },
    { step: 8, label: "Terminal state",          citation: "Art. XIII Step 8",     status: "not_reached" },
  ]

  function pass(i: number, reason?: string) {
    steps[i - 1].status = "passed"
    if (reason) steps[i - 1].reason = reason
  }

  function build(
    step: number,
    r: { headline: string; instruction: string; rationale: string; when: string; ticker: string | null; severity: LadderInstruction["severity"]; citation: string },
    terminal = false,
  ): LadderInstruction {
    steps[step - 1].status = "fired"
    return { firedStep: step, ...r, exceptions, steps, isTerminal: terminal }
  }

  // Zero-balance: show welcome, don't fire any rule
  if (!hasBalance) {
    steps[7].status = "fired"
    return build(8, {
      headline: "Fund the portfolio",
      instruction: "Enter your holdings on the Portfolio page to get started.",
      rationale: "No portfolio balance recorded yet.",
      when: "Now.", ticker: null, severity: "none", citation: "Art. XIII Step 8",
    }, true)
  }

  // ── Step 1: Hard cap breach → TRIM IMMEDIATELY ─────────────────────────────
  // Covers (in precedence order per Art. XVIII): look-through hard breach, BTC sleeve,
  // SEMI hard cap, EQQQ hard cap, combined tech hard ceiling.
  // Step 1 fires → trim first, then proceed to step 8 (close the app).

  if (opts.lookThroughHardBreach) {
    const b = opts.lookThroughHardBreach
    const ticker = b.trimTicker ?? "SEMI"
    steps[0].reason = `Look-through ${b.label}: ${b.pct.toFixed(1)}% > hard cap ${b.hard}%`
    return build(1, {
      headline: `Trim ${ticker} — concentration`,
      instruction: `Look-through ${b.label} exposure is ${b.pct.toFixed(1)}% — over its ${b.hard}% hard cap. Trim ${ticker} until ${b.label} is back under ${b.hard}%.`,
      rationale: `Concentration seen through all funds combined (Art. IX). This is the highest-priority rule — concentration beats conviction.`,
      when: "This month's dealing window (3rd business day after the 15th).",
      ticker, severity: "critical", citation: "Art. XIII Step 1 / Art. IX",
    })
  }

  const btcPositions = positions.filter((p) => (BITCOIN_TICKERS as readonly string[]).includes(p.ticker))
  const btcPct = btcPositions.reduce((s, p) => s + p.actualPct, 0)
  if (btcPositions.length > 0 && btcPct > btcCap) {
    const trim = [...btcPositions].sort((a, b) => b.actualPct - a.actualPct)[0]
    steps[0].reason = `Bitcoin sleeve: ${btcPct.toFixed(1)}% > cycle cap ${btcCap}% (${btcMod.label})`
    return build(1, {
      headline: "Trim Bitcoin to cap",
      instruction: `The Bitcoin sleeve (BTC + IBIT combined) is at ${btcPct.toFixed(1)}%, over its ${btcCap}% cycle cap. Trim ${trim.ticker} to bring the sleeve back toward ${BITCOIN_SLEEVE_TARGET_PCT}%.`,
      rationale: `${btcMod.label} phase cycle cap: ${btcCap}% (Art. VIII). Hard cap applies to BTC and IBIT combined.`,
      when: "This month's dealing window. Respect the 90-day hold on recent lots.",
      ticker: trim.ticker, severity: "critical", citation: "Art. XIII Step 1 / Art. VIII",
    })
  }

  const semiPos = positions.find((p) => p.ticker === "SEMI")
  if (semiPos && semiPos.actualPct > SEMI_HARD_CAP) {
    steps[0].reason = `SEMI: ${semiPos.actualPct.toFixed(1)}% > ${SEMI_HARD_CAP}% hard cap`
    return build(1, {
      headline: "Trim SEMI — over cap",
      instruction: `SEMI is at ${semiPos.actualPct.toFixed(1)}%, over its ${SEMI_HARD_CAP}% hard cap. Trim to the ${semiPos.targetPct}% target.`,
      rationale: `SEMI hard cap ${SEMI_HARD_CAP}% (Art. VII). AI infrastructure tilt must never become the dominant portfolio risk.`,
      when: "This month's dealing window. Respect the 90-day hold on recent lots.",
      ticker: "SEMI", severity: "critical", citation: "Art. XIII Step 1 / Art. VII",
    })
  }

  const eqqqPos = positions.find((p) => p.ticker === "EQQQ")
  if (eqqqPos && eqqqPos.actualPct > EQQQ_HARD_CAP) {
    steps[0].reason = `EQQQ: ${eqqqPos.actualPct.toFixed(1)}% > ${EQQQ_HARD_CAP}% hard cap`
    return build(1, {
      headline: "Trim EQQQ — over cap",
      instruction: `EQQQ is at ${eqqqPos.actualPct.toFixed(1)}%, over its ${EQQQ_HARD_CAP}% hard cap. Trim back toward the ${eqqqPos.targetPct}% target.`,
      rationale: `EQQQ hard cap ${EQQQ_HARD_CAP}% (Art. VII). Digital economy engine must not dominate the portfolio.`,
      when: "This month's dealing window. Respect the 90-day hold on recent lots.",
      ticker: "EQQQ", severity: "critical", citation: "Art. XIII Step 1 / Art. VII",
    })
  }

  // §4.3 — combined EQQQ+SEMI ceiling. At/above the soft ceiling (below the hard ceiling
  // handled just below), new buys of both pause — steps 2/3 must not fill or redirect into
  // either while this holds, matching computeMarketAwareDca's same-name halt.
  const combined = combinedTechPct(positions)
  const techHalted = combined >= COMBINED_TECH_RULE.softCeiling
  const isTechHalted = (ticker: string) => techHalted && (COMBINED_TECH_RULE.tickers as readonly string[]).includes(ticker)
  if (combined >= COMBINED_TECH_RULE.hardCeiling) {
    const trimTicker = semiPos ? "SEMI" : "EQQQ"
    steps[0].reason = `EQQQ+SEMI combined: ${combined.toFixed(1)}% ≥ ${COMBINED_TECH_RULE.hardCeiling}% hard ceiling`
    return build(1, {
      headline: "Trim combined tech",
      instruction: `EQQQ+SEMI combined is ${combined.toFixed(1)}%, over the ${COMBINED_TECH_RULE.hardCeiling}% hard ceiling. Trim ${trimTicker} until combined falls below ${COMBINED_TECH_RULE.softCeiling}%.`,
      rationale: `Combined tech concentration (Art. IX). Overlapping semi exposure means individual caps understate real concentration risk.`,
      when: "This month's dealing window. Respect the 90-day hold on recent lots.",
      ticker: trimTicker, severity: "critical", citation: "Art. XIII Step 1 / Art. IX",
    })
  }

  // Every other single-position hard cap (VWRA 60%, VFEA 13% — Art. VII). SEMI, EQQQ, and the
  // Bitcoin sleeve are handled above; this catches any remaining position carrying a hard cap,
  // so a VWRA or VFEA breach triggers the mandated trim (Art. VII) instead of falling through to
  // the step-3 soft redirect. Uses the same per-position cap as computeNextBestMove, so the two
  // engines agree on which positions must be trimmed.
  const capBreach = positions
    .filter((p) =>
      p.hardCapPct != null &&
      !(BITCOIN_TICKERS as readonly string[]).includes(p.ticker) &&
      p.actualPct > p.hardCapPct,
    )
    .sort((a, b) => (b.actualPct - b.hardCapPct!) - (a.actualPct - a.hardCapPct!))[0]
  if (capBreach) {
    steps[0].reason = `${displayTicker(capBreach.ticker)}: ${capBreach.actualPct.toFixed(1)}% > ${capBreach.hardCapPct}% hard cap`
    return build(1, {
      headline: `Trim ${displayTicker(capBreach.ticker)} — over cap`,
      instruction: `${displayTicker(capBreach.ticker)} is at ${capBreach.actualPct.toFixed(1)}%, over its ${capBreach.hardCapPct}% hard cap. Trim back toward the ${capBreach.targetPct}% target.`,
      rationale: `${displayTicker(capBreach.ticker)} hard cap ${capBreach.hardCapPct}% (Art. VII). No single position may exceed its cap — concentration beats conviction.`,
      when: "This month's dealing window. Respect the 90-day hold on recent lots.",
      ticker: capBreach.ticker, severity: "critical", citation: "Art. XIII Step 1 / Art. VII",
    })
  }

  pass(1, "No hard cap breached")

  // ── Step 2: Any position below target → 100% to most underweight ────────────
  // Art. XIII v1.1 precedence rule: skip rule does NOT apply here.
  // If the most underweight position is near its 52w high, buy anyway — log an exception.
  const underweightsRaw = positions
    .filter((p) =>
      p.ticker !== BITCOIN_RUNOFF_TICKER &&     // BTC is in run-off: no buy pressure
      !BUFFER_TICKERS.has(p.ticker) &&          // SGOV/AGG/CASH: handled at step 5
      p.actualPct < p.targetPct                 // strictly below exact target
    )
    .sort((a, b) => (a.actualPct - a.targetPct) - (b.actualPct - b.targetPct))
  const pausedUnderweight = underweightsRaw.filter((p) => isTechHalted(p.ticker)).map((p) => p.ticker)
  if (pausedUnderweight.length > 0) {
    exceptions.push(
      `${pausedUnderweight.join(" and ")} underweight but paused at step 2 — combined EQQQ+SEMI is ${combined.toFixed(1)}% (§4.3 tech ceiling).`
    )
  }
  const underweights = underweightsRaw.filter((p) => !isTechHalted(p.ticker))

  if (underweights.length > 0) {
    const p = underweights[0]
    const atHigh = isNearHigh(p.ticker, market)
    if (atHigh) {
      exceptions.push(
        `Bought ${p.ticker} within 3% of 52-week high per step 2 — drift correction outranks entry timing (Art. XIII v1.1).`
      )
    }
    const gap = (p.targetPct - p.actualPct).toFixed(1)
    steps[1].reason = `${p.ticker}: ${p.actualPct.toFixed(1)}% vs ${p.targetPct}% target (−${gap}%)`

    // Bitcoin sleeve: frame as sleeve, explicit IBIT routing
    if (p.ticker === BITCOIN_ACCUMULATION_TICKER) {
      const sleeveGap = (BITCOIN_SLEEVE_TARGET_PCT - btcPct).toFixed(1)
      return build(2, {
        headline: "Add to Bitcoin via IBIT",
        instruction: `Direct this month's full contribution into IBIT. The Bitcoin sleeve (BTC + IBIT) is at ${btcPct.toFixed(1)}% — ${sleeveGap}% below its ${BITCOIN_SLEEVE_TARGET_PCT}% target. New Bitcoin money always flows to IBIT; BTC is in run-off.`,
        rationale: `Bitcoin sleeve underweight (Art. VIII). Step 2 — full contribution to most underweight position. BTC accumulates to IBIT like-for-like.`,
        when: "This month's contribution. Dealing window opens 3rd business day after the 15th.",
        ticker: BITCOIN_ACCUMULATION_TICKER, severity: "medium", citation: "Art. XIII Step 2",
      })
    }

    return build(2, {
      headline: `Fill ${p.ticker}`,
      instruction: `Direct this month's full contribution into ${p.ticker} — it is ${gap}% below its ${p.targetPct}% target.${atHigh ? " Position is near its 52-week high; buying anyway — drift correction outranks entry timing." : ""}`,
      rationale: `${p.ticker} underweight at ${p.actualPct.toFixed(1)}% (Art. VII Step 2). The skip rule does not apply at step 2.`,
      when: "This month's contribution. Dealing window opens 3rd business day after the 15th.",
      ticker: p.ticker, severity: "medium", citation: "Art. XIII Step 2",
    }, false)
  }

  pass(2, "All positions at or above target")

  // ── Step 3: Any position above comfortable range → redirect away ────────────
  // "Comfortable range" = target + toleranceBand (the soft upper bound).
  // Do not add to it. Redirect this month's contribution to the most at-risk position.
  const overweights = positions
    .filter((p) =>
      !BUFFER_TICKERS.has(p.ticker) &&
      !(BITCOIN_TICKERS as readonly string[]).includes(p.ticker) && // Bitcoin handled at step 1
      p.actualPct > p.targetPct + p.toleranceBand
    )
    .sort((a, b) => (b.actualPct - b.targetPct) - (a.actualPct - a.targetPct))

  if (overweights.length > 0) {
    const over = overweights[0]
    const overSet = new Set(overweights.map((p) => p.ticker))
    // Redirect target: position with smallest positive deviation (closest to needing money)
    const redirectTarget = positions
      .filter((p) => !overSet.has(p.ticker) && !BUFFER_TICKERS.has(p.ticker) && p.ticker !== BITCOIN_RUNOFF_TICKER && !isTechHalted(p.ticker))
      .sort((a, b) => (a.actualPct - a.targetPct) - (b.actualPct - b.targetPct))[0]
    const to = redirectTarget?.ticker ?? "VWRA"
    steps[2].reason = `${over.ticker}: ${over.actualPct.toFixed(1)}% > comfortable ceiling ${(over.targetPct + over.toleranceBand).toFixed(0)}%`

    return build(3, {
      headline: `Skip ${over.ticker}, buy ${to}`,
      instruction: `${over.ticker} is at ${over.actualPct.toFixed(1)}% — above its comfortable range. Don't add to it. Put this month's contribution into ${to} instead.`,
      rationale: `${over.ticker} overweight by ${(over.actualPct - over.targetPct).toFixed(1)}% (Art. VII). Never add to an overweight position.`,
      when: "This month's contribution. Dealing window opens 3rd business day after the 15th.",
      ticker: to, severity: "low", citation: "Art. XIII Step 3",
    })
  }

  pass(3, "No position above comfortable range")

  // ── Step 4: Look-through soft limit → schedule review, continue DCA ─────────
  // Non-terminal: logs a warning and exception, but does NOT stop the ladder.
  // The operator continues DCA normally while scheduling the review.
  if (opts.lookThroughSoftWarning) {
    const w = opts.lookThroughSoftWarning
    steps[3].status = "warning"
    steps[3].reason = `${w.label}: ${w.pct.toFixed(1)}% approaching soft limit ${w.soft}%`
    exceptions.push(
      `Look-through review required within 30 days: ${w.label} at ${w.pct.toFixed(1)}% approaching ${w.soft}% soft limit (Art. IX).`
    )
    // Fall through — continue to steps 5–7
  } else {
    pass(4, "No look-through soft warning")
  }

  // ── Step 5: SGOV below floor → build from contributions ────────────────────
  const sgovPos = positions.find((p) => BUFFER_TICKERS.has(p.ticker))
  const sgovPct = sgovPos?.actualPct ?? 0
  if (sgovPct < SGOV_FLOOR_PCT) {
    steps[4].reason = `SGOV: ${sgovPct.toFixed(1)}% < ${SGOV_FLOOR_PCT}% floor`
    return build(5, {
      headline: "Build shock buffer",
      instruction: `Direct this month's full contribution into SGOV until it reaches ${SGOV_FLOOR_PCT}% of the portfolio. Never sell anything to fund it — contributions only.`,
      rationale: `SGOV buffer at ${sgovPct.toFixed(1)}% — below the ${SGOV_FLOOR_PCT}% floor (Art. XI). Dry powder for the next policy shock.`,
      when: "This month's contribution, and every month until SGOV reaches 8%.",
      ticker: "SGOV", severity: "high", citation: "Art. XIII Step 5 / Art. XI",
    })
  }

  pass(5, `SGOV at ${sgovPct.toFixed(1)}% ≥ ${SGOV_FLOOR_PCT}% floor`)

  // ── Step 6: Portfolio drawdown > 25% from ATH → crash protocol ─────────────
  if (opts.portfolioDrawdownPct !== undefined && opts.portfolioDrawdownPct <= CRASH_DRAWDOWN_PCT) {
    const pct = Math.abs(opts.portfolioDrawdownPct).toFixed(0)
    steps[5].reason = `Portfolio down ${pct}% from all-time high`
    // If SGOV holds dry powder above the floor, deploy half of the excess into VWRA now.
    // This is the explicit deployment trigger the constitution lacked — SGOV must not
    // sit idle as a chronic drag when the market has already fallen 25%+.
    const sgovExcess = sgovPct - SGOV_FLOOR_PCT
    const sgovNote = sgovExcess > 0
      ? `SGOV has ${sgovPct.toFixed(1)}% — ${sgovExcess.toFixed(1)}% above the ${SGOV_FLOOR_PCT}% floor. Deploy 50% of that excess (about ${(sgovExcess / 2).toFixed(1)}% of portfolio) into VWRA immediately as pre-committed response A1. Then: `
      : `SGOV is at the ${SGOV_FLOOR_PCT}% floor — no excess to deploy. `
    return build(6, {
      headline: "Crash protocol — keep buying",
      instruction: `${sgovNote}Continue scheduled contributions unchanged into VWRA. Do not sell any position. Pre-committed response A2 applies.`,
      rationale: `Sustained decline over ${Math.abs(CRASH_DRAWDOWN_PCT)}% triggers Art. XIV crash protocol. SGOV dry powder deployed first (A1), then contributions continue (A2). The 2022 rule: keep buying during a rate-driven bear market — never redesign.`,
      when: "Deploy SGOV excess today if applicable. Continue contributions on the normal dealing window.",
      ticker: "VWRA", severity: "high", citation: "Art. XIII Step 6 / Art. XIV / Art. XI",
    })
  }

  pass(6, `Portfolio drawdown within threshold`)

  // ── Step 7: Standard DCA — skip any position near 52w high (VWRA exempt) ─────
  // Skip rule applies HERE ONLY (Art. XIII v1.1). Redirect skipped money to VWRA.
  const skipped = positions
    .filter((p) =>
      p.ticker !== "VWRA" &&
      p.ticker !== BITCOIN_RUNOFF_TICKER &&
      !BUFFER_TICKERS.has(p.ticker) &&
      isNearHigh(p.ticker, market)
    )
    .map((p) => p.ticker)

  if (skipped.length > 0) {
    exceptions.push(
      `Skip rule (B1) fired at step 7: ${skipped.join(", ")} within 3% of 52-week high — redirected to VWRA.`
    )
    steps[6].reason = `Skip: ${skipped.join(", ")} near 52w high → VWRA`
    return build(7, {
      headline: `DCA — skip ${skipped.join("/")}`,
      instruction: `Standard monthly investment, but skip ${skipped.join(" and ")} (near 52-week high). Redirect their share to VWRA. All other positions receive their normal target-weight split.`,
      rationale: `B1 skip rule (Art. XIII): ${skipped.join(" and ")} within 3% of 52w high. VWRA is the sole exempt position — accumulate it continuously regardless of price.`,
      when: "Dealing window: 3rd business day after the 15th through month-end.",
      ticker: "VWRA", severity: "low", citation: "Art. XIII Step 7 / B1",
    }, true)
  }

  steps[6].reason = "All positions within band — healthy"
  return build(7, {
    headline: "Standard DCA",
    instruction: `Invest this month's contribution at target weights: VWRA 54% · EQQQ 23% · SEMI 10% · VFEA 8% · Bitcoin sleeve 5%. Split by those proportions and round to nearest whole unit.`,
    rationale: "All positions healthy and within their bands (Art. XIII Step 7). Discipline beats tinkering — stay the course.",
    when: "Dealing window: 3rd business day after the 15th through month-end.",
    ticker: null, severity: "none", citation: "Art. XIII Step 7",
  }, true)
}
