import { NextResponse } from "next/server"
import { revalidatePath } from "next/cache"
import { getSession } from "@/lib/session"
import { fetchFlexPositions, isForexRow } from "@/lib/ibkr-flex"
import { db } from "@/lib/db"
import { activePortfolioContext } from "@/lib/active-portfolio"

// Allow up to 30s for the FLEX polling loop
export const maxDuration = 30

export async function POST() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })
  const active = await activePortfolioContext(session)
  const isSbr = active.constitutionId === "silicon-brick-road"

  const token = isSbr ? process.env.IBKR_SBR_FLEX_TOKEN : process.env.IBKR_FLEX_TOKEN
  const queryId = isSbr ? process.env.IBKR_SBR_FLEX_QUERY_ID : process.env.IBKR_FLEX_QUERY_ID

  if (!token || !queryId) {
    return NextResponse.json(
      { error: "IBKR_FLEX_TOKEN or IBKR_FLEX_QUERY_ID is not configured" },
      { status: 503 }
    )
  }

  const result = await fetchFlexPositions(token, queryId)
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 502 })
  }

  // Fetch user holdings to match symbols
  const holdings = await db.holding.findMany({
    where: { userId: active.owner.id },
    include: { snapshots: { orderBy: { date: "desc" }, take: 1 } },
  })

  const holdingMap = new Map(holdings.map((h) => [h.ticker.toUpperCase(), h]))

  // Build preview payload — let the client confirm before writing
  const positions = result.positions.map((pos) => {
    const holding = holdingMap.get(pos.symbol.toUpperCase())
    return {
      symbol:        pos.symbol,
      units:         pos.units,
      markPrice:     pos.markPrice,
      positionValue: pos.positionValue,
      currency:      pos.currency,
      costBasis:     pos.costBasis,
      unrealizedPnl: pos.unrealizedPnl,
      holdingId:     holding?.id ?? null,
      matched:       !!holding,
      prevUnits:     holding?.snapshots[0]?.units ?? null,
      prevPrice:     holding?.snapshots[0]?.price ?? null,
    }
  })

  return NextResponse.json({
    positions,
    accountId:  result.accountId,
    reportDate: result.reportDate,
  })
}

// Confirm endpoint — called after user reviews the preview
export async function PUT(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })
  const active = await activePortfolioContext(session)

  const body = await req.json() as {
    positions: Array<{ holdingId?: string | null; symbol?: string; units: number; markPrice: number; positionValue: number; costBasis?: number | null; unrealizedPnl?: number | null }>
  }

  if (!body.positions?.length) {
    return NextResponse.json({ error: "No positions provided" }, { status: 400 })
  }

  let updated = 0
  let created = 0
  for (const pos of body.positions) {
    // Never persist a forex / cash balance as a holding (see isForexRow).
    if (pos.symbol && isForexRow(pos.symbol)) continue
    // Resolve the holding: by id, else by symbol, else CREATE it (new ticker like IBIT).
    let holdingId: string | null = null
    if (pos.holdingId) {
      const h = await db.holding.findFirst({ where: { id: pos.holdingId, userId: active.owner.id } })
      if (h) holdingId = h.id
    }
    if (!holdingId) {
      const sym = pos.symbol?.trim().toUpperCase()
      if (!sym) continue
      const existing = await db.holding.findFirst({ where: { userId: active.owner.id, ticker: sym } })
      if (existing) {
        holdingId = existing.id
      } else {
        const h = await db.holding.create({
          data: { userId: active.owner.id, ticker: sym, name: sym, targetPct: 0, hardCapPct: null, toleranceBand: 2.5, color: "#64748b" },
        })
        holdingId = h.id
        created++
      }
    }

    await db.snapshot.create({
      data: {
        holdingId,
        units:     pos.units,
        price:     pos.markPrice,
        value:     pos.positionValue, // SGD from IBKR (base currency)
        currency:  "SGD",
        costBasis: pos.costBasis ?? null,
        unrealizedPnl: pos.unrealizedPnl ?? null,
        date:      new Date(),
      },
    })
    updated++
  }

  for (const p of ["/", "/trades", "/ytd", "/portfolio", "/governance", "/reports", "/forecast", "/holdings"]) {
    revalidatePath(p)
  }

  return NextResponse.json({ updated, created })
}
