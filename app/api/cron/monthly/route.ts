import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { constitutionIdForEmail, SILICON_BRICK_ROAD } from "@/lib/constitutions"
import { sendMonthlyReminderEmail, emailConfigured } from "@/lib/email"
import { computeSbrNextMove, sbrPhase, type SbrPosition } from "@/lib/sbr-engine"
import { computeLadder } from "@/lib/ladder"
import { getDealingWindow } from "@/lib/constitution"

export const maxDuration = 60
export const dynamic = "force-dynamic"

// Monthly scheduled job — runs on the 14th of each month, the day before the
// Atlas Core dealing window opens. Sends each user a plain-English "what to
// buy this month" email derived from their constitution's routing engine.
//
// Atlas Core: walks the Art. XIII ladder and sends the fired step's instruction.
// SBR:        runs computeSbrNextMove and sends the resulting action.
//
// Auth: Bearer CRON_SECRET header.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get("authorization")
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  } else {
    console.warn("[cron/monthly] CRON_SECRET not set — endpoint is unauthenticated.")
  }

  if (!emailConfigured()) {
    return NextResponse.json({ ran: false, reason: "RESEND_API_KEY not set" })
  }

  const now = new Date()
  const window = getDealingWindow(now)
  const dealingWindow = {
    opens: window.opens.toLocaleDateString("en-SG", { day: "numeric", month: "short" }),
    closes: window.closes.toLocaleDateString("en-SG", { day: "numeric", month: "short" }),
  }

  const users = await db.user.findMany({ select: { id: true, email: true, name: true } })
  const results: Array<{ userId: string; emailed: boolean; reason?: string }> = []

  for (const u of users) {
    const portfolioId = constitutionIdForEmail(u.email)

    try {
      if (portfolioId === "silicon-brick-road") {
        // ── SBR monthly reminder ────────────────────────────────────────────
        const holdings = await db.holding.findMany({
          where: { userId: u.id },
          include: { snapshots: { orderBy: { date: "desc" }, take: 1 } },
        })
        const SBR = SILICON_BRICK_ROAD
        const totalValue = holdings.reduce((s, h) => s + (h.snapshots[0]?.value ?? 0), 0)

        const positions: SbrPosition[] = holdings
          .map((h) => {
            const fund = SBR.funds.find((f) => f.ticker === h.ticker)
            if (!fund) return null
            const value = h.snapshots[0]?.value ?? 0
            return {
              ticker: h.ticker, name: h.name, color: fund.color,
              value, actualPct: totalValue > 0 ? (value / totalValue) * 100 : 0,
              targetPct: fund.target, rangeLow: fund.rangeLow, rangeHigh: fund.rangeHigh,
              hardCap: fund.hardCap, ...(fund.floor !== undefined ? { floor: fund.floor } : {}),
              latestPrice: 0, hi52: 0,
            } satisfies SbrPosition
          })
          .filter((p): p is SbrPosition => p !== null)

        const nextMove = totalValue > 0 ? computeSbrNextMove(positions, totalValue) : {
          severity: "none" as const, ticker: "VWRA", action: "Start investing",
          what: "Make your first SGD 1,000 contribution.", why: "Build the habit.",
          when: "Anytime.", color: "#38bdf8",
        }
        const phase = sbrPhase(totalValue)

        const r = await sendMonthlyReminderEmail(u.email, u.name, "silicon-brick-road", nextMove, { key: phase.key, label: phase.label })
        results.push({ userId: u.id, emailed: !r.skipped, reason: r.skipped ? r.reason : undefined })

      } else {
        // ── Atlas Core monthly reminder ──────────────────────────────────────
        const holdings = await db.holding.findMany({
          where: { userId: u.id },
          include: { snapshots: { orderBy: { date: "desc" }, take: 1 } },
        })
        const totalValue = holdings.reduce((s, h) => s + (h.snapshots[0]?.value ?? 0), 0)

        const positions = holdings.map((h) => ({
          ticker: h.ticker, name: h.name, color: h.color,
          value: h.snapshots[0]?.value ?? 0,
          actualPct: totalValue > 0 ? ((h.snapshots[0]?.value ?? 0) / totalValue) * 100 : 0,
          targetPct: h.targetPct, hardCapPct: h.hardCapPct ?? null, toleranceBand: h.toleranceBand,
          latestPrice: h.snapshots[0]?.price ?? 0,
        }))

        const ladder = computeLadder(positions, totalValue, {})
        const nextMove = {
          severity: ladder.severity,
          ticker: ladder.ticker ?? "VWRA",
          action: ladder.headline,
          what: ladder.instruction,
          why: ladder.rationale,
          when: ladder.when,
          color: "#7c3aed",
        }

        const r = await sendMonthlyReminderEmail(u.email, u.name, "atlas-core", nextMove, undefined, dealingWindow)
        results.push({ userId: u.id, emailed: !r.skipped, reason: r.skipped ? r.reason : undefined })
      }
    } catch (e) {
      results.push({ userId: u.id, emailed: false, reason: e instanceof Error ? e.message : "unknown error" })
    }
  }

  return NextResponse.json({ ran: true, at: now.toISOString(), month: now.toLocaleString("en-SG", { month: "long", year: "numeric" }), results })
}
