"use server"

import { db } from "@/lib/db"
import { getSession } from "@/lib/session"
import { revalidatePath } from "next/cache"

// Logs that the user completed their monthly 5-minute check (governance §E1 / E).
// Reinforces the cadence — and the point of the cadence is to NOT check more often.
export async function logMonthlyCheck() {
  const session = await getSession()
  if (!session) return { error: "Unauthenticated" }
  await db.behaviourLog.create({
    data: { userId: session.userId, type: "monthly-check", note: "Completed the monthly 5-minute check", date: new Date() },
  })
  revalidatePath("/")
  return { success: true }
}

export async function getLastMonthlyCheck(userId: string): Promise<string | null> {
  const last = await db.behaviourLog.findFirst({
    where: { userId, type: "monthly-check" },
    orderBy: { date: "desc" },
  })
  return last?.date.toISOString() ?? null
}
