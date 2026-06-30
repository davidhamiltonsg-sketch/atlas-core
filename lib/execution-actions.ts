"use server"

import { db } from "@/lib/db"
import { getSession } from "@/lib/session"
import { revalidatePath } from "next/cache"

// Execution-confirmation loop: the user logs that they actually carried out the
// recommended action. Closes the governance loop — the system finds out whether its
// instruction was followed — and gives the Behaviour journal real signal instead of proxies.
export async function logExecution(action: string) {
  const session = await getSession()
  if (!session) return { error: "Unauthenticated" }
  const note = (action || "Followed the recommended action").slice(0, 280)
  await db.behaviourLog.create({
    data: { userId: session.userId, type: "execution", note, date: new Date() },
  })
  revalidatePath("/")
  return { success: true }
}

export interface ExecutionEntry { note: string; date: string }

export async function getRecentExecutions(userId: string, limit = 5): Promise<ExecutionEntry[]> {
  const rows = await db.behaviourLog.findMany({
    where: { userId, type: "execution" },
    orderBy: { date: "desc" },
    take: limit,
  })
  return rows.map((r) => ({ note: r.note, date: r.date.toISOString() }))
}
