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
import { evaluateGovernance, type GovCheck, type DigestItem } from "@/lib/governance-status"
import { isInScope, isUsSited } from "@/lib/approved-alternatives"
import { getScheduledEvents } from "@/lib/finnhub"
import { OPERATING_ASSUMPTIONS } from "@/lib/constants"

// Re-export so existing imports of DigestItem from this file continue to work.
export type { DigestItem }

export interface GovernanceDigest {
  user: { id: string; name: string; email: string }
  totalValue: number
  snapshotAgeDays: number | null
  items: DigestItem[]
  actionable: boolean // true if there is anything worth emailing about
  /** Computed portfolio drawdown from ATH (negative %, e.g. -27). null if insufficient history. */
  drawdownPct: number | null
  /** Current SGOV/buffer percentage of portfolio. */
  sgovPct: number
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

  const bufferPos = positions.find((p) => ["SGOV", "AGG", "CASH"].includes(p.ticker.toUpperCase()))
  const sgovPct = bufferPos ? bufferPos.actualPct : 0

  // Compute portfolio ATH and drawdown from snapshot history (last 2 years).
  // Groups holding snapshots by calendar date, sums per-date, finds ATH.
  let drawdownPct: number | null = null
  try {
    const recentSnaps = await db.snapshot.findMany({
      where: {
        holding: { userId },
        date: { gte: new Date(Date.now() - 2 * 365 * 86_400_000) },
      },
      select: { date: true, value: true },
      orderBy: { date: "asc" },
    })
    if (recentSnaps.length > 0) {
      const byDate = new Map<string, number>()
      for (const s of recentSnaps) {
        const key = s.date.toISOString().split("T")[0]
        byDate.set(key, (byDate.get(key) ?? 0) + s.value)
      }
      const ath = Math.max(...byDate.values())
      if (ath > 0) drawdownPct = ((totalValue - ath) / ath) * 100
    }
  } catch { /* drawdown is best-effort */ }

  // Only evaluate rules once there is a balance to evaluate.
  if (totalValue > 0) {
    const lookThrough = computeLookThrough(positions)

    // Compute US-sited ETF value in USD for the UCITS estate-tax check.
    // Atlas positions store value in SGD; divide by 1.35 fallback rate.
    const usSitedValueUsd = positions
      .filter((p) => isUsSited(p.ticker))
      .reduce((s, p) => s + (p.value ?? 0), 0) / 1.35

    const gov = evaluateGovernance({ positions, bufferPct: sgovPct, lookThrough, usSitedValueUsd })
    for (const c of gov.checks as GovCheck[]) {
      if (c.status === "breach") items.push({ severity: "breach", title: c.label, detail: c.detail })
      else if (c.status === "watch") items.push({ severity: "watch", title: c.label, detail: c.detail })
    }

    // Crash protocol monitor — surfaces separately from the governance checks so the
    // severity escalation (watch → breach) is clear and the SGOV instruction is visible.
    if (drawdownPct !== null) {
      const CRASH_TRIGGER = -25
      if (drawdownPct <= CRASH_TRIGGER) {
        const sgovExcess = Math.max(0, sgovPct - 8)
        items.push({
          severity: "breach",
          title: `Crash Protocol active — portfolio is ${Math.abs(drawdownPct).toFixed(0)}% below ATH`,
          detail: `Art. XIV crash protocol is active. Pre-committed responses: ${sgovExcess > 0 ? `deploy ${(sgovExcess / 2).toFixed(1)}% of portfolio from SGOV into VT (A1), then ` : ""}keep contributions unchanged into VT (A2). Do not sell.`,
        })
      } else if (drawdownPct <= -15) {
        items.push({
          severity: "watch",
          title: `Portfolio drawdown: ${Math.abs(drawdownPct).toFixed(0)}% below ATH`,
          detail: `Approaching the ${Math.abs(CRASH_TRIGGER)}% crash protocol threshold. Continue scheduled contributions. No defensive action yet.`,
        })
      }
    }

    // UCITS sentinel — escalates beyond what the governance engine covers.
    const ucitsMandatory = OPERATING_ASSUMPTIONS.ucitsMandatoryTriggerUsd
    if (usSitedValueUsd >= ucitsMandatory) {
      items.push({
        severity: "breach",
        title: `UCITS review required — US-sited ETFs at ~$${Math.round(usSitedValueUsd / 1000)}k USD`,
        detail: `Art. XV mandatory review triggered at USD ${ucitsMandatory.toLocaleString()}. Confirm migration to Irish UCITS equivalents (VWRA/VFEA/EQQQ) with current law and tax advice before executing.`,
      })
    }

    // Out-of-scope holdings (held but not in the plan).
    const offScope = positions.filter((p) => (p.value ?? 0) > 0 && !isInScope(p.ticker)).map((p) => p.ticker.toUpperCase())
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
    drawdownPct,
    sgovPct,
  }
}
