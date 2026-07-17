"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { getSession } from "@/lib/session"
import { activePortfolioContext } from "@/lib/active-portfolio"
import { assertCanMutateOwner } from "@/lib/mutation-auth"
import { sgtMonthKey } from "@/lib/sgt-date"

/**
 * One-tap execution log from the "This month" screen. Appends a GovernanceLog
 * TRADE_EXECUTED entry (Art. XXII append-only ledger) plus the existing behaviour-log
 * "execution" note so the cockpit's "Last done" strip updates too.
 *
 * Idempotent per calendar month (SGT): the entry carries a [this-month:YYYY-MM] marker
 * and the action refuses a second log for the same month — the button disables after use.
 */
export async function logThisMonthExecution(
  ticker: string,
  shares: number,
): Promise<{ success?: true; error?: string }> {
  const session = await getSession()
  if (!session) return { error: "Unauthenticated." }
  const active = await activePortfolioContext(session)
  try { assertCanMutateOwner(session, active.owner.id) } catch (error) {
    return { error: error instanceof Error ? error.message : "Read-only access." }
  }

  const sym = ticker?.trim().toUpperCase().slice(0, 12)
  const units = Math.floor(shares)
  if (!sym || !(units > 0)) return { error: "Nothing to log — no whole shares this month." }

  const monthKey = sgtMonthKey(new Date())
  const marker = `[this-month:${monthKey}]`
  const existing = await db.governanceLog.findFirst({
    where: { userId: active.owner.id, event: "TRADE_EXECUTED", details: { contains: marker } },
  })
  if (existing) return { error: "This month's purchase is already logged." }

  await db.governanceLog.create({
    data: {
      userId: active.owner.id,
      event: "TRADE_EXECUTED",
      details: `${marker} Bought ${units} share${units === 1 ? "" : "s"} of ${sym} — logged from the This Month screen.`,
    },
  })
  // Mirror into the behaviour journal so getRecentExecutions ("Last done") sees it.
  await db.behaviourLog.create({
    data: { userId: active.owner.id, type: "execution", note: `Bought ${units} × ${sym} (this month's plan)`, date: new Date() },
  })

  revalidatePath("/next")
  revalidatePath("/")
  revalidatePath("/compliance")
  return { success: true }
}
