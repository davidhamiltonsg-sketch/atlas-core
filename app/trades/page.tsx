import { Shell } from "@/components/shell"
import { db } from "@/lib/db"
import { getSession } from "@/lib/session"
import { redirect } from "next/navigation"
import { TradesClient } from "./client"

export default async function TradesPage() {
  const session = await getSession()
  if (!session) redirect("/login")

  const [trades, holdings] = await Promise.all([
    db.trade.findMany({
      where: { userId: session.userId },
      orderBy: { date: "desc" },
    }),
    db.holding.findMany({
      where: { userId: session.userId },
      select: { ticker: true },
      orderBy: { targetPct: "desc" },
    }),
  ])

  const serialized = trades.map(t => ({
    ...t,
    date: t.date.toISOString(),
    createdAt: t.createdAt.toISOString(),
  }))

  return (
    <Shell title="Trade Log" subtitle="Record and review all buy and sell transactions" userName={session.name} isAdmin={session.role === "admin"}>
      <TradesClient trades={serialized} holdings={holdings} />
    </Shell>
  )
}
