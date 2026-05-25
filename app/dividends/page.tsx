import { Shell } from "@/components/shell"
import { db } from "@/lib/db"
import { getSession } from "@/lib/session"
import { redirect } from "next/navigation"
import { DividendsClient } from "./client"

export default async function DividendsPage() {
  const session = await getSession()
  if (!session) redirect("/login")

  const [dividends, holdings] = await Promise.all([
    db.dividend.findMany({
      where: { userId: session.userId },
      orderBy: { paymentDate: "desc" },
    }),
    db.holding.findMany({
      where: { userId: session.userId },
      select: { ticker: true },
      orderBy: { targetPct: "desc" },
    }),
  ])

  const serialized = dividends.map(d => ({
    ...d,
    paymentDate: d.paymentDate.toISOString(),
    createdAt: d.createdAt.toISOString(),
  }))

  return (
    <Shell title="Dividends" subtitle="Track ETF dividend distributions" userName={session.name} isAdmin={session.role === "admin"}>
      <DividendsClient dividends={serialized} holdings={holdings} />
    </Shell>
  )
}
