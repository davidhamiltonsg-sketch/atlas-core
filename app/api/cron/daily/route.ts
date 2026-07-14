import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { buildGovernanceDigest } from "@/lib/governance-digest"
import { buildSbrDigest } from "@/lib/sbr-digest"
import { constitutionIdForEmail } from "@/lib/constitutions"
import { authorizeCron } from "@/lib/cron-auth"
import {
  sendGovernanceDigestEmail,
  sendSbrDigestEmail,
  sendCrashProtocolEmail,
  emailConfigured,
} from "@/lib/email"

export const maxDuration = 60
export const dynamic = "force-dynamic"

// Daily scheduled job — evaluates each user's portfolio against their constitution's
// rules and emails when there is something to act on.
//
// Atlas Core users → buildGovernanceDigest + sendGovernanceDigestEmail
// SBR users        → buildSbrDigest + sendSbrDigestEmail
// Crash protocol   → separate sendCrashProtocolEmail if threshold is breached
//
// Auth: Bearer CRON_SECRET header (sent automatically by Vercel Cron; set manually
// in Railway cron configuration).
export async function GET(req: Request) {
  const authError = authorizeCron(req)
  if (authError) return authError

  const users = await db.user.findMany({ select: { id: true, email: true } })
  const results: Array<{
    userId: string
    portfolio: string
    actionable: boolean
    emailed: boolean
    items: number
    reason?: string
  }> = []

  for (const u of users) {
    const portfolioId = constitutionIdForEmail(u.email)

    if (portfolioId === "silicon-brick-road") {
      // ── SBR path ──────────────────────────────────────────────────────────
      const digest = await buildSbrDigest(u.id)
      if (!digest) {
        results.push({ userId: u.id, portfolio: "sbr", actionable: false, emailed: false, items: 0, reason: "no digest" })
        continue
      }

      let emailed = false
      let reason: string | undefined
      if (digest.actionable && emailConfigured()) {
        try {
          const r = await sendSbrDigestEmail(
            digest.user.email,
            digest.user.name,
            digest.items,
            digest.nextMove,
            digest.phase,
            digest.totalValue,
          )
          emailed = !r.skipped
          if (r.skipped) reason = r.reason
        } catch (e) {
          reason = e instanceof Error ? e.message : "email failed"
        }
      } else if (!emailConfigured()) {
        reason = "RESEND_API_KEY not set"
      } else {
        reason = "nothing actionable"
      }

      results.push({ userId: u.id, portfolio: "sbr", actionable: digest.actionable, emailed, items: digest.items.length, reason })

    } else {
      // ── Atlas Core path ────────────────────────────────────────────────────
      const digest = await buildGovernanceDigest(u.id)
      if (!digest) {
        results.push({ userId: u.id, portfolio: "atlas", actionable: false, emailed: false, items: 0, reason: "no digest" })
        continue
      }

      let emailed = false
      let reason: string | undefined

      // Crash discipline: send the dedicated urgent email once, when the −25% threshold
      // is freshly crossed (the digest keeps reporting it daily while it stays breached).
      if (digest.drawdownPct !== null && digest.crashNewlyTriggered && emailConfigured()) {
        try {
          await sendCrashProtocolEmail(digest.user.email, digest.user.name, digest.drawdownPct)
          emailed = true
          reason = `crash protocol email sent (drawdown ${digest.drawdownPct.toFixed(1)}%)`
        } catch (e) {
          reason = `crash protocol email failed: ${e instanceof Error ? e.message : "unknown"}`
        }
      }

      // Regular governance digest — also send if actionable (the crash items are already in digest.items).
      if (digest.actionable && emailConfigured() && !emailed) {
        try {
          const r = await sendGovernanceDigestEmail(digest.user.email, digest.user.name, digest.items)
          emailed = !r.skipped
          if (r.skipped) reason = r.reason
        } catch (e) {
          reason = e instanceof Error ? e.message : "email failed"
        }
      } else if (!emailConfigured()) {
        reason = "RESEND_API_KEY not set"
      } else if (!digest.actionable && !emailed) {
        reason = "nothing actionable"
      }

      results.push({ userId: u.id, portfolio: "atlas", actionable: digest.actionable, emailed, items: digest.items.length, reason })
    }
  }

  return NextResponse.json({ ran: true, at: new Date().toISOString(), results })
}
