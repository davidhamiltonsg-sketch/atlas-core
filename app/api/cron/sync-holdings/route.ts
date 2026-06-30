import { NextResponse } from "next/server"
import { revalidatePath } from "next/cache"
import { syncIbkrSnapshotsAllUsers } from "@/lib/holdings-sync"

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

  const result = await syncIbkrSnapshotsAllUsers()
  if (result.ok && result.snapshots > 0) {
    for (const p of ["/", "/portfolio", "/ytd", "/governance", "/reports", "/forecast", "/holdings"]) revalidatePath(p)
  }
  return NextResponse.json({ ran: true, at: new Date().toISOString(), ...result })
}
