import type { Constitution, ConstitutionFund } from "@/lib/constitutions"
import { economicSleeveTicker } from "@/lib/instrument-identity"

export type Align = "ok" | "watch" | "breach"
export interface GovCheck { id: string; label: string; status: Align; detail: string }

interface Pos { ticker: string; actualPct: number }

// Alternate exchange lines of the same instrument (EQQQ→EQAC, SEMI→SMH, IBIT/GBTC→BTC) and
// SMH's venue-qualified ".L" line must roll into one governed sleeve before any limit is
// judged — this is the exact normalization gap that let SBR's checks miss an aliased
// holding entirely (see lib/sbr-look-through.ts). Shared here so Atlas and SBR can never
// diverge on it again.
function sleeveTicker(ticker: string): string {
  const raw = ticker.trim().toUpperCase()
  return economicSleeveTicker(raw === "SMH.L" ? "SMH" : raw)
}

export function sleeveActuals(positions: Pos[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const p of positions) {
    const k = sleeveTicker(p.ticker)
    m.set(k, (m.get(k) ?? 0) + p.actualPct)
  }
  return m
}

/**
 * Per-fund hard cap / floor / soft-band check — the single implementation for every
 * constitution's Article II-equivalent portfolio-construction limits (hard floor/cap and
 * soft drift band per fund). Reads limits straight off
 * ConstitutionFund (target/rangeLow/rangeHigh/hardCap/floor), which is already the shared
 * shape both ATLAS_CORE.funds and SILICON_BRICK_ROAD.funds are built from — so a threshold
 * fix here never needs a matching edit in a second file.
 *
 * Boundaries are inclusive (>=/<=): a sleeve sitting EXACTLY on a limit is already AT the
 * limit the constitution names ("at 8%, stop adding and review"), not one basis point shy
 * of it.
 *
 * Iterates the constitution's fund list (not the live positions array), so a governed fund
 * that is entirely unheld — 0%, not just under target — still gets judged against its floor.
 * The previous position-keyed loops silently skipped any fund absent from the positions
 * array, which could hide a genuine floor breach (e.g. a floor-mandated sleeve sold to zero).
 */
export function evaluateFundLimits(funds: ConstitutionFund[], positions: Pos[]): GovCheck {
  const actual = sleeveActuals(positions)
  let hard = 0, soft = 0
  const hardTickers: string[] = [], softTickers: string[] = []
  for (const f of funds) {
    const a = actual.get(f.ticker) ?? 0
    const overHard = f.hardCap !== null && a >= f.hardCap
    const underFloor = f.floor !== undefined && a <= f.floor
    if (overHard || underFloor) { hard++; hardTickers.push(f.ticker) }
    else if (a < f.rangeLow || a > f.rangeHigh) { soft++; softTickers.push(f.ticker) }
  }
  // Both categories can be true at once (fund A hard-breached, unrelated fund B merely
  // soft-drifted) — status takes the worse of the two per usual, but the detail names
  // every affected fund in both categories, not just the worse one. A single hard-breach
  // check should never silently hide an independent soft-band drift elsewhere.
  const detail = hard
    ? `${hardTickers.join(", ")} outside a hard limit${soft ? `; ${softTickers.join(", ")} outside a soft band` : ""}`
    : soft
    ? `${softTickers.join(", ")} outside a soft band`
    : "All governed sleeves are within their bands"
  return {
    id: "drift", label: "Allocation bands",
    status: hard ? "breach" : soft ? "watch" : "ok",
    detail,
  }
}

/** Combined-sleeve ceiling (e.g. EQAC + SMH) — shared by every constitution that defines
 *  one via Constitution.combined, which is already the same shape for Atlas and SBR. */
export function evaluateCombinedSleeve(combined: NonNullable<Constitution["combined"]>, positions: Pos[]): GovCheck {
  const actual = sleeveActuals(positions)
  const total = combined.tickers.reduce((s, t) => s + (actual.get(t) ?? 0), 0)
  return {
    id: "combined",
    label: combined.label,
    status: total >= combined.hard ? "breach" : total >= combined.warning ? "watch" : "ok",
    detail: `${total.toFixed(1)}%; watch ${combined.warning}%, hard ${combined.hard}%`,
  }
}

export function summarize(checks: GovCheck[]): { breaches: number; watches: number; overall: Align } {
  const breaches = checks.filter((c) => c.status === "breach").length
  const watches = checks.filter((c) => c.status === "watch").length
  return { breaches, watches, overall: breaches ? "breach" : watches ? "watch" : "ok" }
}
