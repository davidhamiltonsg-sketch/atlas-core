import { NextResponse } from "next/server"
import { revalidatePath } from "next/cache"
import { getSession } from "@/lib/session"
import { fetchFlexActivity, isForexRow } from "@/lib/ibkr-flex"
import { importIbkrActivityForUser } from "@/lib/holdings-sync"
import { CORE_TICKERS } from "@/lib/approved-alternatives"
import { db } from "@/lib/db"

const CORE = new Set<string>(CORE_TICKERS)
const inScope = (sym: string) => CORE.has(sym.trim().toUpperCase())

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

  // Show ONLY the Atlas Core governed universe. Forex conversions (SGD.HKD …) and any other
  // instrument held in the same IBKR account are excluded from both the preview and the write.
  const executions = result.executions
    .filter(e => !isForexRow(e.symbol) && inScope(e.symbol))
    .map(e => ({
      ...e,
      alreadyImported: importedTradeIds.has(e.tradeID),
      holdingKnown: holdingMap.has(e.symbol.toUpperCase()),
    }))

  const dividends = result.dividends
    .filter(d => inScope(d.symbol))
    .map(d => ({
      ...d,
      alreadyImported: importedDivIds.has(d.transactionID),
      holdingId: holdingMap.get(d.symbol.toUpperCase()) ?? null,
      holdingKnown: holdingMap.has(d.symbol.toUpperCase()),
    }))

  return NextResponse.json({
    executions,
    dividends,
    accountId: result.accountId,
    newTrades: executions.filter(e => !e.alreadyImported).length,
    newDividends: dividends.filter(d => !d.alreadyImported).length,
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

  // Reuse the shared importer (same dedupe-by-id + holding-sync the cron uses), so the manual
  // and automated paths can never diverge. Forex rows are filtered inside the importer.
  const { trades: tradesImported, dividends: dividendsImported, tickers } =
    await importIbkrActivityForUser(session.userId, body.executions ?? [], body.dividends ?? [])

  if (tickers.length > 0) {
    for (const p of ["/", "/trades", "/contributions", "/ytd", "/portfolio", "/governance", "/reports", "/forecast", "/holdings"]) {
      revalidatePath(p)
    }
  }

  return NextResponse.json({ tradesImported, dividendsImported })
}
