"use server"

import { db } from "@/lib/db"
import { getSession } from "@/lib/session"

export interface CommitteeMinuteData {
  decision: string
  articleTriggered: string
  bothConfirmed: boolean
}

export async function createCommitteeMinute(data: CommitteeMinuteData) {
  const session = await getSession()
  if (!session?.userId) throw new Error("Not authenticated")
  if (!data.bothConfirmed) throw new Error("Both parties must confirm")
  if (!data.decision.trim()) throw new Error("Decision description is required")

  await db.behaviourLog.create({
    data: {
      userId: session.userId,
      type: "committee-minute",
      note: `article:${data.articleTriggered.trim() || "unspecified"} confirmed:true decision:${data.decision.trim()}`,
    },
  })
}
