import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET() {
  const checks: Record<string, unknown> = {}

  // Env vars present (not values)
  checks.env = {
    DATABASE_URL:        !!process.env.DATABASE_URL,
    DATABASE_AUTH_TOKEN: !!process.env.DATABASE_AUTH_TOKEN,
    SESSION_SECRET:      !!process.env.SESSION_SECRET,
    ANTHROPIC_API_KEY:   !!process.env.ANTHROPIC_API_KEY,
    IBKR_FLEX_TOKEN:              !!process.env.IBKR_FLEX_TOKEN,
    IBKR_FLEX_QUERY_ID:           !!process.env.IBKR_FLEX_QUERY_ID,
    IBKR_FLEX_QUERY_ID_ACTIVITY:  !!process.env.IBKR_FLEX_QUERY_ID_ACTIVITY,
  }

  // DB connection test
  try {
    const { db } = await import("@/lib/db")
    const userCount = await db.user.count()
    checks.db = { ok: true, userCount }
  } catch (err) {
    checks.db = { ok: false, error: err instanceof Error ? err.message : String(err) }
  }

  return NextResponse.json(checks)
}
