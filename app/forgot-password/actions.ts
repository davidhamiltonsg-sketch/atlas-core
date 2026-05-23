"use server"

import crypto from "crypto"
import { db } from "@/lib/db"
import { sendPasswordResetEmail } from "@/lib/email"

export async function forgotPasswordAction(formData: FormData) {
  const email = (formData.get("email") as string)?.trim().toLowerCase()

  if (!email) return { error: "Email is required." }

  const user = await db.user.findUnique({ where: { email } })

  // Always return success to avoid email enumeration
  if (!user) return { success: true }

  // Delete any existing tokens for this user
  await db.passwordResetToken.deleteMany({ where: { userId: user.id } })

  // Create a new token (1-hour expiry)
  const token = crypto.randomBytes(32).toString("hex")
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000)

  await db.passwordResetToken.create({
    data: { userId: user.id, token, expiresAt },
  })

  try {
    await sendPasswordResetEmail(user.email, user.name, token)
  } catch (err) {
    console.error("Failed to send reset email:", err)
    return { error: "Failed to send reset email. Check RESEND_API_KEY configuration." }
  }

  return { success: true }
}
