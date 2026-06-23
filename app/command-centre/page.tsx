import { Shell } from "@/components/shell"
import { getSession } from "@/lib/session"
import { redirect } from "next/navigation"
import { db } from "@/lib/db"
import { CommandCentreClient } from "@/components/command-centre/command-centre-client"
import { computeNextBestMove, type PositionInput } from "@/lib/next-best-move"

async function getLivePortfolioData(userId: string) {
  const holdings = await db.holding.findMany({
    where: { userId },
    include: { snapshots: { orderBy: { date: "desc" }, take: 1 } },
  })

  const positions = holdings.map((h) => ({
    ticker: h.ticker,
    name: h.name,
    color: h.color,
    targetPct: h.targetPct,
    hardCapPct: h.hardCapPct ?? null,
    toleranceBand: h.toleranceBand ?? 2.5,
    latestValue: h.snapshots[0]?.value ?? 0,
    latestUnits: h.snapshots[0]?.units ?? 0,
    latestPrice: h.snapshots[0]?.price ?? 0,
  }))

  const totalValue = positions.reduce((s, p) => s + p.latestValue, 0)

  // Compute the single highest-priority action (market-aware)
  const moveInputs: PositionInput[] = positions.map((p) => ({
    ticker: p.ticker, name: p.name, color: p.color, value: p.latestValue,
    actualPct: totalValue > 0 ? (p.latestValue / totalValue) * 100 : 0,
    targetPct: p.targetPct, hardCapPct: p.hardCapPct,
    toleranceBand: p.toleranceBand, latestPrice: p.latestPrice,
  }))
  const nextBestMove = computeNextBestMove(moveInputs, totalValue)

  return { positions, totalValue, nextBestMove }
}

export default async function CommandCentrePage() {
  const session = await getSession()
  if (!session) redirect("/login")

  const { positions, totalValue, nextBestMove } = await getLivePortfolioData(session.userId)

  return (
    <Shell
      title="Command Centre"
      subtitle="Grow faster. Protect smarter. Know exactly what to do and when."
      userName={session.name}
      isAdmin={session.role === "admin"}
    >
      <CommandCentreClient positions={positions} totalValue={totalValue} nextBestMove={nextBestMove} />
    </Shell>
  )
}
