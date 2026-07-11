import { SignJWT, jwtVerify } from "jose"
import { cookies } from "next/headers"

function getSecret(): Uint8Array {
  const rawSecret = process.env.SESSION_SECRET ?? (process.env.NODE_ENV === "production" ? "" : "atlas-core-local-development-only")
  if (!rawSecret) {
    // Validate when authentication is used, not while Next.js examines the module graph.
    // Production requests still fail closed; builds do not require runtime secrets.
    throw new Error("[atlas-core] SESSION_SECRET env var is not set.")
  }
  return new TextEncoder().encode(rawSecret)
}
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
    .sign(getSecret())


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
    const { payload } = await jwtVerify(token, getSecret())
    return payload as unknown as SessionPayload
  } catch {
    return null
  }
}

export async function deleteSession() {
  const cookieStore = await cookies()
  cookieStore.delete(COOKIE)
}

// ─── Portfolio hint ─────────────────────────────────────────────────────────
// A small, non-httpOnly cookie recording which constitution the signed-in user
// belongs to. It carries no auth value (the real session lives in the signed
// JWT above) — it exists purely so the loading splash can show the right
// single brand mark instead of the "which portfolio?" dual splash once a user
// is known, without an extra DB round trip during a Suspense fallback.
const HINT_COOKIE = "portfolio_hint"

export async function setPortfolioHint(constitutionId: "atlas-core" | "silicon-brick-road") {
  const cookieStore = await cookies()
  cookieStore.set(HINT_COOKIE, constitutionId, {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: EXPIRES_IN,
    path: "/",
  })
}

export async function clearPortfolioHint() {
  const cookieStore = await cookies()
  cookieStore.delete(HINT_COOKIE)
}

export async function getPortfolioHint(): Promise<"atlas-core" | "silicon-brick-road" | null> {
  const cookieStore = await cookies()
  const value = cookieStore.get(HINT_COOKIE)?.value
  return value === "atlas-core" || value === "silicon-brick-road" ? value : null
}
