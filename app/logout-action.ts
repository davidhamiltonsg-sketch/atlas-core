"use server"

import { redirect } from "next/navigation"
import { deleteSession, clearPortfolioHint } from "@/lib/session"
import { clearActivePortfolio } from "@/lib/active-portfolio"

export async function logoutAction() {
  await deleteSession()
  await clearPortfolioHint()
  await clearActivePortfolio()
  redirect("/")
}
