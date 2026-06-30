"use server"

import { db } from "@/lib/db"
import { getSession } from "@/lib/session"
import { revalidatePath } from "next/cache"

// Restore a full JSON backup (produced by /api/export?type=backup) for the CURRENT user.
// Destructive — replaces this user's holdings, snapshots, trades, contributions, dividends,
// behaviour log and watchlist. Admin-only, and validates the backup shape before touching data.
export async function restoreBackup(jsonText: string) {
  const session = await getSession()
  if (!session) return { error: "Unauthenticated" }
  if (session.role !== "admin") return { error: "Admin only — restore is disabled for non-admin accounts." }

  let data: Record<string, unknown>
  try { data = JSON.parse(jsonText) } catch { return { error: "That file isn't valid JSON." } }
  if (data.format !== "atlas-core-backup" || !Array.isArray(data.holdings)) {
    return { error: "Not an Atlas Core backup file (missing format marker)." }
  }

  const userId = session.userId
  type Snap = { units: number; price: number; value: number; currency?: string; date: string }
  type H = { ticker: string; name: string; targetPct: number; hardCapPct?: number | null; toleranceBand?: number; color?: string; snapshots?: Snap[] }

  // Wipe this user's data (holding delete cascades its snapshots).
  await db.dividend.deleteMany({ where: { userId } })
  await db.trade.deleteMany({ where: { userId } })
  await db.contributionRecord.deleteMany({ where: { userId } })
  await db.behaviourLog.deleteMany({ where: { userId } })
  await db.watchlistItem.deleteMany({ where: { userId } })
  await db.holding.deleteMany({ where: { userId } })

  let holdings = 0, snapshots = 0, trades = 0
  for (const h of (data.holdings as H[])) {
    const created = await db.holding.create({ data: {
      userId, ticker: h.ticker, name: h.name, targetPct: h.targetPct,
      hardCapPct: h.hardCapPct ?? null, toleranceBand: h.toleranceBand ?? 2.5, color: h.color ?? "#6366f1",
    } })
    holdings++
    for (const s of (h.snapshots ?? [])) {
      await db.snapshot.create({ data: {
        holdingId: created.id, units: s.units, price: s.price, value: s.value,
        currency: s.currency ?? "SGD", date: new Date(s.date),
      } })
      snapshots++
    }
  }

  for (const t of ((data.trades as Array<Record<string, unknown>>) ?? [])) {
    await db.trade.create({ data: {
      userId, ticker: String(t.ticker), type: String(t.type), units: Number(t.units), price: Number(t.price),
      amount: Number(t.amount), fxRate: t.fxRate != null ? Number(t.fxRate) : 1.35,
      date: new Date(String(t.date)), note: (t.note as string) ?? null,
    } })
    trades++
  }
  for (const c of ((data.contributions as Array<Record<string, unknown>>) ?? [])) {
    await db.contributionRecord.create({ data: { userId, amount: Number(c.amount), date: new Date(String(c.date)), note: (c.note as string) ?? null } })
  }
  for (const d of ((data.dividends as Array<Record<string, unknown>>) ?? [])) {
    await db.dividend.create({ data: {
      userId, ticker: String(d.ticker), amount: Number(d.amount), units: Number(d.units),
      isDrip: Boolean(d.isDrip), dripUnits: d.dripUnits != null ? Number(d.dripUnits) : null,
      paymentDate: new Date(String(d.paymentDate)), note: (d.note as string) ?? null,
    } })
  }
  for (const w of ((data.watchlist as Array<Record<string, unknown>>) ?? [])) {
    try {
      await db.watchlistItem.create({ data: { userId, ticker: String(w.ticker), name: String(w.name), note: (w.note as string) ?? null, targetPct: w.targetPct != null ? Number(w.targetPct) : null } })
    } catch { /* skip duplicates */ }
  }

  for (const p of ["/", "/portfolio", "/ytd", "/trades", "/contributions", "/dividends", "/governance", "/reports", "/forecast", "/holdings", "/watchlist"]) revalidatePath(p)
  return { success: true as const, holdings, snapshots, trades }
}
