// ─────────────────────────────────────────────────────────────────────────────
// Silicon Brick Road — Governance Digest
//
// Evaluates Dami's portfolio against SBR constitution rules WITHOUT a session,
// so the daily cron job can detect breaches, phase crossings, and monthly
// contribution windows and push an alert.
//
// Parallel to lib/governance-digest.ts (Atlas Core). Kept fully separate —
// no imports from lib/constitution.ts or lib/governance-digest.ts to avoid
// any Atlas Core logic bleeding into the SBR path.
// ─────────────────────────────────────────────────────────────────────────────

import { db } from "@/lib/db"
import { SILICON_BRICK_ROAD } from "@/lib/constitutions"
import { evaluateSbrGovernance } from "@/lib/sbr-governance"
import { computeSbrNextMove, sbrPhase, computeSbrHealth, type SbrPosition } from "@/lib/sbr-engine"
import type { DigestItem } from "@/lib/governance-digest"
import type { NextMove } from "@/lib/next-best-move"

export interface SbrDigest {
  user: { id: string; name: string; email: string }
  totalValue: number
  phase: { key: string; label: string }
  nextMove: NextMove
  snapshotAgeDays: number | null
  healthScore: number
  items: DigestItem[]
  actionable: boolean
  /** true when the portfolio just entered a new phase since the last logged transition */
  phaseCrossed: boolean
  newPhaseKey: string | null
}

/** Build the SBR governance digest for a user (no session required). */
export async function buildSbrDigest(userId: string): Promise<SbrDigest | null> {
  const user = await db.user.findUnique({ where: { id: userId } })
  if (!user) return null

  const holdings = await db.holding.findMany({
    where: { userId },
    include: { snapshots: { orderBy: { date: "desc" }, take: 1 } },
  })

  const SBR = SILICON_BRICK_ROAD
  const totalValue = holdings.reduce((s, h) => s + (h.snapshots[0]?.value ?? 0), 0)

  // Build SbrPosition array — rule numbers come from the SBR constitution spec,
  // not the DB fields (DB only stores targetPct, not rangeLow/rangeHigh/floor).
  const positions: SbrPosition[] = holdings
    .map((h) => {
      const fund = SBR.funds.find((f) => f.ticker === h.ticker)
      if (!fund) return null
      const value = h.snapshots[0]?.value ?? 0
      const actualPct = totalValue > 0 ? (value / totalValue) * 100 : 0
      return {
        ticker: h.ticker,
        name: h.name,
        color: fund.color,
        value,
        actualPct,
        targetPct: fund.target,
        rangeLow: fund.rangeLow,
        rangeHigh: fund.rangeHigh,
        hardCap: fund.hardCap,
        ...(fund.floor !== undefined ? { floor: fund.floor } : {}),
        latestPrice: 0,  // no live price in digest — skip-at-high won't fire
        hi52: 0,
      } satisfies SbrPosition
    })
    .filter((p): p is SbrPosition => p !== null)

  const latestDate = holdings.reduce<Date | null>((latest, h) => {
    const d = h.snapshots[0]?.date
    if (!d) return latest
    return latest === null || d > latest ? d : latest
  }, null)
  const snapshotAgeDays = latestDate
    ? Math.floor((Date.now() - new Date(latestDate).getTime()) / 86_400_000)
    : null

  const items: DigestItem[] = []

  const phase = sbrPhase(totalValue)
  const health = totalValue > 0 ? computeSbrHealth(positions, totalValue, snapshotAgeDays ?? 99) : null
  const nextMove = totalValue > 0 ? computeSbrNextMove(positions, totalValue) : { severity: "none" as const, ticker: "VWRA", action: "Start investing", what: "Make your first contribution.", why: "Build the habit.", when: "Anytime.", color: "#38bdf8" }

  if (totalValue > 0) {
    // Run constitution compliance checks.
    const gov = evaluateSbrGovernance(positions, totalValue)
    for (const c of gov.checks) {
      if (c.status === "breach") items.push({ severity: "breach", title: c.label, detail: c.detail })
      else if (c.status === "watch") items.push({ severity: "watch", title: c.label, detail: c.detail })
    }

    // Health score drop alert.
    if (health && health.overall < 65) {
      items.push({
        severity: "watch",
        title: `Portfolio health score: ${health.overall}/100 — action recommended`,
        detail: `Overall health is ${health.overallLabel}. Biggest drags: risk ${health.risk}/100, governance ${health.governance}/100.`,
      })
    }

    // Stale prices nudge.
    if (snapshotAgeDays !== null && snapshotAgeDays >= 7) {
      items.push({
        severity: "info",
        title: `Prices ${snapshotAgeDays} days old`,
        detail: "Your portfolio values may be out of date. Open the app to refresh from live prices.",
      })
    }
  }

  // Monthly contribution reminder — always surface around the 13th/15th.
  const now = new Date()
  const dayOfMonth = now.getDate()
  if (dayOfMonth >= 13 && dayOfMonth <= 15) {
    items.push({
      severity: "info",
      title: `Monthly contribution window — ${nextMove.action}`,
      detail: `${nextMove.what} Dealing window: second half of the month. ${nextMove.why}`,
    })
  }

  // Phase crossing detection — compare current phase to last logged transition.
  let phaseCrossed = false
  let newPhaseKey: string | null = null
  const lastPhaseLog = await db.behaviourLog.findFirst({
    where: { userId, type: "sbr-phase-transition" },
    orderBy: { date: "desc" },
  })
  const lastLoggedPhase = lastPhaseLog?.note?.match(/phase:([IVX]+)/)?.[1] ?? null

  if (lastLoggedPhase && lastLoggedPhase !== phase.key) {
    phaseCrossed = true
    newPhaseKey = phase.key
    // Log the transition so it doesn't re-fire every day.
    await db.behaviourLog.create({
      data: {
        userId,
        type: "sbr-phase-transition",
        note: `phase:${phase.key} — portfolio crossed from Phase ${lastLoggedPhase} to Phase ${phase.key} (SGD ${totalValue.toLocaleString()})`,
      },
    })
    items.push({
      severity: "watch",
      title: `You've entered Phase ${phase.key} — ${phase.label}`,
      detail: `Portfolio has reached SGD ${Math.round(totalValue).toLocaleString()}, crossing into ${phase.label}. ${phase.body ?? "Check the new phase rules in the app."}`,
    })
  } else if (!lastLoggedPhase && totalValue > 0) {
    // First time running — seed the phase log.
    await db.behaviourLog.create({
      data: {
        userId,
        type: "sbr-phase-transition",
        note: `phase:${phase.key} — initial phase baseline (SGD ${totalValue.toLocaleString()})`,
      },
    })
  }

  const actionable = items.some((i) => i.severity === "breach" || i.severity === "watch")
    || (dayOfMonth >= 13 && dayOfMonth <= 15)

  return {
    user: { id: user.id, name: user.name, email: user.email },
    totalValue,
    phase: { key: phase.key, label: phase.label },
    nextMove,
    snapshotAgeDays,
    healthScore: health?.overall ?? 0,
    items,
    actionable,
    phaseCrossed,
    newPhaseKey,
  }
}
