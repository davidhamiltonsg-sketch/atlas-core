"use server"

import { redirect } from "next/navigation"
import bcrypt from "bcryptjs"
import { headers } from "next/headers"
import { db } from "@/lib/db"
import { createSession } from "@/lib/session"

// ── Simple in-memory rate limiter ────────────────────────────────────────────
// Tracks failed attempts per IP. Resets after WINDOW_MS.
// Good enough for a personal app; replace with Redis for multi-instance deploys.
const MAX_ATTEMPTS = 5
const WINDOW_MS = 10 * 60 * 1000 // 10 minutes
const LOCKOUT_MS = 15 * 60 * 1000 // 15 minutes after max attempts

type RateLimitEntry = { attempts: number; firstAttempt: number; lockedUntil?: number }
const rateLimitMap = new Map<string, RateLimitEntry>()

function getRateLimit(ip: string): RateLimitEntry {
  const now = Date.now()
  const entry = rateLimitMap.get(ip)
  if (!entry || now - entry.firstAttempt > WINDOW_MS) {
    return { attempts: 0, firstAttempt: now }
  }
  return entry
}

function recordFailure(ip: string): RateLimitEntry {
  const entry = getRateLimit(ip)
  entry.attempts += 1
  if (entry.attempts >= MAX_ATTEMPTS) {
    entry.lockedUntil = Date.now() + LOCKOUT_MS
  }
  rateLimitMap.set(ip, entry)
  return entry
}

function clearRateLimit(ip: string) {
  rateLimitMap.delete(ip)
}
// ─────────────────────────────────────────────────────────────────────────────

export async function loginAction(formData: FormData) {
  // Determine caller IP for rate limiting
  const headerStore = await headers()
  const ip =
    headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headerStore.get("x-real-ip") ??
    "unknown"

  const rateEntry = getRateLimit(ip)
  if (rateEntry.lockedUntil && Date.now() < rateEntry.lockedUntil) {
    const remaining = Math.ceil((rateEntry.lockedUntil - Date.now()) / 60_000)
    return { error: `Too many failed attempts. Try again in ${remaining} minute${remaining === 1 ? "" : "s"}.` }
  }

  const email = (formData.get("email") as string)?.trim().toLowerCase()
  const password = formData.get("password") as string

  if (!email || !password) {
    return { error: "Email and password are required." }
  }

  const user = await db.user.findUnique({ where: { email } })
  if (!user) {
    recordFailure(ip)
    return { error: "Invalid email or password." }
  }

  const valid = await bcrypt.compare(password, user.passwordHash)
  if (!valid) {
    const entry = recordFailure(ip)
    const remaining = MAX_ATTEMPTS - entry.attempts
    if (remaining > 0) {
      return { error: `Invalid email or password. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.` }
    }
    return { error: "Too many failed attempts. Account locked for 15 minutes." }
  }

  clearRateLimit(ip)

  await createSession({
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  })

  redirect("/")
}
