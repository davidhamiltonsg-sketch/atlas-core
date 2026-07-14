"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { getSession, setPortfolioHint } from "@/lib/session"
import { homePortfolioId, setActivePortfolio } from "@/lib/active-portfolio"
import { canViewAllPortfolios, type ConstitutionId } from "@/lib/constitutions"

export async function selectPortfolio(formData: FormData) {
  const session = await getSession()
  if (!session) redirect("/login")
  const requested = formData.get("portfolio")
  const requestedReturnTo = formData.get("returnTo")
  let id: ConstitutionId = requested === "silicon-brick-road" ? "silicon-brick-road" : "atlas-core"
  // Only admins and cross-view accounts may switch away from their own portfolio.
  if (id !== homePortfolioId(session) && !canViewAllPortfolios(session.email, session.role)) {
    id = homePortfolioId(session)
  }
  const returnTo = typeof requestedReturnTo === "string" && /^\/[a-z0-9\-/]*$/.test(requestedReturnTo)
    ? requestedReturnTo
    : "/"
  await setActivePortfolio(id)
  await setPortfolioHint(id)
  revalidatePath("/", "layout")
  redirect(returnTo)
}
