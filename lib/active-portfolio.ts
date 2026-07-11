import { cookies } from "next/headers"
import { db } from "@/lib/db"
import type { SessionPayload } from "@/lib/session"
import { constitutionIdForEmail, type ConstitutionId } from "@/lib/constitutions"

const COOKIE = "active_portfolio"
export const SBR_OWNER_EMAIL = "dutszm@gmail.com"

export async function activePortfolioId(session: SessionPayload): Promise<ConstitutionId> {
  const value = (await cookies()).get(COOKIE)?.value
  if (value === "atlas-core" || value === "silicon-brick-road") return value
  return session.role === "admin" ? "atlas-core" : constitutionIdForEmail(session.email)
}

export async function setActivePortfolio(id: ConstitutionId) {
  ;(await cookies()).set(COOKIE, id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  })
}

export async function portfolioOwner(id: ConstitutionId) {
  if (id === "silicon-brick-road") {
    return db.user.findUnique({ where: { email: SBR_OWNER_EMAIL } })
  }
  return db.user.findFirst({ where: { role: "admin" }, orderBy: { createdAt: "asc" } })
}

export async function activePortfolioContext(session: SessionPayload) {
  const constitutionId = await activePortfolioId(session)
  const owner = await portfolioOwner(constitutionId)
  return { constitutionId, owner: owner ?? { id: session.userId, name: session.name, email: session.email } }
}
