import { Shell } from "@/components/shell"
import { getSession } from "@/lib/session"
import { redirect } from "next/navigation"
import { constitutionIdForEmail } from "@/lib/constitutions"
import { db } from "@/lib/db"
import { computeNextBestMove, type PositionInput } from "@/lib/next-best-move"
import { computeLookThrough, worstLookThroughBreach, largestContributor } from "@/lib/look-through"
import { buildPortfolioTimeline } from "@/lib/portfolio-metrics"
import { getLiveMarketPositions, getScheduledEvents } from "@/lib/finnhub"
import { NextBestMove } from "@/components/dashboard/next-best-move"
import { ScheduledEvents } from "@/components/calendar/scheduled-events"
import { ShieldCheck } from "lucide-react"


async function getRulesNowData(userId: string) {
  const holdings = await db.holding.findMany({
    where: { userId },
    include: { snapshots: { orderBy: { date: "desc" }, take: 8 } },
  })
  const totalValue = holdings.reduce((s, h) => s + (h.snapshots[0]?.value ?? 0), 0)
  const moveInputs: PositionInput[] = holdings.map((h) => ({
    ticker: h.ticker, name: h.name, color: h.color, value: h.snapshots[0]?.value ?? 0,
    actualPct: totalValue > 0 ? ((h.snapshots[0]?.value ?? 0) / totalValue) * 100 : 0,
    targetPct: h.targetPct, hardCapPct: h.hardCapPct ?? null,
    toleranceBand: h.toleranceBand ?? 2.5, latestPrice: h.snapshots[0]?.price ?? 0,
  }))

  // Feed the engine the SAME overlay context the cockpit uses, so the calendar can never show a
  // lower-priority move while the cockpit shows a critical trim for the identical portfolio.
  const lookThrough = computeLookThrough(moveInputs)
  const ltBreach = worstLookThroughBreach(lookThrough)
  const lookThroughBreach = ltBreach
    ? { label: ltBreach.label, pct: ltBreach.pct, hard: ltBreach.hard,
        trimTicker: largestContributor(ltBreach.key, lookThrough.companies.some((c) => c.key === ltBreach.key) ? "company" : "sector", moveInputs) }
    : undefined

  const timeline = buildPortfolioTimeline(holdings.map((h) => ({ id: h.id, snapshots: h.snapshots.map((s) => ({ date: s.date, value: s.value })) })))
  let portfolioDrawdownPct: number | undefined
  let drawdownDays: number | undefined
  if (timeline.length >= 2) {
    let peakIdx = 0
    for (let i = 1; i < timeline.length; i++) if (timeline[i].value > timeline[peakIdx].value) peakIdx = i
    const peak = timeline[peakIdx].value
    const last = timeline[timeline.length - 1]
    if (peak > 0 && last.value < peak) {
      portfolioDrawdownPct = ((last.value - peak) / peak) * 100
      // Days since the peak — lets the engine distinguish a sharp policy shock (A1, ≤21 days)
      // from a slow grind (≥30 days); both branches gate on this and were previously inert.
      drawdownDays = Math.max(0, Math.round((new Date(last.date).getTime() - new Date(timeline[peakIdx].date).getTime()) / 86400000))
    }
  }

  const [market, calendar] = await Promise.all([getLiveMarketPositions(), getScheduledEvents(90)])
  const nextBestMove = computeNextBestMove(moveInputs, totalValue, { market: market.positions, lookThroughBreach, portfolioDrawdownPct, drawdownDays })
  return { nextBestMove, market, calendar, hasBalance: totalValue > 0 }
}

export default async function CalendarPage() {
  const session = await getSession()
  if (!session) redirect("/login")
  if (constitutionIdForEmail(session.email) === "silicon-brick-road") redirect("/")
  const { nextBestMove, market, calendar, hasBalance } = await getRulesNowData(session.userId)

  return (
    <Shell
      title="Calendar & Rules"
      subtitle="What your rules say now, and the scheduled events ahead — context, not signals"
      userName={session.name}
      isAdmin={session.role === "admin"}
    >
      <div className="space-y-5">
        {/* F4 — What my rules say now (existing governance rendered against live state) */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex-1">What Your Rules Say Now</h2>
          </div>
          {hasBalance ? (
            <NextBestMove move={nextBestMove} dataAsOf={market.asOf} stale={market.stale} />
          ) : (
            <div className="rounded-xl border border-border bg-card px-5 py-8 text-center text-sm text-muted-foreground">
              Add your holdings on the Portfolio page to evaluate the rules against your position.
            </div>
          )}

        </div>

        {/* F3 — Scheduled events (read-only context) */}
        <ScheduledEvents events={calendar.events} stale={calendar.stale} note={calendar.note} />
      </div>
    </Shell>
  )
}
