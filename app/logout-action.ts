"use server"

import { redirect } from "next/navigation"
import { deleteSession, clearPortfolioHint } from "@/lib/session"

export async function logoutAction() {
  await deleteSession()
  await clearPortfolioHint()
  redirect("/")
}
