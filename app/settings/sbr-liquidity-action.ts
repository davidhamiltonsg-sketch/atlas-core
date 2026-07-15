"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { getSession } from "@/lib/session"
import { activePortfolioContext } from "@/lib/active-portfolio"
import { assertCanMutateOwner } from "@/lib/mutation-auth"

/**
 * SBR liquidity pillar — record the owner's standing confirmation that an emergency fund
 * exists OUTSIDE this portfolio. The health score's liquidity dimension reads this flag
 * (see computeSbrHealth); the portfolio itself must never score as emergency liquidity.
 */
export async function setExternalLiquidityVerifiedAction(verified: boolean): Promise<{ success?: true; error?: string }> {
  const session = await getSession()
  if (!session) return { error: "Unauthenticated." }
  const active = await activePortfolioContext(session)
  if (active.constitutionId !== "silicon-brick-road") return { error: "This confirmation only applies to Silicon Brick Road." }
  try { assertCanMutateOwner(session, active.owner.id) } catch (error) { return { error: error instanceof Error ? error.message : "Read-only access." } }

  await db.user.update({
    where: { id: active.owner.id },
    data: { sbrExternalLiquidityVerified: verified, updatedAt: new Date() },
  })

  for (const p of ["/settings", "/", "/reports", "/mission-control"]) revalidatePath(p)
  return { success: true }
}
