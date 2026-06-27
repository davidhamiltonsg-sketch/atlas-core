import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { buildGovernanceDigest } from "@/lib/governance-digest"
import { sendGovernanceDigestEmail, emailConfigured } from "@/lib/email"

export const maxDuration = 60
export const dynamic = "force-dynamic"

// Daily scheduled job (Vercel Cron → vercel.json). Evaluates the portfolio against the
// rules while no one is on the page, and emails the user when there is something to act on.
// This is the automation layer that makes governance reach out instead of waiting for a visit.
//
// Auth: when CRON_SECRET is set, requests must send `Authorization: Bearer <CRON_SECRET>`
// (Vercel Cron sends this automatically when the env var is present). With no secret set,
// the route still runs (useful in dev) but logs a warning.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get("authorization")
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  } else {
    console.warn("[cron/daily] CRON_SECRET not set — endpoint is unauthenticated. Set CRON_SECRET in your env.")
  }

  // Single-user app: notify every user that has an email (normally just one).
  const users = await db.user.findMany({ select: { id: true } })
  const results: Array<{ userId: string; actionable: boolean; emailed: boolean; items: number; reason?: string }> = []

  for (const u of users) {
    const digest = await buildGovernanceDigest(u.id)
    if (!digest) { results.push({ userId: u.id, actionable: false, emailed: false, items: 0, reason: "no digest" }); continue }

    let emailed = false
    let reason: string | undefined
    if (digest.actionable && emailConfigured()) {
      try {
        const r = await sendGovernanceDigestEmail(digest.user.email, digest.user.name, digest.items)
        emailed = !r.skipped
        if (r.skipped) reason = r.reason
      } catch (e) {
        reason = e instanceof Error ? e.message : "email failed"
      }
    } else if (!emailConfigured()) {
      reason = "RESEND_API_KEY not set"
    } else if (!digest.actionable) {
      reason = "nothing actionable"
    }

    results.push({ userId: u.id, actionable: digest.actionable, emailed, items: digest.items.length, reason })
  }

  return NextResponse.json({ ran: true, at: new Date().toISOString(), results })
}
