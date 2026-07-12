"use server"

import { revalidatePath } from "next/cache"
import bcrypt from "bcryptjs"
import { db } from "@/lib/db"
import { getSession, createSession } from "@/lib/session"
import { activePortfolioContext } from "@/lib/active-portfolio"
import { assertCanMutateOwner } from "@/lib/mutation-auth"

export async function updateProfileAction(formData: FormData) {
  const session = await getSession()
  if (!session) return { error: "Unauthenticated." }

  const name = (formData.get("name") as string)?.trim()
  const email = (formData.get("email") as string)?.trim().toLowerCase()

  if (!name || !email) return { error: "Name and email are required." }

  // Check email not taken by another user
  if (email !== session.email) {
    const existing = await db.user.findUnique({ where: { email } })
    if (existing) return { error: "That email is already in use." }
  }

  const user = await db.user.update({
    where: { id: session.userId },
    data: { name, email, updatedAt: new Date() },
  })

  // Refresh session with updated details
  await createSession({ userId: user.id, email: user.email, name: user.name, role: user.role })
  revalidatePath("/settings")
  return { success: true }
}

export async function updateContributionSettingsAction(formData: FormData) {
  const session = await getSession()
  if (!session) return { error: "Unauthenticated." }
  const active = await activePortfolioContext(session)
  try { assertCanMutateOwner(session, active.owner.id) } catch (error) { return { error: error instanceof Error ? error.message : "Read-only access." } }

  const monthly = parseFloat(formData.get("monthlyContribution") as string)
  const annual = parseFloat(formData.get("annualLumpSum") as string)
  const growth = parseFloat(formData.get("contributionGrowthRate") as string)
  const rfr = parseFloat(formData.get("riskFreeRate") as string)

  if (isNaN(monthly) || monthly < 0) return { error: "Invalid monthly contribution." }
  if (isNaN(annual) || annual < 0) return { error: "Invalid annual lump sum." }
  if (isNaN(growth) || growth < 0 || growth > 0.20) return { error: "Contribution growth must be between 0% and 20% a year." }
  if (isNaN(rfr) || rfr < 0 || rfr > 0.15) return { error: "Risk-free rate must be between 0% and 15% a year." }

  await db.user.update({
    where: { id: active.owner.id },
    data: { monthlyContribution: monthly, annualLumpSum: annual, contributionGrowthRate: growth, riskFreeRate: rfr, updatedAt: new Date() },
  })

  revalidatePath("/settings")
  revalidatePath("/")
  revalidatePath("/forecast")
  revalidatePath("/risk")
  revalidatePath("/mission-control")
  revalidatePath("/reports")
  return { success: true }
}

export async function changePasswordAction(formData: FormData) {
  const session = await getSession()
  if (!session) return { error: "Unauthenticated." }

  const current = formData.get("current") as string
  const newPwd = formData.get("new") as string
  const confirm = formData.get("confirm") as string

  if (!current || !newPwd || !confirm) return { error: "All fields are required." }
  if (newPwd.length < 8) return { error: "New password must be at least 8 characters." }
  if (newPwd !== confirm) return { error: "Passwords do not match." }

  const user = await db.user.findUnique({ where: { id: session.userId } })
  if (!user) return { error: "User not found." }

  const valid = await bcrypt.compare(current, user.passwordHash)
  if (!valid) return { error: "Current password is incorrect." }

  const passwordHash = await bcrypt.hash(newPwd, 12)
  await db.user.update({ where: { id: user.id }, data: { passwordHash, updatedAt: new Date() } })

  return { success: true }
}
