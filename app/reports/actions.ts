"use server"

import { getSession } from "@/lib/session"
import { revalidatePath } from "next/cache"
import { refreshEtfLookThrough } from "@/lib/look-through-refresh"

// ── Manual look-through refresh ──────────────────────────────────────────────
// The fetch/derive/upsert machinery lives in lib/look-through-refresh.ts so the
// daily cron can run the same refresh without a session. This action is the
// button-press path only: authenticate, refresh, revalidate.

export async function refreshLookThroughAction(): Promise<{
  success?: boolean
  updated?: string[]
  errors?: string[]
  error?: string
}> {
  const session = await getSession()
  if (!session) return { error: "Unauthenticated." }
  // Any authenticated user can refresh (it's read-only data from Yahoo)

  const { updated, errors } = await refreshEtfLookThrough()

  revalidatePath("/reports")
  revalidatePath("/mission-control")
  revalidatePath("/")

  if (updated.length === 0) {
    return { error: `Refresh failed for all tickers. ${errors.join("; ")}` }
  }

  return {
    success: true,
    updated,
    errors: errors.length > 0 ? errors : undefined,
  }
}
