import { NextResponse } from "next/server"
import { revalidatePath } from "next/cache"
import { syncIbkrSnapshotsAllUsers, syncIbkrActivityAllUsers } from "@/lib/holdings-sync"

export const maxDuration = 60
export const dynamic = "force-dynamic"

// Scheduled portfolio snapshot (Vercel Cron → vercel.json). Pulls live positions from IBKR
// Flex so the portfolio stays fresh even when the owner forgets to update it manually.
// No-op when IBKR isn't configured. Guarded by CRON_SECRET (same scheme as cron/daily).
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    if (req.headers.get("authorization") !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  } else {
    console.warn("[cron/sync-holdings] CRON_SECRET not set — endpoint is unauthenticated. Set CRON_SECRET in your env.")
  }

  // 1) Refresh position snapshots (units/value). 2) Import any new trades + contributions +
  // dividends so monthly activity is captured automatically instead of only on a manual import.
  const result = await syncIbkrSnapshotsAllUsers()
  const activity = await syncIbkrActivityAllUsers()
  if ((result.ok && result.snapshots > 0) || (activity.ok && (activity.trades > 0 || activity.dividends > 0))) {
    for (const p of ["/", "/portfolio", "/ytd", "/contributions", "/trades", "/governance", "/reports", "/forecast", "/holdings"]) revalidatePath(p)
  }
  return NextResponse.json({ ran: true, at: new Date().toISOString(), snapshots: result, activity })
}
