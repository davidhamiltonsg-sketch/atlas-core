import { db } from "@/lib/db"
import { CORE_TICKERS } from "@/lib/approved-alternatives"
import { fetchFlexPositions, fetchFlexActivity, isForexRow } from "@/lib/ibkr-flex"
import { constitutionIdForEmail } from "@/lib/constitutions"
import { CORE_DEFAULTS } from "@/lib/core-holdings"

// CORE_DEFAULTS (the governed-ticker seed metadata) lives in lib/core-holdings.ts so the
// contract checks can import it db-free and assert it matches the constitution's caps.

/**
 * Make sure every Atlas Core governed ticker exists as a holding for a user (creating any gaps
 * at 0 units). Atlas Core ONLY — silently returns 0 for SBR users to prevent cross-contamination.
 * Idempotent — only creates what is missing.
 */
export async function ensureCoreHoldings(userId: string): Promise<number> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { email: true } })
  if (!user || constitutionIdForEmail(user.email) !== "atlas-core") return 0

  let created = 0
  for (const ticker of CORE_TICKERS) {
    const existing = await db.holding.findFirst({ where: { userId, ticker } })
    if (existing) continue
    const d = CORE_DEFAULTS[ticker] ?? { name: ticker, targetPct: 0, hardCapPct: null, toleranceBand: 2.5, color: "#64748b" }
    const h = await db.holding.create({ data: { userId, ticker, ...d } })
    await upsertSnapshotToday(h.id, { units: 0, price: 0, value: 0 })
    created++
  }
  return created
}

const YF = "https://query1.finance.yahoo.com/v8/finance/chart/USDSGD=X?interval=1d&range=1d"

/**
 * Write at most ONE snapshot per holding per day. If today's snapshot exists, update it
 * in place; otherwise create one. Keeps the value-history chart and the DB clean instead
 * of accumulating dozens of intraday rows from refresh-on-open.
 */
export async function upsertSnapshotToday(
  holdingId: string,
  data: { units: number; price: number; value: number },
): Promise<void> {
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)
  const existing = await db.snapshot.findFirst({
    where: { holdingId, date: { gte: startOfDay } },
    orderBy: { date: "desc" },
  })
  if (existing) {
    await db.snapshot.update({
      where: { id: existing.id },
      data: { ...data, currency: "SGD", date: new Date() },
    })
  } else {
    await db.snapshot.create({
      data: { holdingId, ...data, currency: "SGD", date: new Date() },
    })
  }
}

export interface IbkrSyncResult { ok: boolean; reason?: string; users: number; snapshots: number }

/**
 * Automated snapshot refresh from IBKR Flex — for the scheduled cron, so the portfolio
 * never silently ages when the owner forgets to update it manually. Writes at most one
 * snapshot per holding per day (upsert). No-op (ok:false) when IBKR isn't configured.
 * Only matched tickers are updated; it never creates or removes holdings.
 */
export async function syncIbkrSnapshotsAllUsers(): Promise<IbkrSyncResult> {
  const token = process.env.IBKR_FLEX_TOKEN
  const queryId = process.env.IBKR_FLEX_QUERY_ID
  if (!token || !queryId) return { ok: false, reason: "IBKR not configured", users: 0, snapshots: 0 }

  const result = await fetchFlexPositions(token, queryId)
  if (!result.success) return { ok: false, reason: result.error, users: 0, snapshots: 0 }

  const bySymbol = new Map(result.positions.map((p) => [p.symbol.toUpperCase(), p]))
  const users = await db.user.findMany({ select: { id: true } })
  let snapshots = 0
  for (const u of users) {
    const holdings = await db.holding.findMany({ where: { userId: u.id } })
    for (const h of holdings) {
      const pos = bySymbol.get(h.ticker.toUpperCase())
      if (!pos) continue
      await upsertSnapshotToday(h.id, { units: pos.units, price: pos.markPrice, value: pos.positionValue })
      snapshots++
    }
  }
  return { ok: true, users: users.length, snapshots }
}

export async function getUsdSgdRate(): Promise<number> {
  try {
    const res = await fetch(YF, { headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store" })
    if (res.ok) {
      const d = await res.json()
      const rate = d?.chart?.result?.[0]?.meta?.regularMarketPrice
      if (rate && rate > 0) return rate
    }
  } catch {}
  return 1.35
}

/**
 * Make a holding reflect the trade log so every buy/sell feeds through the whole app.
 *
 * Net units for a ticker = Σ BUY units − Σ SELL units across ALL recorded trades. Creates the
 * holding if it's a new ticker (e.g. IBIT), then writes a fresh now-dated snapshot so the unit
 * count and value propagate to the dashboard, portfolio, governance caps, allocations, reports
 * and YTD. Idempotent: derives from the full trade log, so it stays correct after edits/deletes.
 */
export async function syncHoldingFromTrades(userId: string, ticker: string, fxRate?: number): Promise<void> {
  const fx = fxRate ?? (await getUsdSgdRate())
  const sym = ticker.toUpperCase()

  const trades = await db.trade.findMany({ where: { userId, ticker: sym }, orderBy: { date: "asc" } })
  const netUnits = Math.max(0, trades.reduce((s, t) => s + (t.type === "BUY" ? t.units : -t.units), 0))

  let holding = await db.holding.findFirst({ where: { userId, ticker: sym } })
  if (!holding) {
    if (netUnits <= 0) return
    holding = await db.holding.create({
      data: { userId, ticker: sym, name: sym, targetPct: 0, hardCapPct: null, toleranceBand: 2.5, color: "#64748b" },
    })
  }

  const latest = await db.snapshot.findFirst({ where: { holdingId: holding.id }, orderBy: { date: "desc" } })
  const lastTradePrice = trades.length ? trades[trades.length - 1].price : 0
  const markPrice = latest?.price && latest.price > 0 ? latest.price : lastTradePrice

  await upsertSnapshotToday(holding.id, { units: netUnits, price: markPrice, value: netUnits * markPrice * fx })
}

// ─── IBKR activity (trades + dividends) import ────────────────────────────────
// Parse IBKR date YYYYMMDD → Date.
export function parseFlexDate(s: string): Date {
  if (s.length === 8) return new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`)
  return new Date(s)
}

export interface FlexExecution {
  tradeID: string; symbol: string; buySell: "BUY" | "SELL"
  quantity: number; price: number; fxRate: number; tradeDate: string
}
export interface FlexDividend {
  transactionID: string; symbol: string; amount: number
  payDate: string; description: string; holdingId?: string | null
}
export interface ActivityImportResult { trades: number; dividends: number; tickers: string[] }

/**
 * Write a set of IBKR executions + dividends to ONE user's trade/contribution/dividend log,
 * then reflect the affected tickers into holdings. Idempotent — dedupes on the IBKR id
 * embedded in each note ([ibkr:<id>]), so re-running never double-imports. Shared by the
 * manual "Import Activity" modal (PUT) and the scheduled cron, so a monthly contribution is
 * captured automatically instead of only when the owner remembers to click Import.
 */
export async function importIbkrActivityForUser(
  userId: string,
  executions: FlexExecution[],
  dividends: FlexDividend[] = [],
): Promise<ActivityImportResult> {
  const holdings = await db.holding.findMany({ where: { userId }, select: { id: true, ticker: true } })
  const holdingMap = new Map(holdings.map((h) => [h.ticker.toUpperCase(), h.id]))

  let trades = 0
  let divs = 0
  const affected = new Set<string>()

  for (const e of executions) {
    if (isForexRow(e.symbol)) continue // forex/cash conversions are never trades
    const exists = await db.trade.findFirst({
      where: { userId, note: { contains: `[ibkr:${e.tradeID}]` } },
    })
    if (exists) continue

    affected.add(e.symbol.toUpperCase())
    const amountSgd = e.quantity * e.price * e.fxRate
    const trade = await db.trade.create({
      data: {
        userId, ticker: e.symbol.toUpperCase(), type: e.buySell,
        units: e.quantity, price: e.price, amount: amountSgd, fxRate: e.fxRate,
        date: parseFlexDate(e.tradeDate), note: `[ibkr:${e.tradeID}]`,
      },
    })
    if (e.buySell === "BUY") {
      await db.contributionRecord.create({
        data: {
          userId,
          // SGD — the contributions view and the monthly target are SGD, so the linked
          // contribution is stored in SGD (settled amount), not the USD trade notional.
          amount: amountSgd,
          date: parseFlexDate(e.tradeDate),
          note: `[trade:${trade.id}] [ibkr:${e.tradeID}] BUY ${e.quantity} ${e.symbol} @ $${e.price}`,
        },
      })
    }
    trades++
  }

  for (const d of dividends) {
    const exists = await db.dividend.findFirst({
      where: { userId, note: { contains: `[ibkr:${d.transactionID}]` } },
    })
    if (exists) continue
    const holdingId = d.holdingId ?? holdingMap.get(d.symbol.toUpperCase()) ?? null
    let units = 0
    if (holdingId) {
      const snap = await db.snapshot.findFirst({ where: { holdingId }, orderBy: { date: "desc" } })
      units = snap?.units ?? 0
    }
    await db.dividend.create({
      data: {
        userId, holdingId, ticker: d.symbol.toUpperCase(), amount: d.amount, units,
        paymentDate: parseFlexDate(d.payDate), note: `[ibkr:${d.transactionID}] ${d.description}`,
      },
    })
    divs++
  }

  if (affected.size > 0) {
    const fx = await getUsdSgdRate()
    for (const t of affected) await syncHoldingFromTrades(userId, t, fx)
  }
  return { trades, dividends: divs, tickers: [...affected] }
}

export interface IbkrActivitySyncResult { ok: boolean; reason?: string; users: number; trades: number; dividends: number }

/**
 * Automated activity refresh from IBKR Flex — for the scheduled cron, so monthly trades and
 * contributions are captured without anyone opening the manual import modal. ATLAS CORE ONLY:
 * the IBKR account is Atlas Core's, so equity executions are never written to Silicon Brick
 * Road users (isolation). Dedupe-by-id makes it safe to run on every cron tick. No-op when the
 * activity query isn't configured.
 */
export async function syncIbkrActivityAllUsers(): Promise<IbkrActivitySyncResult> {
  const token = process.env.IBKR_FLEX_TOKEN
  const activityId = process.env.IBKR_FLEX_QUERY_ID_ACTIVITY ?? process.env.IBKR_FLEX_QUERY_ID
  if (!token || !activityId) return { ok: false, reason: "IBKR activity not configured", users: 0, trades: 0, dividends: 0 }

  const result = await fetchFlexActivity(token, activityId)
  if (!result.success) return { ok: false, reason: result.error, users: 0, trades: 0, dividends: 0 }

  const users = await db.user.findMany({ select: { id: true, email: true } })
  let trades = 0
  let dividends = 0
  let touched = 0
  for (const u of users) {
    if (constitutionIdForEmail(u.email) !== "atlas-core") continue // never write IBKR equity to SBR
    const r = await importIbkrActivityForUser(u.id, result.executions, result.dividends)
    trades += r.trades
    dividends += r.dividends
    touched++
  }
  return { ok: true, users: touched, trades, dividends }
}
