// ─────────────────────────────────────────────────────────────────────────────
// Atlas Core — Governance Digest
//
// Evaluates the portfolio against the rules WITHOUT a logged-in session, so a daily
// scheduled job can decide whether the user needs to act and push them an alert.
// This is what closes the loop between passive governance and active execution:
// the rules now reach out when something needs attention, instead of waiting for a visit.
// ─────────────────────────────────────────────────────────────────────────────

import { db } from "@/lib/db"
import { computeLookThrough } from "@/lib/look-through"
import { evaluateGovernance, type GovCheck } from "@/lib/governance-status"
import { isInScope } from "@/lib/approved-alternatives"
import { getScheduledEvents } from "@/lib/finnhub"

export interface DigestItem {
  severity: "breach" | "watch" | "info"
  title: string
  detail: string
}

export interface GovernanceDigest {
  user: { id: string; name: string; email: string }
  totalValue: number
  snapshotAgeDays: number | null
  items: DigestItem[]
  actionable: boolean // true if there is anything worth emailing about
}

/** Build the daily governance digest for a user (no session needed). */
export async function buildGovernanceDigest(userId: string): Promise<GovernanceDigest | null> {
  const user = await db.user.findUnique({ where: { id: userId } })
  if (!user) return null

  const holdings = await db.holding.findMany({
    where: { userId },
    include: { snapshots: { orderBy: { date: "desc" }, take: 1 } },
  })

  const totalValue = holdings.reduce((s, h) => s + (h.snapshots[0]?.value ?? 0), 0)
  const positions = holdings.map((h) => {
    const value = h.snapshots[0]?.value ?? 0
    return {
      ticker: h.ticker,
      name: h.name,
      value,
      actualPct: totalValue > 0 ? (value / totalValue) * 100 : 0,
      targetPct: h.targetPct,
      toleranceBand: h.toleranceBand,
    }
  })

  // Most recent snapshot age (prompts a refresh if values are stale).
  const latestDate = holdings.reduce<Date | null>((latest, h) => {
    const d = h.snapshots[0]?.date
    if (!d) return latest
    return latest === null || d > latest ? d : latest
  }, null)
  const snapshotAgeDays = latestDate ? Math.floor((Date.now() - new Date(latestDate).getTime()) / 86_400_000) : null

  const items: DigestItem[] = []

  // Only evaluate rules once there is a balance to evaluate.
  if (totalValue > 0) {
    const lookThrough = computeLookThrough(positions)
    const bufferPos = positions.find((p) => ["SGOV", "AGG", "CASH"].includes(p.ticker.toUpperCase()))
    const bufferPct = bufferPos ? bufferPos.actualPct : 0

    const gov = evaluateGovernance({ positions, bufferPct, lookThrough })
    for (const c of gov.checks as GovCheck[]) {
      if (c.status === "breach") items.push({ severity: "breach", title: c.label, detail: c.detail })
      else if (c.status === "watch") items.push({ severity: "watch", title: c.label, detail: c.detail })
    }

    // Out-of-scope holdings (held but not in the plan).
    const offScope = positions.filter((p) => p.value > 0 && !isInScope(p.ticker)).map((p) => p.ticker.toUpperCase())
    if (offScope.length > 0) {
      items.push({
        severity: "watch",
        title: "Holding outside your plan",
        detail: `${offScope.join(", ")} ${offScope.length > 1 ? "are" : "is"} held but not in your policy — decide to keep, switch, or exit.`,
      })
    }
  }

  // Monthly 5-minute check due? (no check logged this calendar month)
  const lastCheck = await db.behaviourLog.findFirst({
    where: { userId, type: "monthly-check" },
    orderBy: { date: "desc" },
  })
  const now = new Date()
  const sameMonth = lastCheck && lastCheck.date.getFullYear() === now.getFullYear() && lastCheck.date.getMonth() === now.getMonth()
  if (!sameMonth) {
    items.push({
      severity: "info",
      title: "Monthly 5-minute check due",
      detail: "You haven't logged your monthly review this month. It takes five minutes — confirm you're on track.",
    })
  }

  // Stale prices nudge.
  if (snapshotAgeDays !== null && snapshotAgeDays >= 7) {
    items.push({
      severity: "info",
      title: `Prices ${snapshotAgeDays} days old`,
      detail: "Your portfolio values may be out of date. Open Atlas Core to refresh from IBKR / live prices.",
    })
  }

  // Imminent high-impact calendar events (next 3 days) — makes §12 actionable.
  try {
    const cal = await getScheduledEvents(7)
    const horizon = new Date(now.getTime() + 3 * 86_400_000)
    const todayYmd = now.toISOString().split("T")[0]
    const horizonYmd = horizon.toISOString().split("T")[0]
    for (const e of cal.events) {
      if (e.date >= todayYmd && e.date <= horizonYmd && (e.kind === "economic" || e.kind === "earnings")) {
        items.push({
          severity: "info",
          title: `Upcoming: ${e.title}`,
          detail: `${e.date} — hold discretionary buys until after the event if you're near a dealing window.`,
        })
      }
    }
  } catch { /* calendar is best-effort */ }

  const actionable = items.some((i) => i.severity === "breach" || i.severity === "watch")
    || items.some((i) => i.title.startsWith("Monthly"))

  return {
    user: { id: user.id, name: user.name, email: user.email },
    totalValue,
    snapshotAgeDays,
    items,
    actionable,
  }
}
