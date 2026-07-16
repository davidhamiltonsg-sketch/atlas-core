import { db } from "@/lib/db"
import { getUsQuote } from "@/lib/finnhub"

// ─────────────────────────────────────────────────────────────────────────────
// Outside-Atlas employer awards (unvested RSUs).
//
// NEVER part of NAV, targets, drift bands, health, next-best-move or
// look-through: unvested RSUs are contingent compensation (forfeited on
// leaving, taxed at vest), and employer stock on top of an employer paycheck
// is concentration, not an allocation. The award is represented as a visible
// vesting pipeline with one SOP — on vest: sell, convert, contribute — and its
// after-tax proceeds count as planned FUTURE contributions in the forecast.
//
// Storage mirrors lib/external-liquidity.ts: append-only BehaviourLog markers,
// JSON payload in `note`, latest marker wins. No schema migration required.
// ─────────────────────────────────────────────────────────────────────────────

const MARKER_TYPE = "external-award"

// Pure types/maths live in lib/external-award-math.ts (db-free for contract checks).
export {
  upcomingVests,
  type ExternalAward,
  type ExternalAwardTranche,
  type UpcomingVest,
} from "@/lib/external-award-math"
import { upcomingVests, type ExternalAward } from "@/lib/external-award-math"

function isValidAward(a: unknown): a is ExternalAward {
  if (!a || typeof a !== "object" || Array.isArray(a)) return false
  const o = a as Record<string, unknown>
  if (typeof o.ticker !== "string" || !o.ticker.trim()) return false
  if (typeof o.label !== "string") return false
  if (typeof o.taxRatePct !== "number" || o.taxRatePct < 0 || o.taxRatePct > 60) return false
  if (typeof o.asOf !== "string") return false
  if ("priceUsd" in o && o.priceUsd !== undefined && (typeof o.priceUsd !== "number" || !(o.priceUsd > 0))) return false
  if (!Array.isArray(o.tranches) || o.tranches.length === 0 || o.tranches.length > 12) return false
  return (o.tranches as unknown[]).every((t) => {
    if (!t || typeof t !== "object") return false
    const r = t as Record<string, unknown>
    return typeof r.date === "string" && Number.isFinite(new Date(r.date).getTime())
      && typeof r.units === "number" && r.units > 0 && r.units <= 1_000_000
  })
}

export async function getExternalAward(userId: string): Promise<ExternalAward | null> {
  const latest = await db.behaviourLog.findFirst({
    where: { userId, type: MARKER_TYPE },
    orderBy: { date: "desc" },
    select: { note: true },
  })
  if (!latest) return null
  try {
    const parsed = JSON.parse(latest.note) as unknown
    if (parsed && typeof parsed === "object" && (parsed as { cleared?: boolean }).cleared) return null
    return isValidAward(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** Append a new award marker; null clears the pipeline (append-only, latest wins). */
export async function setExternalAward(userId: string, award: ExternalAward | null): Promise<void> {
  await db.behaviourLog.create({
    data: {
      userId,
      type: MARKER_TYPE,
      note: award ? JSON.stringify(award) : JSON.stringify({ cleared: true }),
    },
  })
}

export interface AwardPipeline {
  award: ExternalAward
  priceUsd: number
  priceIsLive: boolean
  vests: ReturnType<typeof upcomingVests>
}

/** Award + best-available price + future vests, for pages and the forecast.
 *  Returns null when no award is stored or no usable price exists. */
export async function getAwardPipeline(userId: string, now = new Date()): Promise<AwardPipeline | null> {
  const award = await getExternalAward(userId)
  if (!award) return null
  const live = await getUsQuote(award.ticker)
  const priceUsd = live ?? award.priceUsd ?? 0
  if (!(priceUsd > 0)) return null
  return { award, priceUsd, priceIsLive: live !== null, vests: upcomingVests(award, priceUsd, now) }
}

/** Vest inflows in PLAN currency (USD after tax) for projectPortfolio's
 *  extraContributions input — same units as the US$ monthly plan and January boost. */
export async function vestExtraContributionsForUser(
  userId: string,
  now = new Date(),
): Promise<Array<{ monthsFromNow: number; amount: number }>> {
  const pipeline = await getAwardPipeline(userId, now)
  if (!pipeline) return []
  return pipeline.vests.map((v) => ({ monthsFromNow: v.monthsFromNow, amount: v.afterTaxUsd }))
}
