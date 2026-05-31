import { SignJWT, jwtVerify } from "jose"
import { cookies } from "next/headers"

const rawSecret = process.env.SESSION_SECRET ?? "atlas-core-secret-key-change-in-production"

if (
  process.env.NODE_ENV === "production" &&
  rawSecret === "atlas-core-secret-key-change-in-production"
) {
  // Crash loudly rather than silently run with a known-weak secret
  throw new Error(
    "[atlas-core] SESSION_SECRET env var is not set. " +
      "Set a strong random secret in your .env (e.g. openssl rand -hex 32)."
  )
}

const SECRET = new TextEncoder().encode(rawSecret)
const COOKIE = "atlas_session"
const EXPIRES_IN = 60 * 60 * 24 * 7 // 7 days

export interface SessionPayload {
  userId: string
  email: string
  name: string
  role: string
}

export async function createSession(payload: SessionPayload) {
  const token = await new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${EXPIRES_IN}s`)
    .sign(SECRET)


  const cookieStore = await cookies()
  cookieStore.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: EXPIRES_IN,
    path: "/",
  })
}

export async function getSession(): Promise<SessionPayload | null> {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get(COOKIE)?.value
    if (!token) return null
    const { payload } = await jwtVerify(token, SECRET)
    return payload as unknown as SessionPayload
  } catch {
    return null
  }
}

export async function deleteSession() {
  const cookieStore = await cookies()
  cookieStore.delete(COOKIE)
}
