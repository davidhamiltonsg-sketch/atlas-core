"use server"

import { redirect } from "next/navigation"
import bcrypt from "bcryptjs"
import { db } from "@/lib/db"
import { createSession } from "@/lib/session"

export async function resetPasswordAction(formData: FormData) {
  const token = formData.get("token") as string
  const password = formData.get("password") as string
  const confirm = formData.get("confirm") as string

  if (!token) return { error: "Invalid reset link." }
  if (!password || password.length < 8) return { error: "Password must be at least 8 characters." }
  if (password !== confirm) return { error: "Passwords do not match." }

  const record = await db.passwordResetToken.findUnique({ where: { token }, include: { user: true } })

  if (!record) return { error: "Invalid or already-used reset link." }
  if (record.expiresAt < new Date()) {
    await db.passwordResetToken.delete({ where: { id: record.id } })
    return { error: "This reset link has expired. Please request a new one." }
  }

  const passwordHash = await bcrypt.hash(password, 12)

  await db.user.update({
    where: { id: record.userId },
    data: { passwordHash, updatedAt: new Date() },
  })

  await db.passwordResetToken.delete({ where: { id: record.id } })

  // Log them in immediately after reset
  await createSession({
    userId: record.user.id,
    email: record.user.email,
    name: record.user.name,
    role: record.user.role,
  })

  redirect("/")
}
