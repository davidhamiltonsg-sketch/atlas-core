import { Shell } from "@/components/shell"
import { db } from "@/lib/db"
import { getSession } from "@/lib/session"
import { redirect } from "next/navigation"
import { activePortfolioContext } from "@/lib/active-portfolio"
import { computeNextBestMove, type PositionInput, type NextMove } from "@/lib/next-best-move"
import { computeSbrNextMove, type SbrPosition } from "@/lib/sbr-engine"
import { SILICON_BRICK_ROAD as SBR } from "@/lib/constitutions"
import { getDealingWindow, isInDealingWindow } from "@/lib/constitution"
import { ATLAS_SPEC, SBR_SPEC } from "@/lib/portfolio-spec"
import { NextMoveScreen } from "@/components/next-move/next-move-screen"

// Live dealing-window countdown — never let a static cache freeze it.
export const dynamic = "force-dynamic"

const SBR_FUND_TICKERS = SBR.funds.map((f) => f.ticker)

function fmtDay(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
}

async function getNextData(userId: string, isSbr: boolean) {
  const [holdings, owner] = await Promise.all([
    db.holding.findMany({ where: { userId }, include: { snapshots: { orderBy: { date: "desc" }, take: 1 } } }),
    db.user.findUnique({ where: { id: userId }, select: { monthlyContribution: true } }),
  ])
  const totalValue = holdings.reduce((s, h) => s + (h.snapshots[0]?.value ?? 0), 0)
  const amount = owner?.monthlyContribution ?? (isSbr ? SBR_SPEC.monthlyContribution : ATLAS_SPEC.monthlyContribution)

  let move: NextMove
  if (isSbr) {
    // Mirror the SBR dashboard/digest position build (registry ranges over DB bands).
    const positions: SbrPosition[] = holdings
      .filter((h) => SBR_FUND_TICKERS.includes(h.ticker))
      .map((h) => {
        const f = SBR.funds.find((x) => x.ticker === h.ticker)
        const value = h.snapshots[0]?.value ?? 0
        return {
          ticker: h.ticker, name: h.name, color: f?.color ?? h.color, value,
          actualPct: totalValue > 0 ? (value / totalValue) * 100 : 0,
          targetPct: h.targetPct,
          rangeLow: f?.rangeLow ?? h.targetPct - h.toleranceBand,
          rangeHigh: f?.rangeHigh ?? h.targetPct + h.toleranceBand,
          hardCap: h.hardCapPct, floor: f?.floor,
          latestPrice: h.snapshots[0]?.price ?? 0, hi52: 0,
        }
      })
    move = computeSbrNextMove(positions, totalValue)
  } else {
    // Mirror how app/page.tsx builds engine inputs (Bitcoin-sleeve merge happens inside).
    const moveInputs: PositionInput[] = holdings.map((h) => {
      const value = h.snapshots[0]?.value ?? 0
      return {
        ticker: h.ticker, name: h.name, color: h.color, value,
        actualPct: totalValue > 0 ? (value / totalValue) * 100 : 0,
        targetPct: h.targetPct, hardCapPct: h.hardCapPct ?? null,
        toleranceBand: h.toleranceBand ?? 2.5,
        latestPrice: h.snapshots[0]?.price ?? 0,
      }
    })
    move = computeNextBestMove(moveInputs, amount)
  }

  // Whole shares this month's amount buys at the latest snapshot price of the selected fund.
  const selected = move.ticker ? holdings.find((h) => h.ticker === move.ticker) : undefined
  const latestPrice = selected?.snapshots[0]?.price ?? 0
  const shares = latestPrice > 0 ? Math.floor(amount / latestPrice) : null

  // Dealing window: opens the 3rd business day after the 15th, closes the last business day.
  const now = new Date()
  const window = getDealingWindow(now)
  const windowOpen = isInDealingWindow(now)
  let windowLabel: string
  if (windowOpen) {
    windowLabel = `Closes ${fmtDay(window.closes)}`
  } else if (now < window.opens) {
    const days = Math.ceil((window.opens.getTime() - now.getTime()) / 86_400_000)
    windowLabel = `Opens in ${days} day${days === 1 ? "" : "s"} — ${fmtDay(window.opens)}`
  } else {
    const next = getDealingWindow(new Date(now.getFullYear(), now.getMonth() + 1, 1))
    windowLabel = `This month's window has closed — next opens ${fmtDay(next.opens)}`
  }

  return { move, amount, shares, latestPrice: latestPrice > 0 ? latestPrice : null, windowOpen, windowLabel }
}

export default async function NextPage() {
  const session = await getSession()
  if (!session) redirect("/login")
  const active = await activePortfolioContext(session)
  const isSbr = active.constitutionId === "silicon-brick-road"
  const d = await getNextData(active.owner.id, isSbr)

  return (
    <Shell
      title={isSbr ? "What To Do Next" : "Next Move"}
      subtitle={isSbr ? "This month's action in one screen" : "This month's constitution-permitted action"}
      userName={session.name}
      isAdmin={session.role === "admin"}
      constitutionId={active.constitutionId}
    >
      <NextMoveScreen
        action={d.move.action}
        what={d.move.what}
        ticker={d.move.ticker}
        amount={d.amount}
        shares={d.shares}
        latestPrice={d.latestPrice}
        windowOpen={d.windowOpen}
        windowLabel={d.windowLabel}
        accent={isSbr ? "sky" : "violet"}
      />
    </Shell>
  )
}
