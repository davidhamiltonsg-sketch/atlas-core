"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { getSession } from "@/lib/session"

export async function addContributionAction(formData: FormData) {
  const session = await getSession()
  if (!session) return { error: "Unauthenticated." }

  const amount = parseFloat(formData.get("amount") as string)
  const date = new Date(formData.get("date") as string)
  const note = (formData.get("note") as string)?.trim() || null

  if (isNaN(amount) || amount <= 0) return { error: "Amount must be a positive number." }
  if (!date || isNaN(date.getTime())) return { error: "Invalid date." }

  await db.contributionRecord.create({
    data: { userId: session.userId, amount, date, note },
  })

  revalidatePath("/contributions")
  return { success: true }
}

export async function deleteContributionAction(id: string) {
  const session = await getSession()
  if (!session) return { error: "Unauthenticated." }

  const record = await db.contributionRecord.findFirst({ where: { id, userId: session.userId } })
  if (!record) return { error: "Record not found." }

  await db.contributionRecord.delete({ where: { id } })
  revalidatePath("/contributions")
  return { success: true }
}
