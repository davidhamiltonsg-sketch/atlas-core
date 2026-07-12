"use server"

import { db } from "@/lib/db"
import { getSession } from "@/lib/session"
import { activePortfolioContext } from "@/lib/active-portfolio"
import { assertCanMutateOwner } from "@/lib/mutation-auth"

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
  const active = await activePortfolioContext(session)
  if (active.constitutionId !== "silicon-brick-road") throw new Error("Switch to Silicon Brick Road before recording its committee minute.")
  assertCanMutateOwner(session, active.owner.id)

  await db.behaviourLog.create({
    data: {
      userId: active.owner.id,
      type: "committee-minute",
      note: `article:${data.articleTriggered.trim() || "unspecified"} confirmed:true decision:${data.decision.trim()}`,
    },
  })
}
