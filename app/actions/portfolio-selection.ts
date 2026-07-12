"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { getSession, setPortfolioHint } from "@/lib/session"
import { setActivePortfolio } from "@/lib/active-portfolio"
import type { ConstitutionId } from "@/lib/constitutions"

export async function selectPortfolio(formData: FormData) {
  const session = await getSession()
  if (!session) redirect("/login")
  const requested = formData.get("portfolio")
  const requestedReturnTo = formData.get("returnTo")
  const id: ConstitutionId = requested === "silicon-brick-road" ? "silicon-brick-road" : "atlas-core"
  const returnTo = typeof requestedReturnTo === "string" && /^\/[a-z0-9\-/]*$/.test(requestedReturnTo)
    ? requestedReturnTo
    : "/"
  await setActivePortfolio(id)
  await setPortfolioHint(id)
  revalidatePath("/", "layout")
  redirect(returnTo)
}
