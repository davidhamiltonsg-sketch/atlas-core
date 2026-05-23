"use server"

import { revalidatePath } from "next/cache"
import bcrypt from "bcryptjs"
import { db } from "@/lib/db"
import { getSession } from "@/lib/session"

export async function createUserAction(formData: FormData) {
  const session = await getSession()
  if (!session || session.role !== "admin") {
    return { error: "Unauthorised. Admin access required." }
  }

  const email = (formData.get("email") as string)?.trim().toLowerCase()
  const name = (formData.get("name") as string)?.trim()
  const password = formData.get("password") as string
  const role = (formData.get("role") as string) ?? "user"

  if (!email || !name || !password) {
    return { error: "All fields are required." }
  }

  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." }
  }

  const existing = await db.user.findUnique({ where: { email } })
  if (existing) {
    return { error: "A user with this email already exists." }
  }

  const passwordHash = await bcrypt.hash(password, 12)
  const user = await db.user.create({
    data: { email, name, passwordHash, role },
  })

  // Create default holdings (zero position) for the new user
  const adminHoldings = await db.holding.findMany({
    where: { userId: session.userId },
  })

  for (const h of adminHoldings) {
    const newHolding = await db.holding.create({
      data: {
        userId: user.id,
        ticker: h.ticker,
        name: h.name,
        targetPct: h.targetPct,
        hardCapPct: h.hardCapPct,
        toleranceBand: h.toleranceBand,
        color: h.color,
      },
    })
    // Create a zero snapshot so the holding is queryable
    await db.snapshot.create({
      data: {
        holdingId: newHolding.id,
        units: 0,
        price: 0,
        value: 0,
        currency: "USD",
        date: new Date(),
      },
    })
  }

  revalidatePath("/admin/users")
  return { success: true, userId: user.id }
}

export async function deleteUserAction(userId: string) {
  const session = await getSession()
  if (!session || session.role !== "admin") {
    return { error: "Unauthorised." }
  }
  if (userId === session.userId) {
    return { error: "You cannot delete your own account." }
  }

  await db.user.delete({ where: { id: userId } })
  revalidatePath("/admin/users")
  return { success: true }
}
