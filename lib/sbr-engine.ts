// ─────────────────────────────────────────────────────────────────────────────
// Silicon Brick Road — Decision Engine (Constitution v2.3, Article VI).
//
// Migration pillar 3 ("one engine per portfolio, parameterized") — Increment 5b.
// Both the headline instruction (computeSbrNextMove) and the money-split
// (computeSbrDca) now derive their routing from sbrRoute(), which implements the
// Art. VI priority ladder exactly once. The two output functions are views of one
// computation; they can't silently disagree on which branch fired.
//
// Priority (highest wins): SEMI cap → A35 floor → equity ceiling (92%) → phase (III/IV) →
// combined ceiling → drawdown → underweight → skip-at-high → standard split.
// A35 floor precedes combined ceiling: a depleted safety buffer is the most urgent risk.
// Underweight outranks skip-at-high — a below-range fund is bought even near its yearly high.
// ─────────────────────────────────────────────────────────────────────────────

import type { NextMove, DcaPlan, DcaAllocation } from "@/lib/next-best-move"
import { SILICON_BRICK_ROAD, type Constitution, type ConstitutionPhase } from "@/lib/constitutions"
import { SBR_PHASE_CAPS, A35_LOT_SIZE } from "@/lib/portfolio-spec"

export interface SbrPosition {
  ticker: string
  name: string
  color: string
  value: number
  actualPct: number
  targetPct: number
  rangeLow: number
  rangeHigh: number
  hardCap: number | null
  floor?: number
  latestPrice: number
  hi52: number // 52-week high (0 if unknown, e.g. A35 on SGX)
}

export interface SbrEngineOpts {
  /** Portfolio drawdown from its month-end peak (negative %, e.g. -18). */
  drawdownPct?: number
}

// Sourced from the constitution registry (Art. VII) — never a separate literal, so the
// engine's floor can't silently drift from the documented/contract-checked value.
const A35_FLOOR = SILICON_BRICK_ROAD.funds.find((f) => f.ticker === "A35")?.floor ?? 7

export function getPhaseCaps(phaseKey: string): typeof SBR_PHASE_CAPS[keyof typeof SBR_PHASE_CAPS] {
  return SBR_PHASE_CAPS[phaseKey as keyof typeof SBR_PHASE_CAPS] ?? SBR_PHASE_CAPS.I
}

export function sbrPhase(totalValue: number, c: Constitution = SILICON_BRICK_ROAD): ConstitutionPhase {
  const phases = c.phases ?? []
  for (const p of phases) {
    if (totalValue >= p.min && (p.max === null || totalValue < p.max)) return p
  }
  return phases[0]
}

// Fund colours come from the registry so a palette rebrand never needs an engine edit.
function fundColor(c: Constitution, ticker: string): string {
  return c.funds.find((f) => f.ticker === ticker)?.color ?? "#64748b"
}

function pctFromHigh(p: SbrPosition): number | null {
  if (p.hi52 <= 0 || p.latestPrice <= 0) return null
  return ((p.latestPrice - p.hi52) / p.hi52) * 100
}
function nearHigh(p: SbrPosition, skipPct: number): boolean {
  const f = pctFromHigh(p)
  return f !== null && f >= -skipPct
}

// ─── Shared routing core ─────────────────────────────────────────────────────
// The Art. VI priority ladder lives here once. Both computeSbrNextMove and
// computeSbrDca switch on the returned branch tag to produce their own output.
// Changing the routing always changes both views simultaneously.

export type SbrBranch =
  | { tag: "empty" }
  | { tag: "smh_cap";        smhPct: number; smhHard: number; sellSgd: number }
  | { tag: "combined_hard";  combined: number; combinedHard: number; resume: number }
  | { tag: "combined_warn";  combined: number; warning: number; resume: number }
  | { tag: "a35_floor";      a35Pct: number }
  | { tag: "equity_ceiling"; equityPct: number }
  | { tag: "phase_III_entry"; totalValue: number }
  | { tag: "phase_III";      totalValue: number; eqqqSell: number; vwraSell: number }
  | { tag: "phase_IV";       totalValue: number }
  | { tag: "drawdown";       drawdownPct: number }
  | { tag: "underweight";    fund: SbrPosition; nearItsHigh: boolean }
  | { tag: "skip_at_high";   skipped: string[] }
  | { tag: "standard";       phase: ConstitutionPhase }

export function sbrRoute(
  positions: SbrPosition[],
  totalValue: number,
  opts: SbrEngineOpts = {},
  c: Constitution = SILICON_BRICK_ROAD,
): SbrBranch {
  if (totalValue <= 0) return { tag: "empty" }

  const get = (t: string) => positions.find((p) => p.ticker === t)
  const semi = get("SEMI"), eqqq = get("EQQQ"), a35 = get("A35")
  const combined = (eqqq?.actualPct ?? 0) + (semi?.actualPct ?? 0)

  // Phase and its caps must be determined early — both the mandatory-sell threshold
  // and the precedence logic (Phase III/IV beat combined ceiling) depend on it.
  const phase = sbrPhase(totalValue, c)
  const phaseCaps = getPhaseCaps(phase.key)

  // 1 — SEMI over its phase-dependent hard cap → mandatory sell (always highest priority)
  if (semi && semi.actualPct > phaseCaps.smhHard) {
    const semiTarget = c.funds.find(f => f.ticker === "SEMI")?.target ?? 15
    return { tag: "smh_cap", smhPct: semi.actualPct, smhHard: phaseCaps.smhHard, sellSgd: Math.round(((semi.actualPct - semiTarget) / 100) * totalValue) }
  }

  // 2 — A35 below its floor → build safety before any phase or ceiling check
  if (a35 && a35.actualPct < A35_FLOOR) return { tag: "a35_floor", a35Pct: a35.actualPct }

  // 3 — Total equity over 92% → redirect contributions to A35 (constitution Art. "Stock market maximum")
  // Fires when VWRA + EQQQ + SEMI exceed the ceiling and a35_floor is already satisfied.
  const vwra = get("VWRA")
  const equityPct = (vwra?.actualPct ?? 0) + (eqqq?.actualPct ?? 0) + (semi?.actualPct ?? 0)
  if (equityPct > (c.totalEquityMaxPct ?? 92)) return { tag: "equity_ceiling", equityPct }

  // 4 — Phase III/IV: close-to-goal rules take priority over combined ceiling checks.
  // Routing to A35 is strictly more conservative than the ceiling's VWRA redirect, so the
  // phase instruction wins. (The combined ceiling still fires in Phase I/II below.)
  // Phase III is split: below SGD 102k redirect contributions only; at 102k+ add quarterly sells.
  // The gate prevents unnecessary selling if the portfolio briefly crosses 96k on volatility.
  if (phase.key === "III") {
    if (totalValue < 102_000) return { tag: "phase_III_entry", totalValue }
    return { tag: "phase_III", totalValue, eqqqSell: Math.round(0.03 * totalValue), vwraSell: Math.round(0.02 * totalValue) }
  }
  if (phase.key === "IV") return { tag: "phase_IV", totalValue }

  // 5 — combined ceiling checks (Phase I/II only — Phase III/IV were handled above)
  if (combined > phaseCaps.combinedHard) return { tag: "combined_hard", combined, combinedHard: phaseCaps.combinedHard, resume: phaseCaps.combinedResume }
  if (combined >= phaseCaps.combinedWarning) return { tag: "combined_warn", combined, warning: phaseCaps.combinedWarning, resume: phaseCaps.combinedResume }

  // 5 — drawdown past trigger → deploy cash reserve, then all new money to VWRA
  if (opts.drawdownPct !== undefined && opts.drawdownPct <= -(c.drawdownTriggerPct ?? 15)) {
    return { tag: "drawdown", drawdownPct: opts.drawdownPct }
  }

  // 6 — underweight fund (drift correction beats skip-at-high)
  const under = positions
    .filter((p) => p.actualPct < p.rangeLow)
    .sort((a, b) => (a.actualPct - a.rangeLow) - (b.actualPct - b.rangeLow))
  if (under.length > 0) {
    const p = under[0]
    return { tag: "underweight", fund: p, nearItsHigh: nearHigh(p, c.skipAtHighPct) }
  }

  // 7 — EQQQ or SEMI in range but within 3% of 52-week high → skip, redirect to VWRA
  const skipped = [eqqq, semi]
    .filter((p): p is SbrPosition => !!p && nearHigh(p, c.skipAtHighPct))
    .map((p) => p.ticker)
  if (skipped.length > 0) return { tag: "skip_at_high", skipped }

  // 8 — standard proportional split at phase targets
  return { tag: "standard", phase }
}

// ─── The single Next Best Move ───────────────────────────────────────────────
export function computeSbrNextMove(
  positions: SbrPosition[],
  totalValue: number,
  opts: SbrEngineOpts = {},
  c: Constitution = SILICON_BRICK_ROAD,
): NextMove {
  const branch = sbrRoute(positions, totalValue, opts, c)

  switch (branch.tag) {
    case "empty":
      return { severity: "none", ticker: "VWRA", action: "Make your first contribution",
        what: `Invest this month's SGD ${c.monthlyContribution.toLocaleString()} at the target split: VWRA 50% · EQQQ 25% · SEMI 15% · A35 10%.`,
        why: "The portfolio is empty. The first step is to start — monthly contributions are the most powerful thing you can do.",
        when: "Anytime this month.", color: fundColor(c, "VWRA") }

    case "smh_cap":
      return { severity: "critical", ticker: "SEMI", action: "Sell SEMI back to 15%",
        what: `SEMI is ${branch.smhPct.toFixed(1)}% of the portfolio — above its ${branch.smhHard}% phase cap. Sell about SGD ${branch.sellSgd.toLocaleString()} of SEMI this month to bring it back to 15%.`,
        why: "This is the only time you are required to sell. Semiconductor stocks can fall 30–40% in a bad year; this limit protects you from that kind of concentrated loss. The cap tightens as you near the goal to reduce sequencing risk.",
        when: "This month, before buying anything else.", color: "#f87171" }

    case "combined_hard":
      return { severity: "critical", ticker: "VWRA", action: `Stop buying EQQQ and SEMI — they are over ${branch.combinedHard}% together`,
        what: `EQQQ + SEMI combined is ${branch.combined.toFixed(1)}% — above the ${branch.combinedHard}% hard limit for this phase. Put all new money into VWRA until they drop below ${branch.resume}% combined.`,
        why: "EQQQ and SEMI both hold a lot of the same tech companies, so together they concentrate your risk. The ceiling tightens as the portfolio matures to protect your goal.",
        when: `Every month until the combined share drops below ${branch.resume}%.`, color: fundColor(c, "VWRA") }

    case "combined_warn":
      return { severity: "medium", ticker: "VWRA", action: "Tech funds are getting heavy — buy VWRA only this month",
        what: `EQQQ + SEMI are ${branch.combined.toFixed(1)}% together — past the ${branch.warning}% warning level. Skip both this month and put all new money into VWRA instead.`,
        why: `When tech stocks get heavy, buying global stocks (VWRA) keeps the balance. You can return to EQQQ and SEMI when they drop below ${branch.resume}% combined.`,
        when: "This month.", color: fundColor(c, "VWRA") }

    case "a35_floor":
      return { severity: "high", ticker: "A35", action: "Top up A35 — the safety buffer is low",
        what: `A35 is ${branch.a35Pct.toFixed(1)}% — below its minimum 7%. Put all this month's money into A35 until it is back above 8%.`,
        why: "A35 (Singapore bonds, in SGD) is your safety net. Keeping it topped up means you always have stable local-currency savings to fall back on.",
        when: "This month, until A35 is above 8%.", color: fundColor(c, "A35") }

    case "equity_ceiling":
      return { severity: "medium", ticker: "A35", action: `Stocks are over ${c.totalEquityMaxPct ?? 92}% — redirect to A35 this month`,
        what: `VWRA, EQQQ and SEMI together are ${branch.equityPct.toFixed(1)}% of the portfolio — above the ${c.totalEquityMaxPct ?? 92}% maximum. Put all new contributions into A35 this month until equities drift back below ${c.totalEquityMaxPct ?? 92}%.`,
        why: "The plan caps stock exposure at 92% to ensure you always hold some stable SGD bonds. When stocks drift too high, redirecting new money naturally corrects the balance over time — no selling needed.",
        when: `This month. Resume the normal split once equities drop back below ${c.totalEquityMaxPct ?? 92}%.`, color: fundColor(c, "A35") }

    case "phase_III_entry": {
      const gap = Math.round(102_000 - branch.totalValue)
      return { severity: "medium", ticker: "A35", action: "Phase III — put new money into A35",
        what: `You're in Phase III. Put all new monthly contributions into A35. Quarterly equity sells (3% of EQQQ + 2% of VWRA → A35) start at S$102,000 — about S$${gap.toLocaleString()} away. No selling needed yet.`,
        why: "You've crossed into Phase III, so new money moves to safety. The quarterly sells wait until you're solidly past the midpoint — this avoids unnecessary selling if markets briefly dip and pull the portfolio back below S$96k.",
        when: `This month and every month until you reach S$102,000.`, color: fundColor(c, "A35") }
    }

    case "phase_III": {
      const remaining = Math.round((c.targetValue ?? 120000) - branch.totalValue)
      return { severity: "high", ticker: "A35", action: "Phase III — start shifting money to safety",
        what: `Once this quarter, sell about SGD ${branch.eqqqSell.toLocaleString()} of EQQQ (3% of the portfolio) and SGD ${branch.vwraSell.toLocaleString()} of VWRA (2%), and move the SGD ${(branch.eqqqSell + branch.vwraSell).toLocaleString()} into A35. Continue putting all new monthly contributions into A35 too. Leave SEMI untouched for now — it stays put through Phase III and is the first fund you sell when you buy the property.`,
        why: `You are in Phase III — about S$${remaining.toLocaleString()} away from your goal. Gradually moving to bonds now protects those gains if markets fall at the worst time.`,
        when: "On your next monthly window. Repeat each quarter until you reach Phase IV.", color: fundColor(c, "A35") }
    }

    case "phase_IV":
      return { severity: "high", ticker: "A35", action: "Phase IV — stop buying stocks, everything to A35",
        what: "Stop buying any stocks this month. Every new contribution goes into A35. Start making a timeline for the property purchase — the money should be ready to move within 60 days of deciding.",
        why: `You are in Phase IV — above S$114,000 and close to your goal. Building up SGD cash now means you will not be forced to sell stocks at a bad time when you need the deposit.`,
        when: "Now, and every month until you buy.", color: fundColor(c, "A35") }

    case "drawdown":
      return { severity: "high", ticker: "VWRA", action: "Markets are down — deploy your reserve into VWRA",
        what: `The portfolio is down ${Math.abs(branch.drawdownPct).toFixed(0)}% from its recent high. First deploy your small cash reserve into VWRA, then put the full monthly contribution into VWRA too. Do not sell anything.`,
        why: "A falling market is a buying opportunity early in the journey. The cash reserve is spare cash kept for exactly this — deploying it (plus contributions) into the most diversified fund is one of the best things you can do.",
        when: "This month.", color: fundColor(c, "VWRA") }

    case "underweight": {
      const p = branch.fund
      return { severity: "medium", ticker: p.ticker, action: `${p.ticker} is below its range — fill it up`,
        what: `${p.ticker} is ${p.actualPct.toFixed(1)}% — below its ${p.rangeLow}% target range. Put the full monthly contribution into ${p.ticker} until it is back in range${branch.nearItsHigh ? ", even though it is near its yearly high" : ""}.`,
        why: "When something drifts low, new money fixes it — no selling needed. Getting a fund back into its range matters more than waiting for a better price, so this comes before the skip-the-highs rule.",
        when: "This month.", color: p.color }
    }

    case "skip_at_high":
      return { severity: "low", ticker: branch.skipped[0], action: `Skip ${branch.skipped.join(" & ")} this month — near its yearly high`,
        what: `Invest normally, but skip ${branch.skipped.join(" and ")} this month (it is within 3% of its highest price this year, and already in range). Put that money into VWRA instead.`,
        why: "Buying something at almost its highest-ever price is a fast way to feel instant regret if it dips next week. VWRA has no such restriction — you buy it no matter what.",
        when: "This month.", color: fundColor(c, "VWRA") }

    case "standard": {
      const splitTargets = branch.phase.targets ?? Object.fromEntries(c.funds.map((f) => [f.ticker, f.target]))
      const splitStr = c.funds.map((f) => `${f.ticker} ${splitTargets[f.ticker] ?? f.target}%`).join(" · ")
      return { severity: "none", ticker: "ALL", action: "All good — invest at the standard split",
        what: `Split this month's contribution at the target weights: ${splitStr}. Everything is in range.`,
        why: "Every fund is within its comfortable range and none are at their limits. Nothing to fix — just keep the habit going.",
        when: "Anytime this month.", color: fundColor(c, "A35") }
    }
  }
}

// ─── SBR Portfolio Health Score ──────────────────────────────────────────────
// Implements the constitution's own 6-category scorecard (Article XIX) instead of
// the Atlas Core 4-dimension engine which was designed for a different policy.

export interface SbrHealth {
  overall: number
  overallLabel: "Good standing" | "Review recommended" | "Action required"
  governance: number     // 25% — decision steps followed, no unauthorised trades
  risk: number           // 20% — SEMI cap, combined ceiling, no breaches
  allocation: number     // 15% — all funds within comfortable ranges
  contribution: number   // 15% — monthly investing discipline (proxy: snapshot freshness)
  behavioural: number    // 10% — discipline proxy: penalised by uncorrected breaches + lapsed contributions
  liquidity: number      // 10% — A35 above 7% floor, emergency fund maintained
  documentation: number  // 5%  — data-currency proxy for a kept-up-to-date trade log / journal
}

export function computeSbrHealth(
  positions: SbrPosition[],
  totalValue: number,
  snapshotAgeDays: number,
  c: Constitution = SILICON_BRICK_ROAD,
): SbrHealth {
  if (totalValue <= 0) {
    return { overall: 0, overallLabel: "Action required", governance: 0, risk: 0, allocation: 0, contribution: 0, behavioural: 0, liquidity: 0, documentation: 0 }
  }

  const semi = positions.find(p => p.ticker === "SEMI")
  const a35 = positions.find(p => p.ticker === "A35")
  const comb = c.combined!
  const combinedPct = positions.filter(p => comb.tickers.includes(p.ticker)).reduce((s, p) => s + p.actualPct, 0)
  const phaseCaps = getPhaseCaps(sbrPhase(totalValue, c).key)

  // Risk (20%): SEMI cap and combined ceiling compliance — using phase-dependent thresholds
  const semiBreach  = (semi?.actualPct ?? 0) > phaseCaps.smhHard
  const combBreach = combinedPct > phaseCaps.combinedHard
  const combWarn   = !combBreach && combinedPct >= phaseCaps.combinedWarning
  const risk = Math.max(0, 100 - (semiBreach ? 40 : 0) - (combBreach ? 30 : 0) - (combWarn ? 10 : 0))

  // Allocation (15%): funds within comfortable ranges
  const outOfRange = positions.filter(p => p.actualPct < p.rangeLow || p.actualPct > p.rangeHigh)
  const allocation = Math.max(0, 100 - outOfRange.length * 20)

  // Liquidity (10%): A35 above 7% floor
  const a35Pct = a35?.actualPct ?? 0
  const liquidity = a35Pct >= 8 ? 100 : a35Pct >= 7 ? 80 : a35Pct >= 5 ? 50 : 20

  // Governance (25%): no breaches = full score; each hard breach costs 30pts, soft costs 10pts
  const hardBreaches = (semiBreach ? 1 : 0) + (combBreach ? 1 : 0)
  const softBreaches = combWarn || outOfRange.length > 0 ? 1 : 0
  const governance = Math.max(0, 100 - hardBreaches * 30 - softBreaches * 10)

  // Contribution (15%): proxy via snapshot freshness — monthly investing discipline
  const contribution = snapshotAgeDays <= 35 ? 100 : snapshotAgeDays <= 65 ? 70 : 40

  // Behavioural (10%): discipline proxy from real state — an uncorrected hard breach or a
  // fund left outside its range signals rules not being followed; lapsed contributions (stale
  // data) signal the monthly habit slipping. No longer a flat 100 that inflates the score.
  const behavioural = Math.max(0, 100
    - (hardBreaches ? 25 : 0)
    - (softBreaches ? 10 : 0)
    - (snapshotAgeDays > 65 ? 20 : snapshotAgeDays > 35 ? 8 : 0))

  // Documentation (5%): proxy from data currency — a portfolio kept up to date is documented.
  const documentation = snapshotAgeDays <= 35 ? 100 : snapshotAgeDays <= 65 ? 80 : 50

  // Weighted composite — constitution scorecard (Article XIX):
  // governance 25%, risk 20%, allocation 15%, contribution 15%, behavioural 10%, liquidity 10%, documentation 5%
  const overall = Math.round(
    governance    * 0.25 +
    risk          * 0.20 +
    allocation    * 0.15 +
    contribution  * 0.15 +
    behavioural   * 0.10 +
    liquidity     * 0.10 +
    documentation * 0.05
  )

  const overallLabel: SbrHealth["overallLabel"] =
    overall >= 80 ? "Good standing" : overall >= 65 ? "Review recommended" : "Action required"

  return { overall, overallLabel, governance, risk, allocation, contribution, behavioural, liquidity, documentation }
}

// ─── Market-aware monthly split ──────────────────────────────────────────────
export function computeSbrDca(
  positions: SbrPosition[],
  monthly: number,
  opts: SbrEngineOpts = {},
  c: Constitution = SILICON_BRICK_ROAD,
): DcaPlan {
  const alloc: Record<string, DcaAllocation> = {}
  const phase = sbrPhase(Math.max(0, positions.reduce((s, p) => s + p.value, 0)), c)
  const targets = phase.targets ?? Object.fromEntries(c.funds.map((f) => [f.ticker, f.target]))
  for (const p of positions) {
    alloc[p.ticker] = { ticker: p.ticker, name: p.name, color: p.color, amount: 0,
      standardAmount: Math.round(((targets[p.ticker] ?? p.targetPct) / 100 * monthly) / 10) * 10, tag: "zeroed", reason: "" }
  }
  if (monthly <= 0 || positions.length === 0) {
    return { allocations: Object.values(alloc), headline: "No contribution to deploy.", marketOverlayActive: false, overlayNote: null }
  }

  const round10 = (n: number) => Math.round(n / 10) * 10

  function allToOne(ticker: string, reason: string, note: string): DcaPlan {
    const target = alloc[ticker] ? ticker : (alloc["VWRA"] ? "VWRA" : positions[0]?.ticker)
    if (!target || !alloc[target]) {
      return { allocations: Object.values(alloc), headline: "No eligible fund to route to.", marketOverlayActive: false, overlayNote: note }
    }
    alloc[target].amount = monthly
    alloc[target].tag = "boosted"
    alloc[target].reason = reason
    for (const p of positions) if (p.ticker !== target && !alloc[p.ticker].reason) alloc[p.ticker].reason = "Paused this month."
    return { allocations: Object.values(alloc), headline: "Directed plan — one fund this month", marketOverlayActive: true, overlayNote: note }
  }

  // Use the shared routing core — only the DCA-relevant directed branches route all money to one fund.
  // "smh_cap" is headline-only (sell instruction); DCA falls through to the proportional split
  // but naturally excludes SEMI from new buying since it's above its range.
  const totalValue = positions.reduce((s, p) => s + p.value, 0)
  const branch = sbrRoute(positions, totalValue, opts, c)

  switch (branch.tag) {
    case "empty":
      return { allocations: Object.values(alloc), headline: "No contribution to deploy.", marketOverlayActive: false, overlayNote: null }

    case "combined_hard":
      return allToOne("VWRA", "Combined EQQQ+SEMI over hard limit — halt both, buy VWRA.", `EQQQ + SEMI combined is ${branch.combined.toFixed(1)}% — over the ${branch.combinedHard}% hard limit. All new money goes to VWRA until they drop below ${branch.resume}% combined.`)

    case "combined_warn":
      return allToOne("VWRA", "Tech funds over warning level — buy VWRA only.", `EQQQ + SEMI are ${branch.combined.toFixed(1)}% together — past the ${branch.warning}% warning level. Skip both this month; all new money goes to VWRA.`)

    case "a35_floor":
      return allToOne("A35", "A35 is below its minimum — topping it up first.", "A35 is below its 7% floor — all contributions go there until it is back above 8%.")

    case "equity_ceiling":
      return allToOne("A35", `Stocks over ${branch.equityPct.toFixed(0)}% — redirecting to A35.`, `Equities (VWRA + EQQQ + SEMI) are ${branch.equityPct.toFixed(1)}% combined — above the 92% maximum. All contributions go to A35 this month until stocks drift back below 92%.`)

    case "phase_IV":
      return allToOne("A35", "Phase IV — no stock purchases this month.", "You are in Phase IV (above SGD 114,000 — close to the goal). All new money goes into A35 to build up your SGD cash for the property purchase.")

    case "phase_III_entry":
      return allToOne("A35", "Phase III (early) — contributions to A35 only.", "You are in early Phase III (SGD 96,000–102,000). All monthly contributions go into A35. Quarterly equity sells begin once the portfolio reaches SGD 102,000.")

    case "phase_III":
      return allToOne("A35", "Phase III — new money all goes to safety.", "You are in Phase III (SGD 102,000–114,000). All monthly contributions go into A35. Also, once per quarter, sell a small slice of EQQQ (about 3%) and VWRA (about 2%) and move the money to A35.")

    case "drawdown":
      return allToOne("VWRA", "Markets are down — deploy the reserve, then buy VWRA.", `The portfolio is more than 15% below its recent high. Deploy your small cash reserve into VWRA, then send all contributions to VWRA too — a falling market is a buying opportunity early in the journey.`)

    case "underweight":
      return allToOne(branch.fund.ticker, `Below its ${branch.fund.rangeLow}% range — filling with new money.`, `${branch.fund.ticker} is under its comfortable range; the full contribution fills it.`)

    // "smh_cap" and "skip_at_high" and "standard": proportional split among eligible funds.
    // For smh_cap: SEMI is above range so it's excluded by the rangeHigh filter below.
    // For skip_at_high: the high-price filter handles it.
    default: {
      const eqqq = positions.find((p) => p.ticker === "EQQQ")
      const semi = positions.find((p) => p.ticker === "SEMI")
      const combined = (eqqq?.actualPct ?? 0) + (semi?.actualPct ?? 0)
      const activePhase = sbrPhase(totalValue, c)
      const phaseCaps = getPhaseCaps(activePhase.key)
      // smh_cap fires when SEMI alone is over its phase hard cap — the combined-ceiling warning
      // does NOT additionally apply, so guard techHalt to avoid zeroing EQQQ incorrectly.
      const techHalt = branch.tag !== "smh_cap" && combined >= phaseCaps.combinedWarning

      const eligible = positions.filter((p) => {
        if (techHalt && ["EQQQ", "SEMI"].includes(p.ticker)) return false
        // Never send new money to a fund above its cap (e.g. SEMI > 20%)
        if (p.hardCap !== null && p.actualPct > p.hardCap) return false
        if (["EQQQ", "SEMI"].includes(p.ticker)) {
          const f = p.hi52 > 0 && p.latestPrice > 0 ? ((p.latestPrice - p.hi52) / p.hi52) * 100 : null
          if (f !== null && f >= -c.skipAtHighPct) return false
        }
        return true
      })
      const pool = eligible.length ? eligible : positions.filter((p) => p.ticker === "VWRA")
      const totalTgt = pool.reduce((s, p) => s + (targets[p.ticker] ?? p.targetPct), 0) || 1
      let assigned = 0
      for (const p of pool) { const amt = round10((targets[p.ticker] ?? p.targetPct) / totalTgt * monthly); alloc[p.ticker].amount = amt; assigned += amt }
      const diff = monthly - assigned
      if (diff !== 0 && pool.length) { const big = pool.reduce((mi, p) => (alloc[p.ticker].amount > alloc[mi].amount ? p.ticker : mi), pool[0].ticker); alloc[big].amount += diff }

      let note: string | null = null
      const skipped = positions.filter((p) => !pool.includes(p) && !(alloc[p.ticker].amount > 0))
      for (const p of positions) {
        const a = alloc[p.ticker]
        if (a.amount > 0) { a.tag = a.amount > a.standardAmount ? "boosted" : "standard"; if (!a.reason) a.reason = a.tag === "boosted" ? "Getting extra money redirected from a paused fund." : "Standard split — on target." }
        else { a.tag = "zeroed"; if (!a.reason) a.reason = techHalt && ["EQQQ", "SEMI"].includes(p.ticker) ? `Paused — tech stocks are over ${phaseCaps.combinedWarning}% combined.` : "Skipped this month — near its yearly high price." }
      }
      if (techHalt) note = `EQQQ + SEMI are ${combined.toFixed(1)}% combined — over the ${phaseCaps.combinedWarning}% warning level for Phase ${activePhase.key}. Buys in both paused this month; money goes to VWRA instead.`
      else if (skipped.length) note = `Skipping ${skipped.map((p) => p.ticker).join(" & ")} this month — near the highest price in the last 12 months. Money redirected to VWRA.`

      return { allocations: Object.values(alloc), headline: note ? "Adjusted plan — see note below" : "Standard plan — everything is on track", marketOverlayActive: !!note, overlayNote: note }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Whole-share accrual engine (Art. VI § Execution)
//
// IBKR executes in whole shares. This engine converts the SGD dollar allocations
// from computeSbrDca into a whole-share instruction, carrying any remainder forward
// to the next month's buy. A35.SI uses SGX board lots (A35_LOT_SIZE = 1,000 units);
// all other SBR funds are US-listed ETFs traded in whole shares (lot size = 1).
//
// Usage:
//   const accrual = loadAccrualFromDb()           // { VWRA: 0, EQQQ: 45.20, ... }
//   const result  = computeWholeShareBuy(plan, prices, accrual)
//   saveAccrualToDb(result.newAccrual)             // persist the carry-forward
//   showUser(result.instructions)
// ─────────────────────────────────────────────────────────────────────────────

export interface AccrualBalance {
  [ticker: string]: number // SGD carry-forward from previous months
}

export interface ShareBuyInstruction {
  ticker: string
  sharesToBuy: number     // whole shares (or whole board lots for A35)
  lotSize: number         // 1 for US ETFs, 1000 for A35
  costSgd: number         // sharesToBuy × lotSize × priceSgd
  carryForward: number    // remainder banked for next month
  priceSgd: number        // price used for the calculation
}

export interface WholeSharBuyResult {
  instructions: ShareBuyInstruction[]
  totalDeployed: number   // SGD actually spent this month
  totalCarried: number    // SGD banked for future months
  note: string | null
}

/**
 * Convert a DcaPlan (SGD dollar allocations) into whole-share buy instructions.
 *
 * @param plan     Output of computeSbrDca — the SGD split for this month.
 * @param prices   Current SGD price per share for each ticker. A35 should use
 *                 the live SGX price in SGD (not USD). Missing tickers fall through
 *                 and are carried entirely.
 * @param accrual  Carry-forward balances from previous months (SGD per ticker).
 */
export function computeWholeShareBuy(
  plan: DcaPlan,
  prices: Record<string, number>,
  accrual: AccrualBalance = {},
): WholeSharBuyResult {
  const instructions: ShareBuyInstruction[] = []
  let totalDeployed = 0
  let totalCarried = 0

  for (const alloc of plan.allocations) {
    const ticker   = alloc.ticker
    const newSgd   = alloc.amount                // this month's contribution to this fund
    const carried  = accrual[ticker] ?? 0        // SGD banked from prior months
    const available = newSgd + carried

    const priceSgd = prices[ticker] ?? 0
    const lotSize  = ticker === "A35" ? A35_LOT_SIZE : 1

    if (priceSgd <= 0 || available <= 0) {
      // No price or nothing to deploy — carry everything forward
      instructions.push({ ticker, sharesToBuy: 0, lotSize, costSgd: 0, carryForward: available, priceSgd })
      totalCarried += available
      continue
    }

    const lotValueSgd  = priceSgd * lotSize
    const lotsAffordable = Math.floor(available / lotValueSgd)
    const costSgd      = lotsAffordable * lotValueSgd
    const carryForward = available - costSgd

    instructions.push({ ticker, sharesToBuy: lotsAffordable * lotSize, lotSize, costSgd, carryForward, priceSgd })
    totalDeployed += costSgd
    totalCarried  += carryForward
  }

  const hasA35Accrual = instructions.some((i) => i.ticker === "A35" && i.carryForward > 0)
  const note = hasA35Accrual
    ? `A35 needs SGD ${(instructions.find(i => i.ticker === "A35")!.carryForward).toFixed(2)} more to fill one board lot (1,000 units). Banking it for next month.`
    : null

  return { instructions, totalDeployed, totalCarried, note }
}
