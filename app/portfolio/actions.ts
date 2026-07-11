"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { getSession } from "@/lib/session"
import { fetchFlexPositions } from "@/lib/ibkr-flex"
import { upsertSnapshotToday, ensureCoreHoldings, ensureSbrPresentation } from "@/lib/holdings-sync"
import { constitutionIdForEmail } from "@/lib/constitutions"
import Anthropic from "@anthropic-ai/sdk"

// Yahoo Finance ticker overrides for non-US instruments held by SBR users.
// VWRA trades on the London Stock Exchange (price in USD); A35 trades on SGX (price in SGD).
const YF_TICKER_MAP: Record<string, string> = { VWRA: "VWRA.L", VFEA: "VFEA.L", EQQQ: "EQQQ.L", SEMI: "SEMI.L", A35: "A35.SI" }
const YF_REVERSE_MAP = Object.fromEntries(Object.entries(YF_TICKER_MAP).map(([k, v]) => [v, k]))
// Tickers whose Yahoo Finance price is already in SGD (no USD→SGD conversion needed).
const YF_SGD_PRICED = new Set(["A35.SI"])

const YF_HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]

// Fetch live USD→SGD exchange rate from Yahoo Finance (query1 → query2 fallback)
async function getUsdSgdRate(): Promise<number> {
  for (const host of YF_HOSTS) {
    try {
      const res = await fetch(
        `https://${host}/v8/finance/chart/USDSGD=X?interval=1d&range=1d`,
        { headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store" }
      )
      if (res.ok) {
        const d = await res.json()
        const rate = d?.chart?.result?.[0]?.meta?.regularMarketPrice
        if (rate && rate > 0) return rate
      }
    } catch {}
  }
  return 1.35 // hardcoded fallback when both hosts unavailable
}

// Manual update: create new snapshots for one or more holdings.
// Pass currency: "SGD" for SGD-priced instruments (e.g. A35) to skip USD→SGD conversion.
export async function updateHoldingsManually(
  updates: Array<{ holdingId: string; units: number; price: number; currency?: "USD" | "SGD" }>
) {
  const session = await getSession()
  if (!session) throw new Error("Unauthenticated")

  const usdSgdRate = await getUsdSgdRate()

  for (const u of updates) {
    // Verify holding belongs to this user
    const holding = await db.holding.findFirst({
      where: { id: u.holdingId, userId: session.userId },
    })
    if (!holding) continue

    const fxMultiplier = u.currency === "SGD" ? 1 : usdSgdRate
    await db.snapshot.create({
      data: {
        holdingId: u.holdingId,
        units: u.units,
        price: u.price,
        value: u.units * u.price * fxMultiplier,
        currency: "SGD",
        date: new Date(),
      },
    })
  }

  revalidatePath("/portfolio")
  revalidatePath("/")
  revalidatePath("/reports")
  revalidatePath("/forecast")
}

// Apply screenshot-extracted holdings: update existing tickers AND create any new ones
// (e.g. IBIT, or an out-of-scope ETF). Every row that has units & price is brought in so
// the portfolio stays accurate — out-of-scope tickers are then flagged on the dashboard.
const SBR_ALLOWED_TICKERS = new Set(["VWRA", "EQQQ", "SEMI", "A35"])

export async function applyExtractedHoldings(
  rows: Array<{ ticker: string; units: number; price: number }>
): Promise<{ updated: number; created: number }> {
  const session = await getSession()
  if (!session) throw new Error("Unauthenticated")

  const user = await db.user.findUnique({ where: { id: session.userId }, select: { email: true } })
  const constitutionId = constitutionIdForEmail(user?.email)
  const isSbr = constitutionId === "silicon-brick-road"

  const usdSgdRate = await getUsdSgdRate()
  let updated = 0
  let created = 0

  for (const r of rows) {
    const sym = r.ticker?.trim().toUpperCase()
    if (!sym || !(r.units > 0) || !(r.price > 0)) continue

    let holding = await db.holding.findFirst({ where: { userId: session.userId, ticker: sym } })
    if (!holding) {
      // Guard: SBR users can only have SBR tickers created. An Atlas Core screenshot
      // uploaded by mistake must not create VT/VWO/BTC/IBIT entries in an SBR account.
      if (isSbr && !SBR_ALLOWED_TICKERS.has(sym)) continue
      holding = await db.holding.create({
        data: { userId: session.userId, ticker: sym, name: sym, targetPct: 0, hardCapPct: null, toleranceBand: 2.5, color: "#64748b" },
      })
      created++
    }
    const fxMultiplier = sym === "A35" ? 1 : usdSgdRate
    await upsertSnapshotToday(holding.id, { units: r.units, price: r.price, value: r.units * r.price * fxMultiplier })
    updated++
  }

  for (const p of ["/portfolio", "/", "/reports", "/forecast", "/governance", "/holdings", "/ytd"]) revalidatePath(p)
  return { updated, created }
}

// Live refresh: update prices AND share counts.
// Share counts (units) can only come from the brokerage, so when IBKR Flex is configured
// we pull live positions (units + mark price + value) — the source of truth. Holdings IBKR
// doesn't report, and the case where IBKR is unconfigured/unavailable, fall back to Yahoo
// Finance price-only with units carried forward.
export async function refreshLivePrices(opts: { withIbkr?: boolean; reconcile?: boolean } = {}): Promise<{
  success: boolean; updated?: number; unitsUpdated?: number; added?: number; removed?: number; source?: "ibkr" | "yahoo"; note?: string; error?: string
}> {
  const withIbkr = opts.withIbkr !== false        // default: use IBKR when configured
  const reconcile = opts.reconcile ?? withIbkr     // add/remove holdings only when we have brokerage truth
  const session = await getSession()
  if (!session) throw new Error("Unauthenticated")

  // Resolve constitution — only Atlas Core users get ensureCoreHoldings (which creates VT/VWO/BTC
  // placeholders). Running it for SBR users would contaminate Dami's account with Atlas Core tickers.
  const user = await db.user.findUnique({ where: { id: session.userId }, select: { email: true } })
  const constitutionId = constitutionIdForEmail(user?.email)
  if (constitutionId === "atlas-core") {
    await ensureCoreHoldings(session.userId)
  } else {
    await ensureSbrPresentation(session.userId)
  }

  const holdings = await db.holding.findMany({
    where: { userId: session.userId },
    include: { snapshots: { orderBy: { date: "desc" }, take: 1 } },
  })

  if (holdings.length === 0) return { success: false, error: "No holdings found" }

  // Yahoo Finance API — map non-standard tickers (VWRA→VWRA.L, A35→A35.SI) before the fetch.
  const yfSymbols = holdings.map(h => YF_TICKER_MAP[h.ticker] ?? h.ticker)
  const symbols = yfSymbols.join(",")

  const priceMap: Record<string, number> = {}
  let batchSuccess = false

  for (const host of YF_HOSTS) {
    try {
      const res = await fetch(
        `https://${host}/v7/finance/quote?symbols=${symbols}&fields=regularMarketPrice,shortName`,
        { headers: { "User-Agent": "Mozilla/5.0 (compatible; AtlasPortfolio/1.0)" }, cache: "no-store" }
      )
      if (res.ok) {
        const data = await res.json()
        const quotes: Array<{ symbol: string; regularMarketPrice: number }> = data?.quoteResponse?.result ?? []
        for (const q of quotes) {
          // Reverse-map Yahoo tickers back to DB tickers (e.g. VWRA.L → VWRA, A35.SI → A35)
          const dbTicker = YF_REVERSE_MAP[q.symbol] ?? q.symbol
          if (q.regularMarketPrice) priceMap[dbTicker] = q.regularMarketPrice
        }
        if (Object.keys(priceMap).length > 0) { batchSuccess = true; break }
      }
    } catch {}
  }

  // Per-ticker fallback: try v8/chart on query1 then query2 for any missing tickers
  if (!batchSuccess || Object.keys(priceMap).length < holdings.length) {
    const missing = holdings.filter(h => !priceMap[h.ticker])
    for (const h of missing) {
      const yfTicker = YF_TICKER_MAP[h.ticker] ?? h.ticker
      for (const host of YF_HOSTS) {
        try {
          const r = await fetch(
            `https://${host}/v8/finance/chart/${yfTicker}?interval=1d&range=1d`,
            { headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store" }
          )
          if (r.ok) {
            const d = await r.json()
            const price = d?.chart?.result?.[0]?.meta?.regularMarketPrice
            if (price) { priceMap[h.ticker] = price; break }
          }
        } catch {}
      }
    }
  }

  // ── IBKR positions — brokerage truth for SHARE COUNTS (units + mark price + value) ──
  // SBR users get their own Flex tokens (IBKR_SBR_FLEX_TOKEN / IBKR_SBR_FLEX_QUERY_ID).
  // Falls back to the main tokens if SBR-specific ones are not yet set (unfunded account).
  const ibkrToken = constitutionId === "silicon-brick-road"
    ? (process.env.IBKR_SBR_FLEX_TOKEN || process.env.IBKR_FLEX_TOKEN)
    : process.env.IBKR_FLEX_TOKEN
  const ibkrQuery = constitutionId === "silicon-brick-road"
    ? (process.env.IBKR_SBR_FLEX_QUERY_ID || process.env.IBKR_FLEX_QUERY_ID)
    : process.env.IBKR_FLEX_QUERY_ID
  const posMap: Record<string, { units: number; markPrice: number; positionValue: number }> = {}
  let ibkrError: string | null = null
  if (withIbkr && ibkrToken && ibkrQuery) {
    const r = await fetchFlexPositions(ibkrToken, ibkrQuery)
    if (r.success) {
      for (const p of r.positions) {
        posMap[p.symbol.toUpperCase()] = { units: p.units, markPrice: p.markPrice, positionValue: p.positionValue }
      }
    } else {
      ibkrError = r.error
    }
  }
  const haveIbkr = Object.keys(posMap).length > 0

  if (Object.keys(priceMap).length === 0 && !haveIbkr) {
    return {
      success: false,
      error: ibkrError
        ? `Price API unavailable and IBKR sync failed: ${ibkrError}`
        : "Price API unavailable — both Yahoo Finance endpoints failed",
    }
  }

  const usdSgdRate = await getUsdSgdRate()

  let updated = 0
  let unitsUpdated = 0
  for (const holding of holdings) {
    const latest = holding.snapshots[0]
    const pos = posMap[holding.ticker.toUpperCase()]
    const yh = priceMap[holding.ticker]

    let units: number
    let price: number
    let value: number

    if (pos) {
      // Brokerage truth — update units AND price together.
      units = pos.units
      price = pos.markPrice
      value = pos.positionValue > 0 ? pos.positionValue : pos.units * pos.markPrice * usdSgdRate
      if (!latest || Math.abs((latest.units ?? 0) - units) > 1e-6) unitsUpdated++
    } else if (yh && latest) {
      // Yahoo price-only — carry units forward (no brokerage data for this holding).
      // SGD-priced tickers (A35.SI) must not be multiplied by the USD→SGD rate.
      const yfSym = YF_TICKER_MAP[holding.ticker]
      const isSgdPriced = yfSym ? YF_SGD_PRICED.has(yfSym) : false
      units = latest.units
      price = yh
      value = latest.units * yh * (isSgdPriced ? 1 : usdSgdRate)
    } else {
      continue
    }

    await upsertSnapshotToday(holding.id, { units, price, value })
    updated++
  }

  // ── Reconcile holdings against the brokerage (only with a valid IBKR positions list) ──
  // fetchFlexPositions only succeeds with a non-empty list, so this never wipes everything
  // on a failed/empty report. Removal is SOFT (a 0-unit snapshot) — reversible, and it
  // preserves value history; the holding drops out of allocations.
  let added = 0
  let removed = 0
  if (reconcile && haveIbkr) {
    const dbTickers = new Set(holdings.map(h => h.ticker.toUpperCase()))

    // Add: positions IBKR reports that we don't track yet (created untracked, target 0%).
    for (const [sym, p] of Object.entries(posMap)) {
      if (dbTickers.has(sym)) continue
      const created = await db.holding.create({
        data: {
          userId: session.userId, ticker: sym, name: sym,
          targetPct: 0, hardCapPct: null, toleranceBand: 2.5, color: "#64748b",
        },
      })
      await upsertSnapshotToday(created.id, {
        units: p.units, price: p.markPrice,
        value: p.positionValue > 0 ? p.positionValue : p.units * p.markPrice * usdSgdRate,
      })
      added++
    }

    // Remove (soft): tracked holdings the brokerage no longer reports → zero them out.
    for (const holding of holdings) {
      if (posMap[holding.ticker.toUpperCase()]) continue
      const latest = holding.snapshots[0]
      if (!latest || latest.units === 0) continue // already closed / placeholder (e.g. SGOV, IBIT)
      await upsertSnapshotToday(holding.id, { units: 0, price: latest.price, value: 0 })
      removed++
    }
  }

  revalidatePath("/portfolio")
  revalidatePath("/")
  revalidatePath("/reports")
  revalidatePath("/forecast")
  revalidatePath("/governance")

  const note = ibkrToken && ibkrQuery && !haveIbkr
    ? `IBKR sync unavailable (${ibkrError ?? "no positions returned"}) — prices updated from Yahoo; share counts unchanged.`
    : (!ibkrToken || !ibkrQuery)
    ? "Prices updated from Yahoo. Connect IBKR (IBKR_FLEX_TOKEN/QUERY_ID) to also sync share counts."
    : undefined

  return { success: true, updated, unitsUpdated, added, removed, source: haveIbkr ? "ibkr" : "yahoo", note }
}

type ExtractResult =
  | { success: true; data: Array<{ ticker: string; units: number; price: number; value: number }> }
  | { success: false; error: string }

// Screenshot OCR: extract holdings data from an IBKR screenshot using Claude vision
export async function extractFromScreenshot(
  imageBase64: string,
  mimeType: string
): Promise<ExtractResult> {
  try {
    const session = await getSession()
    if (!session) return { success: false, error: "Not authenticated" }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return { success: false, error: "ANTHROPIC_API_KEY is not configured on this server" }

    const client = new Anthropic({ apiKey })

    const message = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
                data: imageBase64,
              },
            },
            {
              type: "text",
              text: `This is a brokerage (IBKR) portfolio screenshot. Extract the holdings data.

For each holding visible, return a JSON array with objects containing:
- ticker: the stock/ETF ticker symbol (string)
- units: number of shares/units held (number)
- price: current price per unit in USD (number)
- value: total market value in SGD (number, as shown in the account base currency)

Only include ETF/stock holdings, not cash. Return ONLY a valid JSON array, no explanation.
Example: [{"ticker":"VT","units":428,"price":155.52,"value":85209.84}]`,
            },
          ],
        },
      ],
    })

    const text = message.content[0].type === "text" ? message.content[0].text : ""
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return { success: false, error: "Claude could not find holdings data in the screenshot" }

    const data = JSON.parse(jsonMatch[0])
    return { success: true, data }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error"
    return { success: false, error: msg }
  }
}
