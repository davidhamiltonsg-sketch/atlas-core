import { NextResponse } from "next/server"
import { revalidatePath } from "next/cache"
import { getSession } from "@/lib/session"
import { fetchFlexActivity } from "@/lib/ibkr-flex"
import { syncHoldingFromTrades, getUsdSgdRate } from "@/lib/holdings-sync"
import { db } from "@/lib/db"

export const maxDuration = 30

// POST — fetch activity from IBKR and return preview (no writes)
export async function POST() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })

  const token        = process.env.IBKR_FLEX_TOKEN
  const activityId   = process.env.IBKR_FLEX_QUERY_ID_ACTIVITY
  const positionsId  = process.env.IBKR_FLEX_QUERY_ID
  const queryId      = activityId ?? positionsId

  console.log("[sync-ibkr/activity] token present:", !!token, "activityId:", !!activityId, "fallback positionsId:", !!positionsId)

  if (!token || !queryId) {
    return NextResponse.json(
      { error: "IBKR_FLEX_TOKEN or IBKR_FLEX_QUERY_ID is not configured" },
      { status: 503 }
    )
  }

  if (!activityId) {
    console.warn("[sync-ibkr/activity] IBKR_FLEX_QUERY_ID_ACTIVITY not set — falling back to positions query. Add an Executions+CashTransactions FLEX query for full activity import.")
  }

  const result = await fetchFlexActivity(token, queryId)
  console.log("[sync-ibkr/activity] fetchFlexActivity result:", result.success ? "success" : `error: ${(result as { success: false; error: string }).error}`)

  if (!result.success) {
    // Return 422 (not 502) so Vercel doesn't flag it as a function crash in logs
    return NextResponse.json({ error: result.error }, { status: 422 })
  }

  // Fetch existing trade ibkr IDs to mark already-imported rows
  const existingTrades = await db.trade.findMany({
    where: { userId: session.userId, note: { contains: "[ibkr:" } },
    select: { note: true },
  })
  const importedTradeIds = new Set(
    existingTrades
      .map(t => t.note?.match(/\[ibkr:([^\]]+)\]/)?.[1])
      .filter(Boolean) as string[]
  )

  // Fetch existing dividend ibkr IDs
  const existingDivs = await db.dividend.findMany({
    where: { userId: session.userId, note: { contains: "[ibkr:" } },
    select: { note: true },
  })
  const importedDivIds = new Set(
    existingDivs
      .map(d => d.note?.match(/\[ibkr:([^\]]+)\]/)?.[1])
      .filter(Boolean) as string[]
  )

  // Get portfolio holdings for symbol matching
  const holdings = await db.holding.findMany({
    where: { userId: session.userId },
    select: { id: true, ticker: true },
  })
  const holdingMap = new Map(holdings.map(h => [h.ticker.toUpperCase(), h.id]))

  const executions = result.executions.map(e => ({
    ...e,
    alreadyImported: importedTradeIds.has(e.tradeID),
    holdingKnown: holdingMap.has(e.symbol.toUpperCase()),
  }))

  const dividends = result.dividends.map(d => ({
    ...d,
    alreadyImported: importedDivIds.has(d.transactionID),
    holdingId: holdingMap.get(d.symbol.toUpperCase()) ?? null,
    holdingKnown: holdingMap.has(d.symbol.toUpperCase()),
  }))

  return NextResponse.json({
    executions,
    dividends,
    accountId: result.accountId,
    newTrades: executions.filter(e => !e.alreadyImported && e.holdingKnown).length,
    newDividends: dividends.filter(d => !d.alreadyImported && d.holdingKnown).length,
  })
}

// PUT — confirm and write selected executions + dividends to DB
export async function PUT(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })

  const body = await req.json() as {
    executions: Array<{
      tradeID: string; symbol: string; buySell: "BUY" | "SELL"
      quantity: number; price: number; fxRate: number; tradeDate: string
    }>
    dividends: Array<{
      transactionID: string; symbol: string; amount: number
      payDate: string; description: string; holdingId: string | null
    }>
  }

  const holdings = await db.holding.findMany({
    where: { userId: session.userId },
    select: { id: true, ticker: true },
  })
  const holdingMap = new Map(holdings.map(h => [h.ticker.toUpperCase(), h.id]))

  let tradesImported = 0
  let dividendsImported = 0
  const affectedTickers = new Set<string>()

  // Import executions
  for (const e of body.executions ?? []) {
    // Skip if already imported
    const exists = await db.trade.findFirst({
      where: { userId: session.userId, note: { contains: `[ibkr:${e.tradeID}]` } },
    })
    if (exists) continue

    affectedTickers.add(e.symbol.toUpperCase())
    const amountSgd = e.quantity * e.price * e.fxRate
    const trade = await db.trade.create({
      data: {
        userId: session.userId,
        ticker: e.symbol.toUpperCase(),
        type: e.buySell,
        units: e.quantity,
        price: e.price,
        amount: amountSgd,
        fxRate: e.fxRate,
        date: parseFlexDate(e.tradeDate),
        note: `[ibkr:${e.tradeID}]`,
      },
    })

    // Auto-link BUY to ContributionRecord
    if (e.buySell === "BUY") {
      await db.contributionRecord.create({
        data: {
          userId: session.userId,
          amount: e.quantity * e.price, // USD
          date: parseFlexDate(e.tradeDate),
          note: `[trade:${trade.id}] [ibkr:${e.tradeID}] BUY ${e.quantity} ${e.symbol} @ $${e.price}`,
        },
      })
    }
    tradesImported++
  }

  // Import dividends
  for (const d of body.dividends ?? []) {
    const exists = await db.dividend.findFirst({
      where: { userId: session.userId, note: { contains: `[ibkr:${d.transactionID}]` } },
    })
    if (exists) continue

    const holdingId = d.holdingId ?? holdingMap.get(d.symbol.toUpperCase()) ?? null

    // Get units from latest snapshot for context
    let units = 0
    if (holdingId) {
      const snap = await db.snapshot.findFirst({
        where: { holdingId },
        orderBy: { date: "desc" },
      })
      units = snap?.units ?? 0
    }

    await db.dividend.create({
      data: {
        userId: session.userId,
        holdingId,
        ticker: d.symbol.toUpperCase(),
        amount: d.amount,
        units,
        paymentDate: parseFlexDate(d.payDate),
        note: `[ibkr:${d.transactionID}] ${d.description}`,
      },
    })
    dividendsImported++
  }

  // Apply imported executions to holdings so units/value flow through the app (creates new
  // tickers like IBIT, updates units for sells/buys) — every page stays in sync.
  if (affectedTickers.size > 0) {
    const fx = await getUsdSgdRate()
    for (const t of affectedTickers) await syncHoldingFromTrades(session.userId, t, fx)
    for (const p of ["/", "/trades", "/contributions", "/ytd", "/portfolio", "/governance", "/reports", "/forecast", "/holdings"]) {
      revalidatePath(p)
    }
  }

  return NextResponse.json({ tradesImported, dividendsImported })
}

// Parse IBKR date YYYYMMDD → Date
function parseFlexDate(s: string): Date {
  if (s.length === 8) {
    return new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`)
  }
  return new Date(s)
}
