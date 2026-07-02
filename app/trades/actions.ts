"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { getSession } from "@/lib/session"
import { getUsdSgdRate, syncHoldingFromTrades } from "@/lib/holdings-sync"

function revalidateAll() {
  for (const p of ["/", "/trades", "/contributions", "/ytd", "/portfolio", "/governance", "/reports", "/forecast", "/holdings", "/rebalance"]) {
    revalidatePath(p)
  }
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
        amount, // SGD settled amount — the Contributions view renders in SGD (S$)
        date,
        note: `[trade:${trade.id}] BUY ${units} ${ticker} @ $${price}`,
      },
    })
  }

  // Apply the trade to the holding so units/value flow through the entire app.
  await syncHoldingFromTrades(session.userId, ticker, fxRate)

  revalidateAll()
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

  // Re-derive the holding's units from the remaining trades so a deletion stays consistent.
  const fxRate = await getUsdSgdRate()
  await syncHoldingFromTrades(session.userId, trade.ticker, fxRate)

  revalidateAll()
  return { success: true }
}
