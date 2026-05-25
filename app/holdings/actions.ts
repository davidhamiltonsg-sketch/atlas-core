"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { getSession } from "@/lib/session"

export async function addHoldingAction(formData: FormData) {
  const session = await getSession()
  if (!session) return { error: "Unauthenticated." }

  const ticker = (formData.get("ticker") as string)?.trim().toUpperCase()
  const name = (formData.get("name") as string)?.trim()
  const targetPctStr = formData.get("targetPct") as string
  const hardCapPctStr = formData.get("hardCapPct") as string
  const toleranceBandStr = formData.get("toleranceBand") as string
  const color = (formData.get("color") as string)?.trim() || "#6366f1"

  if (!ticker || !name) return { error: "Ticker and name are required." }

  const targetPct = parseFloat(targetPctStr)
  if (isNaN(targetPct) || targetPct < 0 || targetPct > 100) {
    return { error: "Target % must be between 0 and 100." }
  }

  const hardCapPct = hardCapPctStr ? parseFloat(hardCapPctStr) : null
  if (hardCapPct !== null && (isNaN(hardCapPct) || hardCapPct < targetPct || hardCapPct > 100)) {
    return { error: "Hard cap must be ≥ target % and ≤ 100." }
  }

  const toleranceBand = toleranceBandStr ? parseFloat(toleranceBandStr) : 2.5
  if (isNaN(toleranceBand) || toleranceBand < 0 || toleranceBand > 20) {
    return { error: "Tolerance band must be between 0 and 20." }
  }

  // Check total target % won't exceed 100
  const existing = await db.holding.findMany({
    where: { userId: session.userId },
    select: { targetPct: true },
  })
  const existingTotal = existing.reduce((s, h) => s + h.targetPct, 0)
  if (existingTotal + targetPct > 100.01) {
    return { error: `Total target allocation would be ${(existingTotal + targetPct).toFixed(1)}% — must not exceed 100%.` }
  }

  try {
    await db.holding.create({
      data: {
        userId: session.userId,
        ticker,
        name,
        targetPct,
        hardCapPct,
        toleranceBand,
        color,
      },
    })
  } catch {
    return { error: "Ticker already exists in your portfolio." }
  }

  revalidatePath("/holdings")
  revalidatePath("/portfolio")
  revalidatePath("/")
  return { success: true }
}

export async function deleteHoldingAction(id: string) {
  const session = await getSession()
  if (!session) return { error: "Unauthenticated." }

  const holding = await db.holding.findFirst({
    where: { id, userId: session.userId },
    include: { snapshots: { take: 1 } },
  })
  if (!holding) return { error: "Holding not found." }

  await db.holding.delete({ where: { id } })
  revalidatePath("/holdings")
  revalidatePath("/portfolio")
  revalidatePath("/")
  return { success: true }
}

export async function updateHoldingAction(formData: FormData) {
  const session = await getSession()
  if (!session) return { error: "Unauthenticated." }

  const id = formData.get("id") as string
  const name = (formData.get("name") as string)?.trim()
  const targetPctStr = formData.get("targetPct") as string
  const hardCapPctStr = formData.get("hardCapPct") as string
  const toleranceBandStr = formData.get("toleranceBand") as string
  const color = (formData.get("color") as string)?.trim() || "#6366f1"

  if (!id || !name) return { error: "ID and name are required." }

  const targetPct = parseFloat(targetPctStr)
  if (isNaN(targetPct) || targetPct < 0 || targetPct > 100) {
    return { error: "Target % must be between 0 and 100." }
  }

  const hardCapPct = hardCapPctStr ? parseFloat(hardCapPctStr) : null
  if (hardCapPct !== null && (isNaN(hardCapPct) || hardCapPct < targetPct || hardCapPct > 100)) {
    return { error: "Hard cap must be ≥ target % and ≤ 100." }
  }

  const toleranceBand = toleranceBandStr ? parseFloat(toleranceBandStr) : 2.5
  if (isNaN(toleranceBand) || toleranceBand < 0 || toleranceBand > 20) {
    return { error: "Tolerance band must be between 0 and 20." }
  }

  const holding = await db.holding.findFirst({ where: { id, userId: session.userId } })
  if (!holding) return { error: "Holding not found." }

  // Check total target % (excluding this holding)
  const others = await db.holding.findMany({
    where: { userId: session.userId, id: { not: id } },
    select: { targetPct: true },
  })
  const othersTotal = others.reduce((s, h) => s + h.targetPct, 0)
  if (othersTotal + targetPct > 100.01) {
    return { error: `Total target allocation would be ${(othersTotal + targetPct).toFixed(1)}% — must not exceed 100%.` }
  }

  await db.holding.update({
    where: { id },
    data: { name, targetPct, hardCapPct, toleranceBand, color, updatedAt: new Date() },
  })

  revalidatePath("/holdings")
  revalidatePath("/portfolio")
  revalidatePath("/")
  return { success: true }
}
