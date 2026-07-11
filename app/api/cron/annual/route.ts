import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { constitutionIdForEmail, SILICON_BRICK_ROAD, ATLAS_CORE } from "@/lib/constitutions"
import { sendAnnualAuditEmail, emailConfigured } from "@/lib/email"
import { authorizeCron } from "@/lib/cron-auth"

export const maxDuration = 30
export const dynamic = "force-dynamic"

// Annual scheduled job — fires January 1 each year. Sends each user a
// constitution audit reminder with a portfolio-specific checklist.
//
// Auth: Bearer CRON_SECRET header.
export async function GET(req: Request) {
  const authError = authorizeCron(req)
  if (authError) return authError

  if (!emailConfigured()) {
    return NextResponse.json({ ran: false, reason: "RESEND_API_KEY not set" })
  }

  const users = await db.user.findMany({ select: { id: true, email: true, name: true } })
  const results: Array<{ userId: string; emailed: boolean; portfolio: string; reason?: string }> = []

  for (const u of users) {
    const portfolioId = constitutionIdForEmail(u.email)
    const isAtlas = portfolioId === "atlas-core"
    const constitution = isAtlas ? ATLAS_CORE : SILICON_BRICK_ROAD
    const portfolioType = isAtlas ? "atlas-core" as const : "silicon-brick-road" as const

    try {
      const r = await sendAnnualAuditEmail(u.email, u.name, portfolioType, constitution.version)
      results.push({ userId: u.id, portfolio: portfolioId, emailed: !r.skipped, reason: r.skipped ? r.reason : undefined })
    } catch (e) {
      results.push({ userId: u.id, portfolio: portfolioId, emailed: false, reason: e instanceof Error ? e.message : "unknown error" })
    }
  }

  return NextResponse.json({ ran: true, at: new Date().toISOString(), year: new Date().getFullYear(), results })
}
