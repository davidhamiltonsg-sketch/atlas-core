import { NextResponse } from "next/server"
import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { provisionDami } from "@/lib/provision-dami"

export const dynamic = "force-dynamic"

// One-time (idempotent) Silicon Brick Road provisioning for Dami — Vercel-native, so the
// `dami_key` env var never has to leave Vercel. Sign in as an admin (David) and POST here once
// after setting `dami_key` in the Vercel project env.
export async function POST() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })
  if (session.role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 })

  const result = await provisionDami(db)
  if (!result.ok) return NextResponse.json(result, { status: 400 })
  return NextResponse.json({ ...result, note: "Dami provisioned. He can log in at /login with dami_key." })
}
