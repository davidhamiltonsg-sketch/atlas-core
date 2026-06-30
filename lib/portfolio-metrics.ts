// ─────────────────────────────────────────────────────────────────────────────
// Atlas Core — shared portfolio metrics.
//
// One implementation of the de-duplicated portfolio timeline and its annualised
// volatility, so the Risk page and the Forecast cone use the SAME number instead of
// a hardcoded guess. Multiple snapshots on one calendar date are collapsed to the
// latest value; only dates where every holding has a value are included.
// ─────────────────────────────────────────────────────────────────────────────

export interface TimelinePoint { date: string; value: number }

interface HoldingWithSnapshots {
  id: string
  snapshots: Array<{ date: Date; value: number }>
}

/** Build a clean portfolio value timeline (deduped by date, complete dates only). */
export function buildPortfolioTimeline(holdings: HoldingWithSnapshots[]): TimelinePoint[] {
  const dateMaps = new Map<string, Map<string, number>>()
  for (const h of holdings) {
    const dm = new Map<string, number>()
    for (const s of h.snapshots) dm.set(s.date.toISOString().split("T")[0], s.value)
    dateMaps.set(h.id, dm)
  }
  const withData = holdings.filter((h) => (dateMaps.get(h.id)?.size ?? 0) > 0)
  const allDates = [...new Set(withData.flatMap((h) => [...dateMaps.get(h.id)!.keys()]))].sort()
  return allDates
    .map((date) => {
      const values = withData.map((h) => dateMaps.get(h.id)!.get(date))
      if (values.some((v) => v === undefined)) return null
      return { date, value: (values as number[]).reduce((s, v) => s + v, 0) }
    })
    .filter((x): x is TimelinePoint => x !== null)
}

function mean(a: number[]): number { return a.reduce((s, v) => s + v, 0) / a.length }
function stdDev(a: number[]): number {
  if (a.length < 2) return 0
  const m = mean(a)
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1))
}

/**
 * Annualised return volatility from a portfolio timeline, scaled by snapshot frequency
 * (same method as the Risk page). Returns null when there are too few points (< minPoints)
 * for a meaningful figure — callers should fall back to a sensible default.
 */
export function annualisedVolatility(timeline: TimelinePoint[], minPoints = 6): number | null {
  const returns: number[] = []
  const gaps: number[] = []
  for (let i = 1; i < timeline.length; i++) {
    const prev = timeline[i - 1], curr = timeline[i]
    if (prev.value > 0) returns.push((curr.value - prev.value) / prev.value)
    const days = (new Date(curr.date).getTime() - new Date(prev.date).getTime()) / 86_400_000
    gaps.push(days)
  }
  if (returns.length < minPoints) return null
  const avgGap = gaps.length ? mean(gaps) : 30
  const periodsPerYear = 365 / Math.max(avgGap, 1)
  return stdDev(returns) * Math.sqrt(periodsPerYear)
}
