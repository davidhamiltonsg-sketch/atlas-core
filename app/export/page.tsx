import { Shell } from "@/components/shell"
import { getSession } from "@/lib/session"
import { redirect } from "next/navigation"
import { ExportButtons } from "./client"

export default async function ExportPage() {
  const session = await getSession()
  if (!session) redirect("/login")

  return (
    <Shell title="Export Data" subtitle="Download your portfolio data as CSV" userName={session.name} isAdmin={session.role === "admin"}>
      <ExportButtons isAdmin={session.role === "admin"} />
    </Shell>
  )
}
