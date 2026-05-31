"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { getSession } from "@/lib/session"

export async function addDividendAction(formData: FormData) {
  const session = await getSession()
  if (!session) return { error: "Unauthenticated." }

  const ticker = (formData.get("ticker") as string)?.trim().toUpperCase()
  const amount = parseFloat(formData.get("amount") as string)
  const units = parseFloat(formData.get("units") as string)
  const paymentDate = new Date(formData.get("paymentDate") as string)
  const note = (formData.get("note") as string)?.trim() || null
  const isDrip = formData.get("isDrip") === "true"
  const dripUnitsRaw = formData.get("dripUnits") as string
  const dripUnits = isDrip && dripUnitsRaw ? parseFloat(dripUnitsRaw) : null

  if (!ticker) return { error: "Ticker is required." }
  if (isNaN(amount) || amount <= 0) return { error: "Amount must be positive." }
  if (isNaN(units) || units <= 0) return { error: "Units must be positive." }
  if (!paymentDate || isNaN(paymentDate.getTime())) return { error: "Invalid date." }
  if (isDrip && (dripUnits === null || isNaN(dripUnits) || dripUnits <= 0)) {
    return { error: "DRIP units must be a positive number." }
  }

  // Try to link to holding
  const holding = await db.holding.findFirst({ where: { userId: session.userId, ticker } })

  await db.dividend.create({
    data: {
      userId: session.userId,
      holdingId: holding?.id ?? null,
      ticker,
      amount,
      units,
      isDrip,
      dripUnits,
      paymentDate,
      note,
    },
  })

  // For DRIP: record a corresponding BUY trade so the trade log reflects the new units
  if (isDrip && dripUnits && holding) {
    const pricePerUnit = amount / dripUnits // approximate USD equivalent — SGD amount / units gives proxy price
    await db.trade.create({
      data: {
        userId: session.userId,
        ticker,
        type: "BUY",
        units: dripUnits,
        price: pricePerUnit,
        amount,
        fxRate: 1.35, // placeholder; DRIP uses SGD directly so no FX needed
        date: paymentDate,
        note: `DRIP reinvestment — ${note ?? ticker} dividend`,
      },
    })
  }

  revalidatePath("/dividends")
  return { success: true }
}

export async function deleteDividendAction(id: string) {
  const session = await getSession()
  if (!session) return { error: "Unauthenticated." }

  const div = await db.dividend.findFirst({ where: { id, userId: session.userId } })
  if (!div) return { error: "Record not found." }

  await db.dividend.delete({ where: { id } })
  revalidatePath("/dividends")
  return { success: true }
}
