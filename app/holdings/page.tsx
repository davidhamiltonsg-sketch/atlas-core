import { Shell } from "@/components/shell"
import { db } from "@/lib/db"
import { getSession } from "@/lib/session"
import { redirect } from "next/navigation"
import { constitutionIdForEmail } from "@/lib/constitutions"
import { HoldingsClient } from "./client"

export default async function HoldingsPage() {
  const session = await getSession()
  if (!session) redirect("/login")
  const constitutionId = constitutionIdForEmail(session.email)
  const isSbr = constitutionId === "silicon-brick-road"

  const holdings = await db.holding.findMany({
    where: { userId: session.userId },
    include: {
      snapshots: {
        orderBy: { date: "desc" },
        take: 1,
      },
      _count: { select: { snapshots: true } },
    },
    orderBy: { targetPct: "desc" },
  })

  const serialized = holdings.map(h => ({
    id: h.id,
    ticker: h.ticker,
    name: h.name,
    targetPct: h.targetPct,
    hardCapPct: h.hardCapPct,
    toleranceBand: h.toleranceBand,
    color: h.color,
    snapshotCount: h._count.snapshots,
    latestValue: h.snapshots[0]?.value ?? null,
  }))

  const totalTargetPct = serialized.reduce((s, h) => s + h.targetPct, 0)

  return (
    <Shell title={isSbr ? "Your Funds" : "Holdings"} subtitle={isSbr ? "Add or update the four funds you hold" : "Add, edit, or remove assets from your portfolio"} userName={session.name} isAdmin={session.role === "admin"}>
      <HoldingsClient holdings={serialized} totalTargetPct={totalTargetPct} constitutionId={constitutionId} />
    </Shell>
  )
}
