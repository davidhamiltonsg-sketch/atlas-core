import { Shell } from "@/components/shell"
import { db } from "@/lib/db"
import { getSession } from "@/lib/session"
import { redirect } from "next/navigation"
import { activePortfolioContext } from "@/lib/active-portfolio"
import { computeNextBestMove, computeMarketAwareDca, type PositionInput, type NextMove, type DcaPlan } from "@/lib/next-best-move"
import { computeSbrNextMove, computeSbrDca, type SbrPosition } from "@/lib/sbr-engine"
import { computeLadder, type LadderInstruction } from "@/lib/ladder"
import { SILICON_BRICK_ROAD as SBR } from "@/lib/constitutions"
import { ATLAS_SPEC, SBR_SPEC } from "@/lib/portfolio-spec"
import { planWholeSharePurchases, type DcaPrice } from "@/lib/dca-cash-bank"
import { getCachedUsdSgdRate } from "@/lib/fx-cache"
import { money, convert } from "@/lib/money"
import { formatCurrency } from "@/lib/utils"
import { sgtToday, sgtMonthKey, dealingWindowStatus } from "@/lib/sgt-date"
import { foldDuplicateHoldings } from "@/lib/holding-duplicates"
import { NextMoveScreen } from "@/components/next-move/next-move-screen"
import { LogExecutionButton } from "@/components/next-move/log-execution-button"
import { DecisionLadderCard } from "@/components/cockpit/decision-ladder-card"
import { ChevronDown } from "lucide-react"

// Live dealing-window countdown — never let a static cache freeze it.
export const dynamic = "force-dynamic"

const SBR_FUND_TICKERS = SBR.funds.map((f) => f.ticker)

function fmtDay(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
}

async function getNextData(userId: string, constitutionId: string) {
  const isSbr = constitutionId === "silicon-brick-road"
  const [rawHoldings, owner, cashBank] = await Promise.all([
    db.holding.findMany({ where: { userId }, include: { snapshots: { orderBy: { date: "desc" }, take: 1 } } }),
    db.user.findUnique({ where: { id: userId }, select: { monthlyContribution: true } }),
    db.dcaCashBank.findUnique({ where: { userId_constitutionId_currency: { userId, constitutionId, currency: "SGD" } } }),
  ])
  // Duplicate same-ticker rows fold into one row (units/value summed) — keeps the
  // whole-share planner's per-ticker price map coherent. See lib/holding-duplicates.ts.
  const holdings = foldDuplicateHoldings(rawHoldings)
  const totalValue = holdings.reduce((s, h) => s + (h.snapshots[0]?.value ?? 0), 0)
  const bankBalance = cashBank?.balance ?? 0

  // Plan amount. Atlas: the owner setting is USD (Art. XIII — US$3,000/month; reporting is
  // SGD), converted once at the declared money boundary. SBR: the plan is SGD natively.
  const planAmount = owner?.monthlyContribution ?? (isSbr ? SBR_SPEC.monthlyContribution : ATLAS_SPEC.monthlyContribution)
  const usdSgdRate = isSbr ? 1 : await getCachedUsdSgdRate()
  const amountSgd = isSbr ? planAmount : convert(money(planAmount, "USD"), "SGD", usdSgdRate).amount
  const amountPrimary = formatCurrency(planAmount, isSbr ? "SGD" : "USD")
  const amountSecondary = isSbr ? null : `≈ ${formatCurrency(amountSgd, "SGD")} at ${usdSgdRate.toFixed(4)}`

  let move: NextMove
  let dca: DcaPlan
  let ladder: LadderInstruction | null = null
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
    dca = computeSbrDca(positions, amountSgd)
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
    move = computeNextBestMove(moveInputs, planAmount)
    dca = computeMarketAwareDca(moveInputs, amountSgd)
    // Same ladder build as the monthly reminder cron — allocation/drift view, no market overlay.
    ladder = computeLadder(moveInputs, totalValue, {})
  }

  // Whole-share plan: bank + this month's cash against SGD prices. Snapshot prices are
  // quoted in each instrument's trading currency (USD/EUR), so the robust SGD price per
  // unit is the snapshot's SGD value divided by units.
  const sgdPriceOf = new Map<string, number>(
    holdings.map((h) => {
      const s = h.snapshots[0]
      return [h.ticker, s && s.units > 0 && s.value > 0 ? s.value / s.units : 0]
    }),
  )
  const prices: DcaPrice[] = [...sgdPriceOf].map(([ticker, price]) => ({ ticker, price, fxToBank: 1, commission: 0 }))
  const plan = planWholeSharePurchases(dca, prices, bankBalance, amountSgd)
  const instruction = plan.instructions.find((i) => i.ticker === move.ticker) ?? plan.instructions[0] ?? null

  // The ticker the cash actually buys. When a cap/ceiling fires, move.ticker names the
  // paused fund while the DCA plan routes the money to the eligible destination — the
  // share tile, plan line and log button must all follow the destination.
  const buyTicker = instruction?.ticker ?? (dca.allocations.find((a) => a.amount > 0)?.ticker ?? move.ticker)
  const selectedSgdPrice = instruction
    ? instruction.securityCost / Math.max(1, instruction.units)
    : buyTicker ? (sgdPriceOf.get(buyTicker) ?? 0) : 0
  const shares = instruction ? instruction.units : selectedSgdPrice > 0 ? 0 : null

  let planLine: string | null = null
  if (buyTicker && selectedSgdPrice > 0 && shares !== null) {
    const carry = formatCurrency(plan.closingBank, "SGD")
    planLine = isSbr
      ? `Set-aside cash ${formatCurrency(bankBalance, "SGD")} + this month's ${formatCurrency(amountSgd, "SGD")} buys ${shares} whole share${shares === 1 ? "" : "s"} of ${buyTicker}; ${carry} waits for next time.`
      : `Cash bank ${formatCurrency(bankBalance, "SGD")} + this month ${formatCurrency(amountSgd, "SGD")} ≈ ${shares} whole share${shares === 1 ? "" : "s"} of ${buyTicker} at ${formatCurrency(selectedSgdPrice, "SGD")}; ${carry} carries forward.`
  }

  // Dealing window — Singapore-anchored, from the one canonical getDealingWindow.
  const today = sgtToday()
  const window = dealingWindowStatus(today)
  let windowLabel: string
  if (window.isOpen) {
    windowLabel = `Closes ${fmtDay(window.closes)}`
  } else if (window.daysUntilOpen !== null) {
    windowLabel = `Opens in ${window.daysUntilOpen} day${window.daysUntilOpen === 1 ? "" : "s"} — ${fmtDay(window.opens)}`
  } else {
    const next = dealingWindowStatus({ y: today.y, m: today.m + 1, d: 1 })
    windowLabel = `This month's window has closed — next opens ${fmtDay(next.opens)}`
  }

  // Execution loop — has this month's purchase already been logged?
  const monthMarker = `[this-month:${sgtMonthKey(new Date())}]`
  const logged = await db.governanceLog.findFirst({
    where: { userId, event: "TRADE_EXECUTED", details: { contains: monthMarker } },
    select: { id: true },
  })

  return {
    move, ladder, amountPrimary, amountSecondary, shares, selectedSgdPrice, planLine, buyTicker,
    windowOpen: window.isOpen, windowLabel,
    daysToWindow: window.isOpen ? null : window.daysUntilOpen,
    windowClosesLabel: window.windowClosesLabel,
    planAmount, alreadyLogged: logged !== null,
  }
}

export default async function NextPage() {
  const session = await getSession()
  if (!session) redirect("/login")
  const active = await activePortfolioContext(session)
  const isSbr = active.constitutionId === "silicon-brick-road"
  const d = await getNextData(active.owner.id, active.constitutionId)
  const canLog = session.role === "admin" || session.userId === active.owner.id

  return (
    <Shell
      title={isSbr ? "What To Do This Month" : "This Month"}
      subtitle={isSbr ? "Your one action, in one screen" : "This month's constitution-permitted action"}
      userName={session.name}
      isAdmin={session.role === "admin"}
      constitutionId={active.constitutionId}
    >
      <NextMoveScreen
        action={d.move.action}
        what={d.move.what}
        ticker={d.buyTicker}
        amountPrimary={d.amountPrimary}
        amountSecondary={d.amountSecondary}
        shares={d.shares}
        sgdPrice={d.selectedSgdPrice > 0 ? d.selectedSgdPrice : null}
        planLine={d.planLine}
        windowOpen={d.windowOpen}
        windowLabel={d.windowLabel}
        accent={isSbr ? "sky" : "violet"}
      >
        {d.buyTicker && d.shares !== null && d.shares > 0 && (
          <LogExecutionButton
            ticker={d.buyTicker}
            shares={d.shares}
            alreadyLogged={d.alreadyLogged}
            canLog={canLog}
            accent={isSbr ? "sky" : "violet"}
          />
        )}
        {d.alreadyLogged && (d.shares === null || d.shares === 0) && (
          <p className="text-xs text-center text-success font-semibold">This month&apos;s purchase is already logged.</p>
        )}
        {!isSbr && d.ladder && (
          <details className="group rounded-2xl border border-border bg-card card-elevated overflow-hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 text-[11px] font-bold uppercase tracking-widest text-muted-foreground [&::-webkit-details-marker]:hidden">
              Why this move — Art. XIII ladder
              <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
            </summary>
            <div className="px-3 pb-3">
              <DecisionLadderCard
                ladder={d.ladder}
                monthlyContribution={d.planAmount}
                daysToWindow={d.daysToWindow}
                windowClosesLabel={d.windowClosesLabel}
              />
            </div>
          </details>
        )}
      </NextMoveScreen>
    </Shell>
  )
}
