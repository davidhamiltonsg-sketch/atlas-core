import { Shell } from "@/components/shell"
import { getSession } from "@/lib/session"
import { redirect } from "next/navigation"
import { db } from "@/lib/db"
import { SettingsClient } from "./client"
import { activePortfolioContext } from "@/lib/active-portfolio"
import { getConstitution } from "@/lib/constitutions"

export default async function SettingsPage() {
  const session = await getSession()
  if (!session) redirect("/login")

  const active = await activePortfolioContext(session)
  const constitution = getConstitution(active.constitutionId)
  const user = await db.user.findUnique({ where: { id: active.owner.id } })

  return (
    <Shell title="Settings" subtitle={`${constitution.shortName} · contribution and forecast controls`} userName={session.name} isAdmin={session.role === "admin"} constitutionId={active.constitutionId}>
      <SettingsClient
        initialName={session.name}
        initialEmail={session.email}
        role={session.role}
        monthlyContribution={user?.monthlyContribution ?? 3000}
        annualLumpSum={user?.annualLumpSum ?? 20000}
        contributionGrowthRate={user?.contributionGrowthRate ?? 0.05}
        riskFreeRate={user?.riskFreeRate ?? 0.04}
        portfolioName={constitution.shortName}
        canEdit={session.role === "admin" || session.userId === active.owner.id}
      />
    </Shell>
  )
}
