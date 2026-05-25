import { Shell } from "@/components/shell"
import { db } from "@/lib/db"
import { getSession } from "@/lib/session"
import { redirect } from "next/navigation"
import { WatchlistClient } from "./client"

export default async function WatchlistPage() {
  const session = await getSession()
  if (!session) redirect("/login")

  const items = await db.watchlistItem.findMany({
    where: { userId: session.userId },
    orderBy: { addedAt: "desc" },
  })

  const serialized = items.map(i => ({
    ...i,
    addedAt: i.addedAt.toISOString(),
  }))

  return (
    <Shell title="Watchlist" subtitle="Track potential future positions" userName={session.name} isAdmin={session.role === "admin"}>
      <WatchlistClient items={serialized} />
    </Shell>
  )
}
