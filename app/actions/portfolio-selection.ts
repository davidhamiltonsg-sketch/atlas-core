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
  const id: ConstitutionId = requested === "silicon-brick-road" ? "silicon-brick-road" : "atlas-core"
  await setActivePortfolio(id)
  await setPortfolioHint(id)
  revalidatePath("/", "layout")
  redirect("/")
}
