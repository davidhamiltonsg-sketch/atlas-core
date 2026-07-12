import { NextResponse } from "next/server"
import { revalidatePath } from "next/cache"
import { getSession } from "@/lib/session"
import { fetchFlexPositions, isForexRow } from "@/lib/ibkr-flex"
import { ibkrCredentialsFor } from "@/lib/ibkr-config"
import { db } from "@/lib/db"
import { activePortfolioContext } from "@/lib/active-portfolio"
import { instrumentIdentity } from "@/lib/instrument-identity"
import { assertCanMutateOwner } from "@/lib/mutation-auth"
import { canSyncWithIbkr, recordIbkrSync, getTimeUntilNextIbkrSync, formatTimeRemaining } from "@/lib/ibkr-rate-limiter"

// Allow up to 30s for the FLEX polling loop
export const maxDuration = 30

export async function POST() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })
  const active = await activePortfolioContext(session)
  // Portfolio switching is owner-aware: use the active portfolio's IBKR account,
  // not merely the signed-in user's default portfolio.
  const { token, positionsQuery: queryId } = ibkrCredentialsFor(active.constitutionId)

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
  try { assertCanMutateOwner(session, active.owner.id) } catch { return NextResponse.json({ error: "Read-only portfolio access" }, { status: 403 }) }

  // ── Rate Limiting Check ──────────────────────────────────────────────────
  // Server-side enforcement: 6-hour minimum between IBKR syncs per user
  const canSync = await canSyncWithIbkr(active.owner.id)
  if (!canSync) {
    const timeUntilNext = await getTimeUntilNextIbkrSync(active.owner.id)
    const remaining = formatTimeRemaining(timeUntilNext)
    return NextResponse.json(
      { error: `IBKR sync rate limited: Please wait ${remaining} before syncing again` },
      { status: 429 }
    )
  }

  const body = await req.json() as {
    positions: Array<{ holdingId?: string | null; symbol?: string; units: number; markPrice: number; positionValue: number; costBasis?: number | null; unrealizedPnl?: number | null }>
  }

  if (!body.positions?.length) {
    return NextResponse.json({ error: "No positions provided" }, { status: 400 })
  }

  // Confirmation selects positions; it never authorises client-supplied money values.
  // Re-fetch the Flex report and persist only the fresh server-side rows.
  const {token,positionsQuery}=ibkrCredentialsFor(active.constitutionId)
  if(!token||!positionsQuery)return NextResponse.json({error:"IBKR positions query is not configured"},{status:503})
  const fresh=await fetchFlexPositions(token,positionsQuery)
  if(!fresh.success)return NextResponse.json({error:fresh.error},{status:502})
  const selected=new Map(body.positions.map(p=>[p.symbol?.trim().toUpperCase(),p.holdingId??null]))
  const authoritative=fresh.positions.filter(p=>selected.has(p.symbol.trim().toUpperCase()))
  if(!authoritative.length)return NextResponse.json({error:"Selected positions were not present in the refreshed IBKR report"},{status:409})

  let updated = 0
  let created = 0
  for (const pos of authoritative) {
    // Never persist a forex / cash balance as a holding (see isForexRow).
    if (pos.symbol && isForexRow(pos.symbol)) continue
    // Resolve the holding: by id, else by symbol, else CREATE it (new ticker like IBIT).
    let holdingId: string | null = null
    const requestedHoldingId=selected.get(pos.symbol.trim().toUpperCase())
    if (requestedHoldingId) {
      const h = await db.holding.findFirst({ where: { id: requestedHoldingId, userId: active.owner.id } })
      if (h) holdingId = h.id
    }
    if (!holdingId) {
      const identity=instrumentIdentity({symbol:pos.symbol,isin:pos.isin,cusip:pos.cusip,exchange:pos.exchange,conid:pos.conid})
      const sym = identity.ticker
      const existing = await db.holding.findFirst({ where: { userId: active.owner.id, ticker: sym } })
      if (existing) {
        holdingId = existing.id
      } else {
        const h = await db.holding.create({
          data: { userId: active.owner.id, ticker: sym, displayTicker:identity.displayTicker,instrumentKey:identity.instrumentKey,isin:identity.isin,cusip:identity.cusip,exchange:identity.exchange,ibkrConid:identity.ibkrConid,name: sym, targetPct: 0, hardCapPct: null, toleranceBand: 2.5, color: "#64748b" },
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

  for (const p of ["/", "/trades", "/ytd", "/portfolio", "/governance", "/reports", "/forecast", "/holdings", "/risk", "/mission-control"]) {
    revalidatePath(p)
  }

  // Record sync for rate limiting
  await recordIbkrSync(active.owner.id)

  return NextResponse.json({ updated, created })
}
