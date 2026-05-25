import { Shell } from "@/components/shell"
import { db } from "@/lib/db"
import { getSession } from "@/lib/session"
import { redirect } from "next/navigation"
import { ContributionsClient } from "./client"

export default async function ContributionsPage() {
  const session = await getSession()
  if (!session) redirect("/login")

  const [contributions, user] = await Promise.all([
    db.contributionRecord.findMany({
      where: { userId: session.userId },
      orderBy: { date: "desc" },
    }),
    db.user.findUnique({ where: { id: session.userId } }),
  ])

  const serialized = contributions.map(c => ({
    ...c,
    date: c.date.toISOString(),
    createdAt: c.createdAt.toISOString(),
  }))

  return (
    <Shell title="Contributions" subtitle="Month-by-month contribution history" userName={session.name} isAdmin={session.role === "admin"}>
      <ContributionsClient
        contributions={serialized}
        monthlyTarget={user?.monthlyContribution ?? 3000}
      />
    </Shell>
  )
}
