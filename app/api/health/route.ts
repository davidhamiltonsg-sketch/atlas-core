import { NextResponse } from "next/server"
import { getSession } from "@/lib/session"

export const dynamic = "force-dynamic"

export async function GET() {
  // DB connection test (the only signal a public liveness probe needs).
  let dbOk = false
  let dbError: string | undefined
  try {
    const { db } = await import("@/lib/db")
    await db.user.count()
    dbOk = true
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err)
  }

  // Anonymous callers (uptime monitors) get a minimal liveness response only —
  // no config or user-count disclosure.
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ ok: dbOk }, { status: dbOk ? 200 : 503 })
  }

  // Authenticated: full diagnostics (env-var presence, never values).
  const { db } = await import("@/lib/db")
  return NextResponse.json({
    ok: dbOk,
    db: dbOk ? { ok: true, userCount: await db.user.count() } : { ok: false, error: dbError },
    env: {
      DATABASE_URL:        !!process.env.DATABASE_URL,
      DATABASE_AUTH_TOKEN: !!process.env.DATABASE_AUTH_TOKEN,
      SESSION_SECRET:      !!process.env.SESSION_SECRET,
      FINNHUB_API_KEY:     !!process.env.FINNHUB_API_KEY,
      RESEND_API_KEY:      !!process.env.RESEND_API_KEY,
      CRON_SECRET:         !!process.env.CRON_SECRET,
      ANTHROPIC_API_KEY:   !!process.env.ANTHROPIC_API_KEY,
      IBKR_FLEX_TOKEN:              !!process.env.IBKR_FLEX_TOKEN,
      IBKR_FLEX_QUERY_ID:           !!process.env.IBKR_FLEX_QUERY_ID,
      IBKR_FLEX_QUERY_ID_ACTIVITY:  !!process.env.IBKR_FLEX_QUERY_ID_ACTIVITY,
    },
  })
}
