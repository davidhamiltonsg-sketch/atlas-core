"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { getSession } from "@/lib/session"

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
  return 1.35
}

export async function addTradeAction(formData: FormData) {
  const session = await getSession()
  if (!session) return { error: "Unauthenticated." }

  const ticker = (formData.get("ticker") as string)?.trim().toUpperCase()
  const type = formData.get("type") as string
  const units = parseFloat(formData.get("units") as string)
  const price = parseFloat(formData.get("price") as string)
  const date = new Date(formData.get("date") as string)
  const note = (formData.get("note") as string)?.trim() || null

  if (!ticker || !type || isNaN(units) || isNaN(price) || !date) return { error: "All required fields must be filled." }
  if (!["BUY", "SELL"].includes(type)) return { error: "Type must be BUY or SELL." }
  if (units <= 0 || price <= 0) return { error: "Units and price must be positive." }

  const fxRate = await getUsdSgdRate()
  const amount = units * price * fxRate

  const trade = await db.trade.create({
    data: {
      userId: session.userId,
      ticker,
      type,
      units,
      price,
      amount,
      fxRate,
      date,
      note,
    },
  })

  // Auto-link: BUY trades create a ContributionRecord so the contributions page stays in sync.
  // Note format [trade:ID] allows reliable deletion if the trade is later removed.
  if (type === "BUY") {
    await db.contributionRecord.create({
      data: {
        userId: session.userId,
        amount: units * price, // USD (price is USD/unit)
        date,
        note: `[trade:${trade.id}] BUY ${units} ${ticker} @ $${price}`,
      },
    })
  }

  revalidatePath("/trades")
  revalidatePath("/contributions")
  revalidatePath("/ytd")
  return { success: true }
}

export async function deleteTradeAction(id: string) {
  const session = await getSession()
  if (!session) return { error: "Unauthenticated." }

  const trade = await db.trade.findFirst({ where: { id, userId: session.userId } })
  if (!trade) return { error: "Trade not found." }

  // Delete any auto-linked contribution record first
  await db.contributionRecord.deleteMany({
    where: {
      userId: session.userId,
      note: { startsWith: `[trade:${id}]` },
    },
  })

  await db.trade.delete({ where: { id } })
  revalidatePath("/trades")
  revalidatePath("/contributions")
  revalidatePath("/ytd")
  return { success: true }
}
