import { NextResponse } from "next/server"
import { getSession } from "@/lib/session"
import { db } from "@/lib/db"

export const dynamic = "force-dynamic"

/**
 * POST /api/admin/migrate-ucits
 *
 * One-shot (idempotent) data migration: renames all Holding, Trade, Dividend,
 * EtfLookThrough, and WatchlistItem records from US-domiciled tickers to their
 * UCITS equivalents. Admin-only. Safe to run more than once.
 *
 * VT → VWRA  ·  QQQM → EQQQ  ·  SMH → SEMI  ·  VWO → VFEA
 */

const TICKER_MAP = [
  { old: "VT",   new: "VWRA", name: "Vanguard FTSE All-World UCITS ETF" },
  { old: "QQQM", new: "EQQQ", name: "Invesco NASDAQ-100 UCITS ETF" },
  { old: "SMH",  new: "SEMI", name: "VanEck Semiconductor UCITS ETF" },
  { old: "VWO",  new: "VFEA", name: "Vanguard FTSE Emerging Markets UCITS ETF" },
] as const

export async function POST() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })
  if (session.role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 })

  const summary: Record<string, {
    holdingsRenamed: number; holdingsSkipped: number
    tradesUpdated: number; dividendsUpdated: number
    watchlistRenamed: number; watchlistSkipped: number
    lookThroughMigrated: boolean
  }> = {}

  for (const map of TICKER_MAP) {
    const key = `${map.old}→${map.new}`

    // ── Holding (@@unique [userId, ticker]) — must check per-row ──────────────
    const oldHoldings = await db.holding.findMany({ where: { ticker: map.old } })
    let holdingsRenamed = 0, holdingsSkipped = 0
    for (const h of oldHoldings) {
      const conflict = await db.holding.findUnique({
        where: { userId_ticker: { userId: h.userId, ticker: map.new } },
      })
      if (conflict) {
        holdingsSkipped++
      } else {
        await db.holding.update({
          where: { id: h.id },
          data: { ticker: map.new, name: map.name },
        })
        holdingsRenamed++
      }
    }

    // ── Trade (no userId+ticker unique constraint) ─────────────────────────────
    const { count: tradesUpdated } = await db.trade.updateMany({
      where: { ticker: map.old },
      data: { ticker: map.new },
    })

    // ── Dividend ───────────────────────────────────────────────────────────────
    const { count: dividendsUpdated } = await db.dividend.updateMany({
      where: { ticker: map.old },
      data: { ticker: map.new },
    })

    // ── WatchlistItem (@@unique [userId, ticker]) — must check per-row ─────────
    const oldWatchlist = await db.watchlistItem.findMany({ where: { ticker: map.old } })
    let watchlistRenamed = 0, watchlistSkipped = 0
    for (const w of oldWatchlist) {
      const conflict = await db.watchlistItem.findUnique({
        where: { userId_ticker: { userId: w.userId, ticker: map.new } },
      })
      if (conflict) {
        watchlistSkipped++
      } else {
        await db.watchlistItem.update({
          where: { id: w.id },
          data: { ticker: map.new, name: map.name },
        })
        watchlistRenamed++
      }
    }

    // ── EtfLookThrough (@@unique [ticker]) ────────────────────────────────────
    let lookThroughMigrated = false
    const oldLT = await db.etfLookThrough.findUnique({ where: { ticker: map.old } })
    if (oldLT) {
      const newLT = await db.etfLookThrough.findUnique({ where: { ticker: map.new } })
      if (!newLT) {
        await db.etfLookThrough.update({ where: { ticker: map.old }, data: { ticker: map.new } })
        lookThroughMigrated = true
      }
    }

    summary[key] = {
      holdingsRenamed, holdingsSkipped,
      tradesUpdated, dividendsUpdated,
      watchlistRenamed, watchlistSkipped,
      lookThroughMigrated,
    }
  }

  return NextResponse.json({ ok: true, summary })
}
