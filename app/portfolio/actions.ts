"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { getSession } from "@/lib/session"
import { fetchFlexPositions } from "@/lib/ibkr-flex"
import { upsertSnapshotToday, ensureCoreHoldings, ensureSbrPresentation } from "@/lib/holdings-sync"
import { ibkrCredentialsFor } from "@/lib/ibkr-config"
import { activePortfolioContext } from "@/lib/active-portfolio"
import Anthropic from "@anthropic-ai/sdk"
import { SBR_SPEC, ATLAS_SPEC } from "@/lib/portfolio-spec"
import { assertCanMutateOwner } from "@/lib/mutation-auth"
import { economicSleeveTicker } from "@/lib/instrument-identity"
import { getCachedUsdSgdRate } from "@/lib/fx-cache"

// Yahoo Finance ticker overrides for non-US instruments held by SBR users.
const YF_TICKER_MAP: Record<string, string> = { VWRA: "VWRA.L", EQAC: "EQAC.L", SMH: "SMH.L", IBIT: "IBIT", BTC: "IBIT", DBMFE: "DBMFE.PA" }
const YF_REVERSE_MAP = Object.fromEntries(Object.entries(YF_TICKER_MAP).map(([k, v]) => [v, k]))
// Tickers whose Yahoo Finance price is already in SGD (no USD→SGD conversion needed).
const YF_SGD_PRICED = new Set<string>()

const YF_HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]

// Manual update: create new snapshots for one or more holdings.
// Pass currency: "SGD" for an SGD-priced instrument to skip USD→SGD conversion.
export async function updateHoldingsManually(
  updates: Array<{ holdingId: string; units: number; price: number; currency?: "USD" | "SGD" }>
) {
  const session = await getSession()
  if (!session) throw new Error("Unauthenticated")
  const active = await activePortfolioContext(session)
  assertCanMutateOwner(session, active.owner.id)

  const usdSgdRate = await getCachedUsdSgdRate()

  for (const u of updates) {
    // Verify holding belongs to this user
    const holding = await db.holding.findFirst({
      where: { id: u.holdingId, userId: active.owner.id },
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
  revalidatePath("/risk")
  revalidatePath("/mission-control")
}

// Apply screenshot-extracted holdings: update existing tickers AND create any new ones
// (e.g. IBIT, or an out-of-scope ETF). Every row that has units & price is brought in so
// the portfolio stays accurate — out-of-scope tickers are then flagged on the dashboard.
const SBR_ALLOWED_TICKERS = new Set(SBR_SPEC.funds.map(f=>f.ticker))

export async function applyExtractedHoldings(
  rows: Array<{ ticker: string; units: number; price: number; value?: number }>
): Promise<{ updated: number; created: number }> {
  const session = await getSession()
  if (!session) throw new Error("Unauthenticated")
  const active = await activePortfolioContext(session)
  assertCanMutateOwner(session, active.owner.id)
  const constitutionId = active.constitutionId
  const ownerId = active.owner.id
  const isSbr = constitutionId === "silicon-brick-road"

  const usdSgdRate = await getCachedUsdSgdRate()
  let updated = 0
  let created = 0

  for (const r of rows) {
    const sym = r.ticker?.trim().toUpperCase()
    if (!sym || !(r.units > 0) || !(r.price > 0)) continue

    let holding = await db.holding.findFirst({ where: { userId: ownerId, ticker: sym } })
    if (!holding) {
      // Guard: SBR users can only have SBR tickers created. An Atlas Core screenshot
      // uploaded by mistake must not create out-of-mandate entries in an SBR account.
      if (isSbr && !SBR_ALLOWED_TICKERS.has(sym)) continue
      holding = await db.holding.create({
        data: { userId: ownerId, ticker: sym, name: sym, targetPct: 0, hardCapPct: null, toleranceBand: 2.5, color: "#64748b" },
      })
      created++
    }
    // units × price × USDSGD is only correct for USD-quoted lines — DBMFE is EUR-quoted and
    // LSE lines can print in GBp, so inferring SGD from an unlabelled quote misvalues them
    // (same reasoning as the SBR refresh-path guard below). The vision extractor reads the
    // account-base (SGD) value column directly; prefer it when present and sane, and fall
    // back to the FX computation only when no usable extracted value exists.
    const extractedSgd = typeof r.value === "number" && Number.isFinite(r.value) && r.value > 0 ? r.value : null
    await upsertSnapshotToday(holding.id, { units: r.units, price: r.price, value: extractedSgd ?? r.units * r.price * usdSgdRate })
    updated++
  }

  for (const p of ["/portfolio", "/", "/reports", "/forecast", "/governance", "/holdings", "/ytd", "/risk", "/mission-control"]) revalidatePath(p)
  return { updated, created }
}

// Owner-only correction for an erroneous NON-GOVERNED row (e.g. a phantom position created
// by a misread screenshot import). Append-only: the holding row and its history stay in the
// DB — a zero snapshot is written (same close semantics as the IBKR sync), the row is marked
// CLOSED, and the correction is recorded in the governance log. Governed sleeve positions
// can never be zeroed from the UI.
export async function removeErroneousPosition(holdingId: string): Promise<{ success?: true; error?: string }> {
  const session = await getSession()
  if (!session) return { error: "Unauthenticated." }
  const active = await activePortfolioContext(session)
  try { assertCanMutateOwner(session, active.owner.id) } catch (error) {
    return { error: error instanceof Error ? error.message : "Read-only access." }
  }

  const holding = await db.holding.findFirst({ where: { id: holdingId, userId: active.owner.id } })
  if (!holding) return { error: "Holding not found." }
  const governedTickers = active.constitutionId === "silicon-brick-road" ? SBR_SPEC.funds.map((f) => f.ticker) : ATLAS_SPEC.funds.map((f) => f.ticker)
  const governedSet = new Set<string>(governedTickers)
  if (holding.targetPct > 0 || governedSet.has(economicSleeveTicker(holding.ticker))) {
    return { error: "Only non-governed rows can be corrected. Governed positions change through contributions and documented trades." }
  }

  await upsertSnapshotToday(holding.id, { units: 0, price: 0, value: 0, costBasis: 0, unrealizedPnl: 0 })
  await db.holding.update({ where: { id: holding.id }, data: { instrumentStatus: "CLOSED" } })
  await db.governanceLog.create({
    data: {
      userId: active.owner.id,
      event: "EXCEPTION_LOGGED",
      details: `Erroneous ${holding.ticker} position zeroed by owner from the Position Ledger (data correction — row and history retained for audit).`,
    },
  })

  for (const p of ["/portfolio", "/", "/reports", "/forecast", "/governance", "/risk", "/mission-control", "/next"]) revalidatePath(p)
  return { success: true }
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
  const active = await activePortfolioContext(session)
  assertCanMutateOwner(session, active.owner.id)
  const constitutionId = active.constitutionId
  const ownerId = active.owner.id
  if (constitutionId === "atlas-core") {
    await ensureCoreHoldings(ownerId)
  } else {
    await ensureSbrPresentation(ownerId)
  }

  const holdings = await db.holding.findMany({
    where: { userId: ownerId },
    include: { snapshots: { orderBy: { date: "desc" }, take: 1 } },
  })

  if (holdings.length === 0) return { success: false, error: "No holdings found" }

  // Yahoo Finance API — map governed tickers to their exchange-qualified symbols.
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
          // Reverse-map exchange-qualified symbols back to governed database keys.
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
  // SBR users get their own Flex tokens (IBKR_SBR_*), falling back to the main tokens
  // if the SBR account isn't wired up yet. Shared with the modal + cron sync paths.
  const { token: ibkrToken, positionsQuery: ibkrQuery } = ibkrCredentialsFor(constitutionId)
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

  // London UCITS lines can be quoted in USD, GBP or GBp. Until quote metadata is
  // resolved by ISIN/venue/currency, SBR valuation refreshes must use IBKR's base-currency
  // position value and must never infer SGD value from an unlabelled Yahoo number.
  if (constitutionId === "silicon-brick-road" && !haveIbkr) {
    return { success: false, error: ibkrError ? `SBR requires an authoritative IBKR positions report: ${ibkrError}` : "SBR requires an authoritative IBKR positions report; public quote fallback is disabled." }
  }

  if (Object.keys(priceMap).length === 0 && !haveIbkr) {
    return {
      success: false,
      error: ibkrError
        ? `Price API unavailable and IBKR sync failed: ${ibkrError}`
        : "Price API unavailable — both Yahoo Finance endpoints failed",
    }
  }

  const usdSgdRate = await getCachedUsdSgdRate()

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
      // Any explicitly SGD-priced ticker must not be multiplied by the USD→SGD rate.
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
          userId: ownerId, ticker: sym, name: sym,
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
  revalidatePath("/risk")
  revalidatePath("/mission-control")

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
- price: current price per unit in the trading currency shown (number)
- value: total market value in SGD (number, as shown in the account base currency)

Only include ETF/stock holdings, not cash. Return ONLY a valid JSON array, no explanation.
Example: [{"ticker":"VWRA","units":428,"price":142.52,"value":61038.56}]`,
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
