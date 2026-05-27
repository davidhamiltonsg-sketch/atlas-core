import { NextResponse } from "next/server"
import { getSession } from "@/lib/session"
import { fetchFlexPositions } from "@/lib/ibkr-flex"
import { db } from "@/lib/db"

// Allow up to 30s for the FLEX polling loop
export const maxDuration = 30

export async function POST() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })

  const token   = process.env.IBKR_FLEX_TOKEN
  const queryId = process.env.IBKR_FLEX_QUERY_ID

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
    where: { userId: session.userId },
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

  const body = await req.json() as {
    positions: Array<{ holdingId: string; units: number; markPrice: number; positionValue: number }>
  }

  if (!body.positions?.length) {
    return NextResponse.json({ error: "No positions provided" }, { status: 400 })
  }

  let updated = 0
  for (const pos of body.positions) {
    // Verify this holding belongs to the session user
    const holding = await db.holding.findFirst({
      where: { id: pos.holdingId, userId: session.userId },
    })
    if (!holding) continue

    await db.snapshot.create({
      data: {
        holdingId: pos.holdingId,
        units:     pos.units,
        price:     pos.markPrice,
        value:     pos.positionValue, // SGD from IBKR (base currency)
        currency:  "SGD",
        date:      new Date(),
      },
    })
    updated++
  }

  return NextResponse.json({ updated })
}
