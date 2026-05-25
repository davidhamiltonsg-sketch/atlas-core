import { Shell } from "@/components/shell"
import { getSession } from "@/lib/session"
import { redirect } from "next/navigation"
import { db } from "@/lib/db"
import { SettingsClient } from "./client"

export default async function SettingsPage() {
  const session = await getSession()
  if (!session) redirect("/login")

  const user = await db.user.findUnique({ where: { id: session.userId } })

  return (
    <Shell title="Settings" subtitle="Account preferences and security" userName={session.name} isAdmin={session.role === "admin"}>
      <SettingsClient
        initialName={session.name}
        initialEmail={session.email}
        role={session.role}
        monthlyContribution={user?.monthlyContribution ?? 3000}
        annualLumpSum={user?.annualLumpSum ?? 20000}
        contributionGrowthRate={user?.contributionGrowthRate ?? 0.05}
      />
    </Shell>
  )
}
