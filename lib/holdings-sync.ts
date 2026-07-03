import { db } from "@/lib/db"
import { CORE_TICKERS } from "@/lib/approved-alternatives"
import { fetchFlexPositions, fetchFlexActivity, isForexRow } from "@/lib/ibkr-flex"
import { constitutionIdForEmail, SILICON_BRICK_ROAD } from "@/lib/constitutions"
import { CORE_DEFAULTS } from "@/lib/core-holdings"
import {
  parseFlexDate, naturalKey, executionNaturalKey,
  selectExecutionsToImport, selectStaleDuplicateTrades, type ExistingTradeRow,
} from "@/lib/ingest-dedup"

// CORE_DEFAULTS (the governed-ticker seed metadata) lives in lib/core-holdings.ts so the
// contract checks can import it db-free and assert it matches the constitution's caps.

/**
 * Make sure every Atlas Core governed ticker exists as a holding for a user (creating any gaps
 * at 0 units), and keep each existing row's PRESENTATION (name, colour) in sync with the seed —
 * so a rebrand of the fund palette self-heals rows seeded under the old colours. Rule numbers
 * (targets/caps) are never touched here. Atlas Core ONLY — silently returns 0 for SBR users to
 * prevent cross-contamination. Idempotent.
 */
export async function ensureCoreHoldings(userId: string): Promise<number> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { email: true } })
  if (!user || constitutionIdForEmail(user.email) !== "atlas-core") return 0

  let created = 0
  for (const ticker of CORE_TICKERS) {
    const existing = await db.holding.findFirst({ where: { userId, ticker } })
    const d = CORE_DEFAULTS[ticker] ?? { name: ticker, targetPct: 0, hardCapPct: null, toleranceBand: 2.5, color: "#64748b" }
    if (existing) {
      if (existing.color !== d.color || existing.name !== d.name) {
        await db.holding.update({ where: { id: existing.id }, data: { color: d.color, name: d.name } })
      }
      continue
    }
    const h = await db.holding.create({ data: { userId, ticker, ...d } })
    await upsertSnapshotToday(h.id, { units: 0, price: 0, value: 0 })
    created++
  }
  return created
}

/**
 * Keep an SBR user's holding rows' PRESENTATION (name, colour) in sync with the Silicon Brick
 * Road registry — so a fund-palette rebrand self-heals rows provisioned under old colours.
 * SBR ONLY (silently returns for Atlas users); never touches rule numbers or snapshots.
 */
export async function ensureSbrPresentation(userId: string): Promise<void> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { email: true } })
  if (!user || constitutionIdForEmail(user.email) !== "silicon-brick-road") return
  for (const f of SILICON_BRICK_ROAD.funds) {
    const existing = await db.holding.findFirst({ where: { userId, ticker: f.ticker } })
    if (existing && (existing.color !== f.color || existing.name !== f.name)) {
      await db.holding.update({ where: { id: existing.id }, data: { color: f.color, name: f.name } })
    }
  }
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

  // Only ingest the Atlas Core governed universe. The IBKR account can also hold currency
  // conversions (e.g. SGD.HKD) and other instruments that are not part of the plan; importing
  // those pollutes the trade log, invents bogus contributions, and adds ghost holdings.
  const CORE = new Set<string>(CORE_TICKERS)
  const inScope = (sym: string) => CORE.has(sym.trim().toUpperCase())

  // Load the existing trade log ONCE and dedup in memory: by IBKR tradeID (normal re-run) AND by
  // natural key with multiplicity (safe when IBKR reissues tradeIDs for the same executions — see
  // selectExecutionsToImport). This is what stops a reconfigured Flex query from doubling the log.
  const existingTrades = await db.trade.findMany({
    where: { userId }, select: { id: true, note: true, ticker: true, type: true, units: true, price: true, date: true },
  })
  const existingTradeIDs = new Set<string>()
  const existingNaturalCounts = new Map<string, number>()
  const existingByKey = new Map<string, ExistingTradeRow[]>()
  for (const t of existingTrades) {
    const ibkrId = t.note?.match(/\[ibkr:([^\]]+)\]/)?.[1] ?? null
    if (ibkrId) existingTradeIDs.add(ibkrId)
    const k = naturalKey(t.ticker, t.type, t.units, t.price, t.date)
    existingNaturalCounts.set(k, (existingNaturalCounts.get(k) ?? 0) + 1)
    const arr = existingByKey.get(k) ?? []
    arr.push({ id: t.id, ibkrId, date: t.date })
    existingByKey.set(k, arr)
  }
  const scoped = executions.filter((e) => !isForexRow(e.symbol) && inScope(e.symbol))
  const toImport = selectExecutionsToImport(scoped, existingTradeIDs, existingNaturalCounts)

  let trades = 0
  let divs = 0
  const affected = new Set<string>()

  // Heal any already-doubled trades using this report as the source of truth (removes the
  // duplicates a prior re-import under new tradeIDs left behind). Only keys the report covers are
  // touched, so trades outside its window are safe.
  const batchNaturalCounts = new Map<string, number>()
  const batchTradeIDs = new Set<string>()
  for (const e of scoped) {
    batchNaturalCounts.set(executionNaturalKey(e), (batchNaturalCounts.get(executionNaturalKey(e)) ?? 0) + 1)
    batchTradeIDs.add(e.tradeID)
  }
  const staleIds = selectStaleDuplicateTrades(existingByKey, batchNaturalCounts, batchTradeIDs)
  if (staleIds.length > 0) {
    const removed = existingTrades.filter((t) => staleIds.includes(t.id))
    for (const t of removed) affected.add(t.ticker.toUpperCase())
    for (const id of staleIds) {
      await db.contributionRecord.deleteMany({ where: { userId, note: { contains: `[trade:${id}]` } } })
    }
    await db.trade.deleteMany({ where: { id: { in: staleIds } } })
  }

  for (const e of toImport) {
    affected.add(e.symbol.toUpperCase())
    const tradeDate = parseFlexDate(e.tradeDate)
    const amountSgd = e.quantity * e.price * e.fxRate
    const trade = await db.trade.create({
      data: {
        userId, ticker: e.symbol.toUpperCase(), type: e.buySell,
        units: e.quantity, price: e.price, amount: amountSgd, fxRate: e.fxRate,
        date: tradeDate, note: `[ibkr:${e.tradeID}]`,
      },
    })
    if (e.buySell === "BUY") {
      await db.contributionRecord.create({
        data: {
          userId,
          // SGD — the contributions view and the monthly target are SGD, so the linked
          // contribution is stored in SGD (settled amount), not the USD trade notional.
          amount: amountSgd,
          date: tradeDate,
          note: `[trade:${trade.id}] [ibkr:${e.tradeID}] BUY ${e.quantity} ${e.symbol} @ $${e.price}`,
        },
      })
    }
    trades++
  }

  for (const d of dividends) {
    if (!inScope(d.symbol)) continue // dividends only for Atlas Core governed holdings
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
  // Permanently remove any currency-conversion rows imported before the forex filter existed,
  // then heal any BUY trades that never got a linked contribution — so the trade log and the
  // Contributions page are both correct after an import, not just going forward.
  await cleanupForexTrades(userId)
  await backfillContributionsFromTrades(userId)
  return { trades, dividends: divs, tickers: [...affected] }
}

/**
 * Delete currency-conversion rows (e.g. SGD.HKD) and their auto-linked contributions from a
 * user's log. Safe: isForexRow only matches CCC.CCC symbols / CASH category, never a real ETF
 * ticker. Returns how many trades were removed.
 */
export async function cleanupForexTrades(userId: string): Promise<number> {
  const all = await db.trade.findMany({ where: { userId }, select: { id: true, ticker: true } })
  const forexIds = all.filter((t) => isForexRow(t.ticker)).map((t) => t.id)
  if (forexIds.length === 0) return 0
  for (const id of forexIds) {
    await db.contributionRecord.deleteMany({ where: { userId, note: { contains: `[trade:${id}]` } } })
  }
  await db.trade.deleteMany({ where: { id: { in: forexIds } } })
  const divs = await db.dividend.findMany({ where: { userId }, select: { id: true, ticker: true } })
  const forexDivIds = divs.filter((d) => isForexRow(d.ticker)).map((d) => d.id)
  if (forexDivIds.length) await db.dividend.deleteMany({ where: { id: { in: forexDivIds } } })
  return forexIds.length
}

/**
 * Ensure every governed BUY trade has a linked ContributionRecord. Idempotent: a contribution
 * is keyed to its trade by a [trade:<id>] note, so this only creates the ones that are missing.
 * Fixes the "contributions only show in the trade log" case for trades imported before the
 * auto-link, and skips forex / non-core rows so buffer-currency noise never becomes a
 * contribution. Returns the number of contributions created.
 */
export async function backfillContributionsFromTrades(userId: string): Promise<number> {
  const CORE = new Set<string>(CORE_TICKERS)
  const buys = await db.trade.findMany({ where: { userId, type: "BUY" }, select: { id: true, ticker: true, units: true, price: true, amount: true, date: true } })
  const existing = await db.contributionRecord.findMany({ where: { userId, note: { contains: "[trade:" } }, select: { note: true } })
  const linked = new Set(
    existing.map((c) => c.note?.match(/\[trade:([^\]]+)\]/)?.[1]).filter(Boolean) as string[],
  )

  let created = 0
  for (const t of buys) {
    const sym = t.ticker.toUpperCase()
    if (isForexRow(sym) || !CORE.has(sym)) continue // never turn forex / non-core into a contribution
    if (linked.has(t.id)) continue
    await db.contributionRecord.create({
      data: {
        userId,
        amount: t.amount, // SGD settled amount — matches how the Contributions view renders (S$)
        date: t.date,
        note: `[trade:${t.id}] BUY ${t.units} ${sym} @ $${t.price}`,
      },
    })
    created++
  }
  return created
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
