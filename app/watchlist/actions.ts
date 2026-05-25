"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { getSession } from "@/lib/session"

export async function addWatchlistItemAction(formData: FormData) {
  const session = await getSession()
  if (!session) return { error: "Unauthenticated." }

  const ticker = (formData.get("ticker") as string)?.trim().toUpperCase()
  const name = (formData.get("name") as string)?.trim()
  const note = (formData.get("note") as string)?.trim() || null
  const targetPctStr = formData.get("targetPct") as string
  const targetPct = targetPctStr ? parseFloat(targetPctStr) : null

  if (!ticker || !name) return { error: "Ticker and name are required." }
  if (targetPct !== null && (isNaN(targetPct) || targetPct < 0 || targetPct > 100)) {
    return { error: "Target % must be between 0 and 100." }
  }

  try {
    await db.watchlistItem.create({
      data: { userId: session.userId, ticker, name, note, targetPct },
    })
  } catch {
    return { error: "Ticker already on watchlist." }
  }

  revalidatePath("/watchlist")
  return { success: true }
}

export async function deleteWatchlistItemAction(id: string) {
  const session = await getSession()
  if (!session) return { error: "Unauthenticated." }

  const item = await db.watchlistItem.findFirst({ where: { id, userId: session.userId } })
  if (!item) return { error: "Item not found." }

  await db.watchlistItem.delete({ where: { id } })
  revalidatePath("/watchlist")
  return { success: true }
}
