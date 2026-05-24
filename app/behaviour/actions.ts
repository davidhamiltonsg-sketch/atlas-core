"use server"

import { db } from "@/lib/db"
import { getSession } from "@/lib/session"
import { revalidatePath } from "next/cache"

export async function logBehaviour(formData: FormData) {
  const session = await getSession()
  if (!session) throw new Error("Not authenticated")

  const type = formData.get("type") as string
  const note = formData.get("note") as string

  if (!type || !note?.trim()) return

  await db.behaviourLog.create({
    data: { userId: session.userId, type, note: note.trim() },
  })

  revalidatePath("/behaviour")
}

export async function deleteBehaviourLog(id: string) {
  const session = await getSession()
  if (!session) return

  await db.behaviourLog.deleteMany({
    where: { id, userId: session.userId },
  })

  revalidatePath("/behaviour")
}
