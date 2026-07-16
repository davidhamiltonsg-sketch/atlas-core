import { NextResponse } from "next/server"
import { revalidatePath } from "next/cache"
import { getSession } from "@/lib/session"
import { fetchFlexActivity, isForexRow } from "@/lib/ibkr-flex"
import { importIbkrActivityForUser } from "@/lib/holdings-sync"
import { CORE_TICKERS } from "@/lib/approved-alternatives"
import { ibkrCredentialsFor } from "@/lib/ibkr-config"
import { db } from "@/lib/db"
import { activePortfolioContext } from "@/lib/active-portfolio"
import { CONSTITUTIONS } from "@/lib/constitutions"
import { assertCanMutateOwner } from "@/lib/mutation-auth"

export const maxDuration = 30

// POST — fetch activity from IBKR and return preview (no writes)
export async function POST() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })
  const active = await activePortfolioContext(session)
  const allowed = new Set<string>([
    ...CORE_TICKERS,
    ...CONSTITUTIONS[active.constitutionId].funds.map((f) => f.ticker),
  ])
  const inScope = (sym: string) => allowed.has(sym.trim().toUpperCase())

  // Use the active portfolio owner's IBKR account so either authorised login can
  // switch portfolios without silently syncing the wrong broker account.
  const { token, activityQuery: activityId } = ibkrCredentialsFor(active.constitutionId)

  console.log("[sync-ibkr/activity] token present:", !!token, "activityId:", !!activityId)

  // No positions-query fallback: a positions report parses "successfully" with zero
  // trades/cash/dividends, so the import would report success while the contribution
  // and dividend ledgers stay frozen. Fail loudly with setup instructions instead.
  if (!token || !activityId) {
    return NextResponse.json(
      { error: "The IBKR activity feed is not configured for this portfolio. Set the Flex token and a dedicated Activity Flex query (Trades + Cash Transactions + Dividends) in the activity query variable, then retry." },
      { status: 503 }
    )
  }

  const result = await fetchFlexActivity(token, activityId)
  console.log("[sync-ibkr/activity] fetchFlexActivity result:", result.success ? "success" : `error: ${(result as { success: false; error: string }).error}`)

  if (!result.success) {
    // Return 422 (not 502) so Vercel doesn't flag it as a function crash in logs
    return NextResponse.json({ error: result.error }, { status: 422 })
  }

  // Fetch existing trade ibkr IDs to mark already-imported rows
  const existingTrades = await db.trade.findMany({
    where: { userId: active.owner.id, note: { contains: "[ibkr:" } },
    select: { note: true },
  })
  const importedTradeIds = new Set(
    existingTrades
      .map(t => t.note?.match(/\[ibkr:([^\]]+)\]/)?.[1])
      .filter(Boolean) as string[]
  )

  // Fetch existing dividend ibkr IDs
  const existingDivs = await db.dividend.findMany({
    where: { userId: active.owner.id, note: { contains: "[ibkr:" } },
    select: { note: true },
  })
  const importedDivIds = new Set(
    existingDivs
      .map(d => d.note?.match(/\[ibkr:([^\]]+)\]/)?.[1])
      .filter(Boolean) as string[]
  )

  // Get portfolio holdings for symbol matching
  const holdings = await db.holding.findMany({
    where: { userId: active.owner.id },
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
    ledger: result.ledger,
    accountId: result.accountId,
    newTrades: executions.filter(e => !e.alreadyImported).length,
    newDividends: dividends.filter(d => !d.alreadyImported).length,
    newLedgerEntries: result.ledger.length,
  })
}

// PUT — confirm and write selected executions + dividends to DB
export async function PUT(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })
  const active = await activePortfolioContext(session)
  try { assertCanMutateOwner(session, active.owner.id) } catch { return NextResponse.json({ error: "Read-only portfolio access" }, { status: 403 }) }

  const body = await req.json() as {
    executions: Array<{
      tradeID: string; symbol: string; buySell: "BUY" | "SELL"
      quantity: number; price: number; fxRate: number; tradeDate: string
    }>
    dividends: Array<{
      transactionID: string; symbol: string; amount: number
      payDate: string; description: string; holdingId: string | null
    }>
    ledger?: Array<{
      externalId: string; category: string; symbol: string; amount: number; currency: string
      amountBase: number | null; fxRate: number | null; date: string; description: string; rawType: string
    }>
  }

  // Client confirmation selects broker record IDs; it never supplies authoritative money.
  // Re-fetch the Flex report and persist only matching server-side records.
  const {token,activityQuery}=ibkrCredentialsFor(active.constitutionId)
  if(!token||!activityQuery)return NextResponse.json({error:"IBKR activity query is not configured"},{status:503})
  const fresh=await fetchFlexActivity(token,activityQuery)
  if(!fresh.success)return NextResponse.json({error:fresh.error},{status:422})
  const selectedTrades=new Set((body.executions??[]).map(x=>x.tradeID))
  const selectedDividends=new Set((body.dividends??[]).map(x=>x.transactionID))
  const selectedLedger=new Set((body.ledger??[]).map(x=>x.externalId))
  const allowed=new Set<string>([...CORE_TICKERS,...CONSTITUTIONS[active.constitutionId].funds.map(f=>f.ticker)])
  const executions=fresh.executions.filter(x=>selectedTrades.has(x.tradeID)&&allowed.has(x.symbol.trim().toUpperCase())&&!isForexRow(x.symbol))
  const dividends=fresh.dividends.filter(x=>selectedDividends.has(x.transactionID)&&allowed.has(x.symbol.trim().toUpperCase()))
  const ledger=fresh.ledger.filter(x=>selectedLedger.has(x.externalId))

  // Reuse the shared importer (same dedupe-by-id + holding-sync the cron uses), so the manual
  // and automated paths can never diverge. Forex rows are filtered inside the importer.
  const { trades: tradesImported, dividends: dividendsImported, ledger: ledgerImported, contributions: contributionsImported, tickers } =
    await importIbkrActivityForUser(active.owner.id, executions, dividends, ledger)

  if (tickers.length > 0) {
    for (const p of ["/", "/trades", "/contributions", "/ytd", "/portfolio", "/governance", "/reports", "/forecast", "/holdings"]) {
      revalidatePath(p)
    }
  }

  return NextResponse.json({ tradesImported, dividendsImported, ledgerImported, contributionsImported })
}
