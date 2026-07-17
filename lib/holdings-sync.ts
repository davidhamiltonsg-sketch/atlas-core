import { db } from "@/lib/db"
import { CORE_TICKERS } from "@/lib/approved-alternatives"
import { fetchFlexPositions, fetchFlexActivity, isForexRow, type FlexPosition } from "@/lib/ibkr-flex"
import { constitutionIdForEmail, SILICON_BRICK_ROAD } from "@/lib/constitutions"
import { CORE_DEFAULTS } from "@/lib/core-holdings"
import { instrumentIdentity } from "@/lib/instrument-identity"
import { recordDcaBankMovement } from "@/lib/dca-bank-service"
import { portfolioOwner } from "@/lib/active-portfolio"
import { ibkrCredentialsFor } from "@/lib/ibkr-config"
import { getCachedUsdSgdRate } from "@/lib/fx-cache"
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
    // No unique constraint on (userId, ticker) — find-first immediately before create keeps
    // concurrent callers (cron + page load) from minting duplicate Holding rows.
    const existing = await db.holding.findFirst({ where: { userId, ticker } })
    const d = CORE_DEFAULTS[ticker] ?? { name: ticker, targetPct: 0, hardCapPct: null, toleranceBand: 2.5, color: "#64748b" }
    if (existing) {
      if (existing.color !== d.color || existing.name !== d.name || existing.targetPct !== d.targetPct || existing.hardCapPct !== d.hardCapPct || existing.toleranceBand !== d.toleranceBand) {
        await db.holding.update({ where: { id: existing.id }, data: { color: d.color, name: d.name, targetPct: d.targetPct, hardCapPct: d.hardCapPct, toleranceBand: d.toleranceBand, instrumentStatus: "ACTIVE" } })
      }
      continue
    }
    const h = await db.holding.create({ data: { userId, ticker, ...d } })
    await upsertSnapshotToday(h.id, { units: 0, price: 0, value: 0 })
    created++
  }
  // Former governed rows remain visible for sale/cost-basis history but must not
  // receive new contributions under v10.5.
  await db.holding.updateMany({
    where: { userId, ticker: { notIn: [...CORE_TICKERS, "IBIT"] }, instrumentStatus: "ACTIVE" },
    data: { targetPct: 0, hardCapPct: null, instrumentStatus: "LEGACY" },
  })
  return created
}

/**
 * Keep an SBR user's holding rows in sync with the Silicon Brick Road registry:
 * presentation (name, colour) self-heals after a palette rebrand, and any governed fund
 * missing a row is CREATED at zero units with its constitutional target — so a fund added
 * by amendment (A35, v10.4) exists before the first IBKR sync instead of being minted by
 * the sync with a zero target. SBR ONLY (silently returns for Atlas users). Idempotent.
 */
export async function ensureSbrPresentation(userId: string): Promise<void> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { email: true } })
  if (!user || constitutionIdForEmail(user.email) !== "silicon-brick-road") return
  // One read up front: the common render-path case (everything already provisioned and
  // in sync) must cost a single query and zero writes.
  const rows = await db.holding.findMany({ where: { userId }, select: { id: true, ticker: true, name: true, color: true, targetPct: true, hardCapPct: true, toleranceBand: true } })
  const byTicker = new Map(rows.map((r) => [r.ticker, r]))
  for (const f of SILICON_BRICK_ROAD.funds) {
    // Constitutional soft band, per fund — NOT a hardcoded default: VWRA's wide 60–70
    // band (±5) is a deliberate constitutional choice and must survive seeding.
    const band = f.rangeHigh !== undefined && f.rangeLow !== undefined ? (f.rangeHigh - f.rangeLow) / 2 : 2.5
    const existing = byTicker.get(f.ticker)
    if (existing) {
      // Heal rule numbers as well as presentation (mirrors ensureCoreHoldings) — an
      // amendment that moves a target must reach rows seeded under the old numbers.
      if (
        existing.color !== f.color || existing.name !== f.name || existing.targetPct !== f.target ||
        existing.hardCapPct !== (f.hardCap ?? null) || existing.toleranceBand !== band
      ) {
        await db.holding.update({
          where: { id: existing.id },
          data: { color: f.color, name: f.name, targetPct: f.target, hardCapPct: f.hardCap ?? null, toleranceBand: band },
        })
      }
      continue
    }
    const h = await db.holding.create({
      data: {
        userId, ticker: f.ticker, name: f.name, targetPct: f.target,
        hardCapPct: f.hardCap ?? null, toleranceBand: band, color: f.color,
      },
    })
    await upsertSnapshotToday(h.id, { units: 0, price: 0, value: 0 })
  }

  // Retire redundant rows seeded under an OLD SBR mix (e.g. EQQQ 25% / SEMI 15%): a dead
  // row (no units, no value) outside the governed fund list must not keep a target — the
  // ledger hides dead rows only when their target is 0, so a stale target resurrects them
  // with phantom "underweight, redirect contributions" advice. Valued rows are never
  // touched (out-of-plan money stays visible in NAV), and snapshots/history are never
  // deleted — this only zeroes the rule numbers.
  const governedTickers = new Set<string>(SILICON_BRICK_ROAD.funds.map((f) => f.ticker))
  const staleRows = await db.holding.findMany({
    where: { userId, ticker: { notIn: [...governedTickers] }, OR: [{ targetPct: { not: 0 } }, { hardCapPct: { not: null } }] },
    include: { snapshots: { orderBy: { date: "desc" }, take: 1 } },
  })
  for (const h of staleRows) {
    const latest = h.snapshots[0]
    const dead = !latest || ((latest.units ?? 0) === 0 && (latest.value ?? 0) === 0)
    if (dead) {
      await db.holding.update({ where: { id: h.id }, data: { targetPct: 0, hardCapPct: null } })
    }
  }
}

/**
 * Write at most ONE snapshot per holding per day. If today's snapshot exists, update it
 * in place; otherwise create one. Keeps the value-history chart and the DB clean instead
 * of accumulating dozens of intraday rows from refresh-on-open.
 *
 * CURRENCY DISCIPLINE — `value` is authoritative SGD; `price` carries no currency
 * guarantee (instrument-currency marks, trading-currency quotes, or historical
 * SGD-conflated imports all exist in the column). Displays must derive S$ per-unit
 * from value/units, and writers whose price/value pairs can disagree (screenshot
 * import, IBKR-position refresh) must pass the price through valueConsistentPrice
 * (lib/unit-price.ts) so a misread price can never contradict the stored value.
 */
export async function upsertSnapshotToday(
  holdingId: string,
  data: { units: number; price: number; value: number; costBasis?: number | null; unrealizedPnl?: number | null },
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
    // Cost basis / unrealised P&L don't move on a plain price refresh. When the caller
    // omits them (e.g. refreshLivePrices only ever passes units/price/value), carry
    // forward the prior snapshot's values instead of letting Prisma default a brand-new
    // row to null — otherwise the first refresh of every calendar day wiped cost basis
    // to null and the UI permanently read "Needs reconciliation" until the next full
    // IBKR sync. An explicitly-passed value (including null, e.g. zeroing a closed
    // position) is never overridden.
    const carryForward: { costBasis?: number | null; unrealizedPnl?: number | null } = {}
    if (!("costBasis" in data) || !("unrealizedPnl" in data)) {
      const prior = await db.snapshot.findFirst({ where: { holdingId }, orderBy: { date: "desc" } })
      if (prior) {
        if (!("costBasis" in data)) carryForward.costBasis = prior.costBasis
        if (!("unrealizedPnl" in data)) carryForward.unrealizedPnl = prior.unrealizedPnl
      }
    }
    await db.snapshot.create({
      data: { holdingId, ...carryForward, ...data, currency: "SGD", date: new Date() },
    })
  }
}

export interface IbkrSyncResult { ok: boolean; reason?: string; users: number; snapshots: number }

async function brokerPortfolioOwners(){
  const [atlas,sbr]=await Promise.all([portfolioOwner("atlas-core"),portfolioOwner("silicon-brick-road")])
  return [...new Map([atlas,sbr].filter((u):u is NonNullable<typeof u>=>!!u).map(u=>[u.id,{id:u.id,email:u.email}])).values()]
}

/**
 * Given an already-fetched (or already-parsed, e.g. from an emailed Flex report) set of
 * open positions, write them into one user's holdings. Idempotent (one snapshot per
 * holding per day, via upsertSnapshotToday). A complete open-position report is
 * authoritative: a previously open holding absent from it is closed at zero so stale
 * snapshots cannot inflate NAV after a full sale. Only matched tickers are updated; this
 * never creates or removes holdings. Returns the number of snapshots written.
 *
 * Factored out of syncIbkrSnapshotsAllUsers so both the polling cron AND the Flex
 * email-delivery webhook (app/api/webhooks/ibkr-flex-email) share one persistence path —
 * the webhook has no SendRequest/GetStatement round trip to make, it already has the XML.
 */
export async function applyFlexPositionsForUser(userId: string, positions: FlexPosition[]): Promise<number> {
  let snapshots = 0
  const identified = positions.map((p) => ({ p, identity: instrumentIdentity({ symbol: p.symbol, isin: p.isin, cusip: p.cusip, exchange: p.exchange, conid: p.conid }) }))
  const bySymbol = new Map(identified.flatMap((x) => [[x.identity.ticker, x], [x.identity.displayTicker, x]]))
  const holdings = await db.holding.findMany({ where: { userId }, include: { snapshots: { orderBy: { date: "desc" }, take: 1 } } })
  const matchedHoldingIds = new Set<string>()
  for (const h of holdings) {
    const matched = bySymbol.get(h.ticker.toUpperCase())
    if (!matched) continue
    const { p: pos, identity } = matched
    matchedHoldingIds.add(h.id)
    await db.holding.update({ where: { id: h.id }, data: {
      displayTicker: identity.displayTicker, instrumentKey: identity.instrumentKey,
      isin: identity.isin, cusip: identity.cusip, exchange: identity.exchange, ibkrConid: identity.ibkrConid,
      instrumentStatus: ["VT", "QQQM", "VWO", "SMH.US", "GBTC"].includes(identity.ticker) ? "LEGACY" : "ACTIVE",
    } })
    await upsertSnapshotToday(h.id, {
      units: pos.units, price: pos.markPrice, value: pos.positionValue,
      costBasis: pos.costBasis, unrealizedPnl: pos.unrealizedPnl,
    })
    snapshots++
  }
  for (const h of holdings) {
    if (!matchedHoldingIds.has(h.id) && (h.snapshots[0]?.units ?? 0) > 0) {
      await upsertSnapshotToday(h.id, { units: 0, price: 0, value: 0, costBasis: 0, unrealizedPnl: 0 })
      await db.holding.update({ where: { id: h.id }, data: { instrumentStatus: "CLOSED" } })
      snapshots++
    }
  }
  return snapshots
}

/**
 * Automated snapshot refresh from IBKR Flex — for the scheduled cron, so the portfolio
 * never silently ages when the owner forgets to update it manually. No-op (ok:false)
 * when IBKR isn't configured.
 */
export async function syncIbkrSnapshotsAllUsers(): Promise<IbkrSyncResult> {
  const users = await brokerPortfolioOwners()
  const reports = new Map<string, Awaited<ReturnType<typeof fetchFlexPositions>>>()
  let snapshots = 0
  let usersSynced = 0
  const errors: string[] = []
  for (const u of users) {
    const isSbr = constitutionIdForEmail(u.email) === "silicon-brick-road"
    const token = isSbr ? process.env.IBKR_SBR_FLEX_TOKEN : process.env.IBKR_FLEX_TOKEN
    const queryId = isSbr ? process.env.IBKR_SBR_FLEX_QUERY_ID : process.env.IBKR_FLEX_QUERY_ID
    if (!token || !queryId) continue
    const reportKey = `${isSbr ? "sbr" : "atlas"}:${queryId}`
    let result = reports.get(reportKey)
    if (!result) {
      result = await fetchFlexPositions(token, queryId)
      reports.set(reportKey, result)
    }
    if (!result.success) {
      errors.push(`${isSbr ? "SBR" : "Atlas"}: ${result.error}`)
      continue
    }
    snapshots += await applyFlexPositionsForUser(u.id, result.positions)
    usersSynced++
  }
  if (usersSynced === 0) return { ok: false, reason: errors.join("; ") || "IBKR not configured", users: 0, snapshots: 0 }
  return { ok: true, reason: errors.length ? errors.join("; ") : undefined, users: usersSynced, snapshots }
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
  const fx = fxRate ?? (await getCachedUsdSgdRate())
  const sym = ticker.toUpperCase()

  const trades = await db.trade.findMany({ where: { userId, ticker: sym }, orderBy: { date: "asc" } })
  const netUnits = Math.max(0, trades.reduce((s, t) => s + (t.type === "BUY" ? t.units : -t.units), 0))

  // No unique constraint on (userId, ticker) — find-first immediately before create.
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
  commission?: number; realizedPnl?: number | null; netCash?: number | null
  isin?: string; cusip?: string; exchange?: string; conid?: string
}
export interface FlexDividend {
  transactionID: string; symbol: string; amount: number
  payDate: string; description: string; holdingId?: string | null
}
export interface FlexLedgerEntry {
  externalId: string; category: string; symbol: string; amount: number; currency: string
  amountBase: number | null; fxRate: number | null; date: string; description: string; rawType: string
}
export interface ActivityImportResult { trades: number; dividends: number; ledger: number; contributions: number; tickers: string[] }

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
  ledgerEntries: FlexLedgerEntry[] = [],
): Promise<ActivityImportResult> {
  const hasAuthoritativeCash = ledgerEntries.some((e) => e.category === "DEPOSIT" || e.category === "WITHDRAWAL")
  const holdings = await db.holding.findMany({ where: { userId }, select: { id: true, ticker: true } })
  const holdingMap = new Map(holdings.map((h) => [h.ticker.toUpperCase(), h.id]))

  // Only ingest the Atlas Core governed universe. The IBKR account can also hold currency
  // conversions (e.g. SGD.HKD) and other instruments that are not part of the plan; importing
  // those pollutes the trade log, invents bogus contributions, and adds ghost holdings.
  const owner = await db.user.findUnique({ where: { id: userId }, select: { email: true } })
  const constitutionId = owner ? constitutionIdForEmail(owner.email) : "atlas-core"
  const governed = constitutionId === "silicon-brick-road"
    ? SILICON_BRICK_ROAD.funds.map((f) => f.ticker)
    : CORE_TICKERS
  const ALLOWED = new Set<string>([...governed, ...holdingMap.keys()])
  const inScope = (sym: string) => ALLOWED.has(sym.trim().toUpperCase())

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
  let ledgerImported = 0
  let contributionsImported = 0
  const affected = new Set<string>()
  const bankMovements: Array<Parameters<typeof recordDcaBankMovement>[0]> = []

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
    const identity = instrumentIdentity({ symbol: e.symbol, isin: e.isin, cusip: e.cusip, exchange: e.exchange, conid: e.conid })
    affected.add(identity.ticker)
    const tradeDate = parseFlexDate(e.tradeDate)
    const amountSgd = e.quantity * e.price * e.fxRate
    const trade = await db.trade.create({
      data: {
        userId, ticker: identity.ticker, type: e.buySell,
        instrumentKey: identity.instrumentKey, isin: identity.isin, cusip: identity.cusip,
        exchange: identity.exchange, ibkrConid: identity.ibkrConid,
        units: e.quantity, price: e.price, amount: amountSgd, fxRate: e.fxRate,
        commission: e.commission ?? 0,
        realizedPnl: e.realizedPnl ?? null,
        netCash: e.netCash ?? null,
        date: tradeDate, note: `[ibkr:${e.tradeID}]`,
      },
    })
    // Only purchases consume the contribution carry-forward bank. Sale proceeds remain
    // brokerage cash until a separately reported cash movement authoritatively credits it.
    if (e.buySell === "BUY") bankMovements.push({
      userId, constitutionId, currency: "SGD", type: "PURCHASE",
      amount: -(amountSgd + (e.commission ?? 0) * e.fxRate), externalId: `ibkr-trade:${e.tradeID}`,
      description: `${e.buySell} ${e.quantity} ${identity.displayTicker}`, date: tradeDate,
    })
    // A "contribution" is new cash put to work, not any security purchase — buying with
    // proceeds from a same/recent sale (a rebalance) isn't new money. SELL trades create an
    // offsetting NEGATIVE contribution so net BUY-minus-SELL is what the Contributions page
    // totals, instead of gross BUY value alone (which double-counts every rebalance).
    if (!hasAuthoritativeCash && (e.buySell === "BUY" || e.buySell === "SELL")) {
      const sign = e.buySell === "BUY" ? 1 : -1
      await db.contributionRecord.create({
        data: {
          userId,
          // SGD — the contributions view and the monthly target are SGD, so the linked
          // contribution is stored in SGD (settled amount), not the USD trade notional.
          amount: sign * amountSgd,
          date: tradeDate,
          note: `[trade:${trade.id}] [ibkr:${e.tradeID}] ${e.buySell} ${e.quantity} ${e.symbol} @ $${e.price}`,
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

  // Cash movements and adjustments are a separate immutable ledger. Actual deposits and
  // withdrawals—not security purchases—are the authoritative contribution source.
  for (const entry of ledgerEntries) {
    const exists = await db.ibkrLedgerEntry.findUnique({
      where: { userId_externalId: { userId, externalId: entry.externalId } },
    })
    if (exists) continue
    const amountBase = entry.amountBase ?? (entry.fxRate ? entry.amount * entry.fxRate : null)
    await db.ibkrLedgerEntry.create({
      data: {
        userId, externalId: entry.externalId, category: entry.category,
        symbol: entry.symbol || null, amount: entry.amount, currency: entry.currency || "",
        amountBase, fxRate: entry.fxRate, date: parseFlexDate(entry.date),
        description: entry.description || null, rawType: entry.rawType || null,
      },
    })
    ledgerImported++
    if (entry.category === "DEPOSIT" || entry.category === "WITHDRAWAL") {
      const signed = entry.category === "WITHDRAWAL" ? -Math.abs(amountBase ?? entry.amount) : Math.abs(amountBase ?? entry.amount)
      await db.contributionRecord.create({
        data: {
          userId, amount: signed, date: parseFlexDate(entry.date),
          note: `[ibkr-cash:${entry.externalId}] ${entry.description || entry.category}`,
        },
      })
      contributionsImported++
      bankMovements.push({
        userId, constitutionId, currency: "SGD", type: "CONTRIBUTION", amount: signed,
        externalId: `ibkr-cash:${entry.externalId}`, description: entry.description || entry.category,
        date: parseFlexDate(entry.date),
      })
    }
  }

  // Replay the immutable sub-ledger in economic order, independent of which Flex section
  // happened to be parsed first. Same-day cash credits precede purchases.
  bankMovements.sort((a,b) => {
    const time=(a.date?.getTime()??0)-(b.date?.getTime()??0)
    if(time!==0)return time
    return a.type==="CONTRIBUTION"&&b.type!=="CONTRIBUTION"?-1:b.type==="CONTRIBUTION"&&a.type!=="CONTRIBUTION"?1:0
  })
  for(const movement of bankMovements) await recordDcaBankMovement(movement)

  if (affected.size > 0) {
    const fx = await getCachedUsdSgdRate()
    for (const t of affected) await syncHoldingFromTrades(userId, t, fx)
  }
  // Permanently remove any currency-conversion rows imported before the forex filter existed,
  // then heal any BUY trades that never got a linked contribution — so the trade log and the
  // Contributions page are both correct after an import, not just going forward.
  await cleanupForexTrades(userId)
  if (!hasAuthoritativeCash) await backfillContributionsFromTrades(userId)
  return { trades, dividends: divs, ledger: ledgerImported, contributions: contributionsImported, tickers: [...affected] }
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
 * Ensure every governed BUY or SELL trade has a linked ContributionRecord — positive for a
 * BUY, negative for a SELL, so net BUY-minus-SELL is what the Contributions page totals,
 * not gross BUY value (which would double-count every rebalance as new cash). Idempotent: a
 * contribution is keyed to its trade by a [trade:<id>] note, so this only creates the ones
 * that are missing. Fixes the "contributions only show in the trade log" case for trades
 * imported before the auto-link, and skips forex / non-core rows so buffer-currency noise
 * never becomes a contribution. Returns the number of contributions created.
 */
export async function backfillContributionsFromTrades(userId: string): Promise<number> {
  const CORE = new Set<string>(CORE_TICKERS)
  const trades = await db.trade.findMany({ where: { userId, type: { in: ["BUY", "SELL"] } }, select: { id: true, ticker: true, type: true, units: true, price: true, amount: true, date: true } })
  const existing = await db.contributionRecord.findMany({ where: { userId, note: { contains: "[trade:" } }, select: { note: true } })
  const linked = new Set(
    existing.map((c) => c.note?.match(/\[trade:([^\]]+)\]/)?.[1]).filter(Boolean) as string[],
  )

  let created = 0
  for (const t of trades) {
    const sym = t.ticker.toUpperCase()
    if (isForexRow(sym) || !CORE.has(sym)) continue // never turn forex / non-core into a contribution
    if (linked.has(t.id)) continue
    const sign = t.type === "BUY" ? 1 : -1
    await db.contributionRecord.create({
      data: {
        userId,
        amount: sign * t.amount, // SGD settled amount — matches how the Contributions view renders (S$)
        date: t.date,
        note: `[trade:${t.id}] ${t.type} ${t.units} ${sym} @ $${t.price}`,
      },
    })
    created++
  }
  return created
}

export interface IbkrActivitySyncResult { ok: boolean; reason?: string; users: number; trades: number; dividends: number; ledger: number; contributions: number }

/**
 * Automated activity refresh from IBKR Flex — for the scheduled cron, so monthly trades and
 * contributions are captured without anyone opening the manual import modal. ATLAS CORE ONLY:
 * the IBKR account is Atlas Core's, so equity executions are never written to Silicon Brick
 * Road users (isolation). Dedupe-by-id makes it safe to run on every cron tick. No-op when the
 * activity query isn't configured.
 */
export async function syncIbkrActivityAllUsers(): Promise<IbkrActivitySyncResult> {
  const users = await brokerPortfolioOwners()
  const reports = new Map<string, Awaited<ReturnType<typeof fetchFlexActivity>>>()
  let trades = 0
  let dividends = 0
  let ledger = 0
  let contributions = 0
  let touched = 0
  const errors: string[] = []
  for (const u of users) {
    const isSbr = constitutionIdForEmail(u.email) === "silicon-brick-road"
    const { token, activityQuery: activityId } = ibkrCredentialsFor(isSbr ? "silicon-brick-road" : "atlas-core")
    // No positions-query fallback: a positions report parses "successfully" with zero
    // trades/cash/dividends, freezing the contribution and dividend ledgers while
    // holdings keep moving. Better an explicit error than a silent zero import.
    if (!token || !activityId) {
      errors.push(`${isSbr ? "SBR" : "Atlas"}: activity feed not configured (${isSbr ? "IBKR_SBR_FLEX_TOKEN + IBKR_SBR_FLEX_QUERY_ID_ACTIVITY" : "IBKR_FLEX_TOKEN + IBKR_FLEX_QUERY_ID_ACTIVITY"})`)
      continue
    }
    const reportKey = `${isSbr ? "sbr" : "atlas"}:${activityId}`
    let result = reports.get(reportKey)
    if (!result) {
      result = await fetchFlexActivity(token, activityId)
      reports.set(reportKey, result)
    }
    if (!result.success) {
      errors.push(`${isSbr ? "SBR" : "Atlas"}: ${result.error}`)
      continue
    }
    const r = await importIbkrActivityForUser(u.id, result.executions, result.dividends, result.ledger)
    trades += r.trades
    dividends += r.dividends
    ledger += r.ledger
    contributions += r.contributions
    touched++
  }
  if (touched === 0) return { ok: false, reason: errors.join("; ") || "IBKR activity not configured", users: 0, trades: 0, dividends: 0, ledger: 0, contributions: 0 }
  return { ok: true, reason: errors.length ? errors.join("; ") : undefined, users: touched, trades, dividends, ledger, contributions }
}
