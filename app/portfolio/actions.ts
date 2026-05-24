"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { getSession } from "@/lib/session"
import Anthropic from "@anthropic-ai/sdk"

// Fetch live USD→SGD exchange rate from Yahoo Finance
async function getUsdSgdRate(): Promise<number> {
  try {
    const res = await fetch(
      "https://query1.finance.yahoo.com/v8/finance/chart/USDSGD=X?interval=1d&range=1d",
      { headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store" }
    )
    if (res.ok) {
      const d = await res.json()
      const rate = d?.chart?.result?.[0]?.meta?.regularMarketPrice
      if (rate && rate > 0) return rate
    }
  } catch {}
  return 1.35 // fallback
}

// Manual update: create new snapshots for one or more holdings
export async function updateHoldingsManually(
  updates: Array<{ holdingId: string; units: number; price: number }>
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

    await db.snapshot.create({
      data: {
        holdingId: u.holdingId,
        units: u.units,
        price: u.price,
        value: u.units * u.price * usdSgdRate,
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

// Live price refresh: fetch current market prices from Yahoo Finance and create new snapshots
export async function refreshLivePrices(): Promise<{ success: boolean; updated?: number; error?: string }> {
  const session = await getSession()
  if (!session) throw new Error("Unauthenticated")

  const holdings = await db.holding.findMany({
    where: { userId: session.userId },
    include: { snapshots: { orderBy: { date: "desc" }, take: 1 } },
  })

  if (holdings.length === 0) return { success: false, error: "No holdings found" }

  // Yahoo Finance API — map our tickers to YF symbols
  const symbols = holdings.map(h => h.ticker).join(",")
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols}&fields=regularMarketPrice,shortName`

  let priceMap: Record<string, number> = {}
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AtlasPortfolio/1.0)" },
      cache: "no-store",
    })
    if (!res.ok) {
      // Fallback to v8 chart API for individual tickers
      for (const h of holdings) {
        const r = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${h.ticker}?interval=1d&range=1d`,
          { headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store" }
        )
        if (r.ok) {
          const d = await r.json()
          const price = d?.chart?.result?.[0]?.meta?.regularMarketPrice
          if (price) priceMap[h.ticker] = price
        }
      }
    } else {
      const data = await res.json()
      const quotes: Array<{ symbol: string; regularMarketPrice: number }> = data?.quoteResponse?.result ?? []
      for (const q of quotes) {
        if (q.regularMarketPrice) priceMap[q.symbol] = q.regularMarketPrice
      }
    }
  } catch {
    return { success: false, error: "Price API unavailable" }
  }

  if (Object.keys(priceMap).length === 0) {
    return { success: false, error: "No prices returned from market data API" }
  }

  const usdSgdRate = await getUsdSgdRate()

  let updated = 0
  for (const holding of holdings) {
    const price = priceMap[holding.ticker]
    const latest = holding.snapshots[0]
    if (!price || !latest) continue

    await db.snapshot.create({
      data: {
        holdingId: holding.id,
        units: latest.units,
        price,
        value: latest.units * price * usdSgdRate,
        currency: "SGD",
        date: new Date(),
      },
    })
    updated++
  }

  revalidatePath("/portfolio")
  revalidatePath("/")
  revalidatePath("/reports")
  revalidatePath("/forecast")
  revalidatePath("/governance")

  return { success: true, updated }
}

// Screenshot OCR: extract holdings data from an IBKR screenshot using Claude vision
export async function extractFromScreenshot(
  imageBase64: string,
  mimeType: string
): Promise<Array<{ ticker: string; units: number; price: number; value: number }>> {
  const session = await getSession()
  if (!session) throw new Error("Unauthenticated")

  const client = new Anthropic()

  const message = await client.messages.create({
    model: "claude-opus-4-6",
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
  if (!jsonMatch) throw new Error("Could not parse holdings from screenshot")

  return JSON.parse(jsonMatch[0])
}
