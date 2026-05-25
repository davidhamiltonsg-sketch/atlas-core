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

  if (!ticker) return { error: "Ticker is required." }
  if (isNaN(amount) || amount <= 0) return { error: "Amount must be positive." }
  if (isNaN(units) || units <= 0) return { error: "Units must be positive." }
  if (!paymentDate || isNaN(paymentDate.getTime())) return { error: "Invalid date." }

  // Try to link to holding
  const holding = await db.holding.findFirst({ where: { userId: session.userId, ticker } })

  await db.dividend.create({
    data: {
      userId: session.userId,
      holdingId: holding?.id ?? null,
      ticker,
      amount,
      units,
      paymentDate,
      note,
    },
  })

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
