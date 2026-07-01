import { Shell } from "@/components/shell"
import { getSession } from "@/lib/session"
import { redirect } from "next/navigation"
import { constitutionIdForEmail } from "@/lib/constitutions"
import { db } from "@/lib/db"
import { computeNextBestMove, type PositionInput } from "@/lib/next-best-move"
import { getLiveMarketPositions, getScheduledEvents } from "@/lib/finnhub"
import { NextBestMove } from "@/components/dashboard/next-best-move"
import { ScheduledEvents } from "@/components/calendar/scheduled-events"
import { ShieldCheck } from "lucide-react"

// The written pre-commitments currently in force (rendered against live state below).
const RULES_IN_FORCE = [
  "A loss is never a sell trigger — sell a conviction holding only on a broken thesis (A3).",
  "The shock buffer is built from new contributions only — never by selling (A4, C2).",
  "Don't buy within ~3% of a 52-week high; VT is the exempt anchor (B1).",
  "Hard caps are inviolable — SMH ≤ 12%, BTC ≤ cycle cap, combined tech ≤ 42% (C1, §4).",
  "One discretionary change per quarter; 72-hour cooling-off on anything not rule-mandated (D1, D2).",
]

async function getRulesNowData(userId: string) {
  const holdings = await db.holding.findMany({
    where: { userId },
    include: { snapshots: { orderBy: { date: "desc" }, take: 1 } },
  })
  const totalValue = holdings.reduce((s, h) => s + (h.snapshots[0]?.value ?? 0), 0)
  const moveInputs: PositionInput[] = holdings.map((h) => ({
    ticker: h.ticker, name: h.name, color: h.color, value: h.snapshots[0]?.value ?? 0,
    actualPct: totalValue > 0 ? ((h.snapshots[0]?.value ?? 0) / totalValue) * 100 : 0,
    targetPct: h.targetPct, hardCapPct: h.hardCapPct ?? null,
    toleranceBand: h.toleranceBand ?? 2.5, latestPrice: h.snapshots[0]?.price ?? 0,
  }))

  const [market, calendar] = await Promise.all([getLiveMarketPositions(), getScheduledEvents(90)])
  const nextBestMove = computeNextBestMove(moveInputs, totalValue, { market: market.positions })
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

          <div className="mt-3 rounded-xl border border-border bg-card p-4">
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-2">Pre-commitments in force</p>
            <ul className="space-y-1.5">
              {RULES_IN_FORCE.map((r, i) => (
                <li key={i} className="flex gap-2 text-xs text-muted-foreground leading-relaxed">
                  <span className="text-green-500 shrink-0">✓</span>{r}
                </li>
              ))}
            </ul>
            <a href="/governance" className="mt-3 inline-block text-[11px] font-semibold text-primary hover:underline">
              Full governance &amp; pre-commitments →
            </a>
          </div>
        </div>

        {/* F3 — Scheduled events (read-only context) */}
        <ScheduledEvents events={calendar.events} stale={calendar.stale} note={calendar.note} />
      </div>
    </Shell>
  )
}
