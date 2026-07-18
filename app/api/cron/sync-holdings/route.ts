import { NextResponse } from "next/server"
import { revalidatePath } from "next/cache"
import { syncIbkrSnapshotsAllUsers, syncIbkrActivityAllUsers } from "@/lib/holdings-sync"
import { recordIbkrSync } from "@/lib/ibkr-rate-limiter"
import { recordSyncAttempt } from "@/lib/sync-status"
import { authorizeCron } from "@/lib/cron-auth"
import { db } from "@/lib/db"

export const maxDuration = 60
export const dynamic = "force-dynamic"

// Scheduled portfolio snapshot (Vercel Cron → vercel.json). Pulls live positions from IBKR
// Flex so the portfolio stays fresh even when the owner forgets to update it manually.
// No-op when IBKR isn't configured. Guarded by CRON_SECRET (same scheme as cron/daily).
export async function GET(req: Request) {
  const authError = authorizeCron(req)
  if (authError) return authError

  // 1) Refresh position snapshots (units/value). 2) Import any new trades + contributions +
  // dividends so monthly activity is captured automatically instead of only on a manual import.
  const result = await syncIbkrSnapshotsAllUsers()
  const activity = await syncIbkrActivityAllUsers()
  const ok = result.ok && activity.ok
  const portfolioOwners = await db.user.findMany({ select: { id: true } })
  for (const owner of portfolioOwners) {
    await recordSyncAttempt(owner.id, "cron", ok ? "success" : "failure", ok ? undefined : (result.reason ?? activity.reason))
  }
  if ((result.ok && result.snapshots > 0) || (activity.ok && (activity.trades > 0 || activity.dividends > 0))) {
    for (const p of ["/", "/portfolio", "/contributions", "/next", "/compliance", "/reports", "/forecast", "/risk", "/mission-control"]) revalidatePath(p)

    // Record sync for rate limiting — every user the sync actually covers.
    for (const owner of portfolioOwners) {
      await recordIbkrSync(owner.id)
    }
  }
  return NextResponse.json({ ran: true, at: new Date().toISOString(), snapshots: result, activity })
}
