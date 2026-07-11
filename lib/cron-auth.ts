import { timingSafeEqual } from "node:crypto"
import { NextResponse } from "next/server"

export function authorizeCron(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error("[cron] CRON_SECRET is not configured; refusing request")
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 })
  }

  const expected = Buffer.from(`Bearer ${secret}`)
  const supplied = Buffer.from(req.headers.get("authorization") ?? "")
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  return null
}
