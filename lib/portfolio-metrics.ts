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

/** Build an as-of portfolio timeline. Each holding carries its last confirmed value
 * forward until the next snapshot, so staggered broker timestamps do not turn
 * temporarily missing rows into zero or erase the entire portfolio history. */
export function buildPortfolioTimeline(holdings: HoldingWithSnapshots[]): TimelinePoint[] {
  const dateMaps = new Map<string, Map<string, number>>()
  for (const h of holdings) {
    const dm = new Map<string, number>()
    for (const s of h.snapshots) dm.set(s.date.toISOString().split("T")[0], s.value)
    dateMaps.set(h.id, dm)
  }
  const withData = holdings.filter((h) => (dateMaps.get(h.id)?.size ?? 0) > 0)
  const allDates = [...new Set(withData.flatMap((h) => [...dateMaps.get(h.id)!.keys()]))].sort()
  const last=new Map<string,number>()
  return allDates.map(date=>{
    for(const h of withData){const value=dateMaps.get(h.id)!.get(date);if(value!==undefined)last.set(h.id,value)}
    return {date,value:[...last.values()].reduce((s,v)=>s+v,0)}
  }).filter(point=>point.value>0)
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
 *
 * Purchases and sales contaminate value-based returns (a $5K buy on a $150K portfolio
 * looks like a +3.3% return). We filter returns whose absolute value exceeds a
 * gap-scaled threshold — genuine market moves on a diversified portfolio don't move
 * 10%+ per day, but deposits routinely do.
 */
export function annualisedVolatility(timeline: TimelinePoint[], minPoints = 6): number | null {
  const raw: Array<{ ret: number; gap: number }> = []
  for (let i = 1; i < timeline.length; i++) {
    const prev = timeline[i - 1], curr = timeline[i]
    if (prev.value <= 0) continue
    const ret = (curr.value - prev.value) / prev.value
    const gap = (new Date(curr.date).getTime() - new Date(prev.date).getTime()) / 86_400_000
    raw.push({ ret, gap })
  }

  // Gap-scaled threshold: 5% per sqrt(day). 1-day → 5%, 4-day → 10%, 25-day → 25%.
  // Anything above this on a diversified portfolio is almost certainly a cash flow.
  const clean = raw.filter(r => {
    const maxReturn = 0.05 * Math.sqrt(Math.max(r.gap, 1))
    return Math.abs(r.ret) <= Math.max(maxReturn, 0.08)
  })

  if (clean.length < minPoints) return null
  const returns = clean.map(r => r.ret)
  const gaps = clean.map(r => r.gap)
  const avgGap = mean(gaps)
  const periodsPerYear = 365 / Math.max(avgGap, 1)
  return stdDev(returns) * Math.sqrt(periodsPerYear)
}

/**
 * Largest peak-to-trough decline observed in the timeline, as a positive fraction
 * (0.12 = a 12% drawdown from the running high). Returns null when there are too
 * few points for the figure to mean anything — callers should fall back to a
 * sensible default rather than silently displaying 0% (a false "no drawdown" claim
 * is exactly as misleading as an unrelated hardcoded guess).
 */
export function maxDrawdown(timeline: TimelinePoint[], minPoints = 3): number | null {
  if (timeline.length < minPoints) return null
  let peak = timeline[0].value
  let worst = 0
  for (const point of timeline) {
    if (point.value > peak) peak = point.value
    else if (peak > 0) worst = Math.max(worst, (peak - point.value) / peak)
  }
  return worst
}
