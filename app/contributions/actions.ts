"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { getSession } from "@/lib/session"
import { activePortfolioContext } from "@/lib/active-portfolio"
import { assertCanMutateOwner } from "@/lib/mutation-auth"

// Manual ledger entries — the no-IBKR fallback. The activity import is the
// authoritative source when a Flex activity feed is connected; these actions
// exist so a portfolio without one (or with a gap in its report window) can
// still keep the contribution and dividend ledgers truthful. Every manual row
// is tagged [manual] in its note for provenance, and the ledgers stay
// append-only: corrections are made with an offsetting entry, not an edit.

type ActionResult = { success: true } | { success: false; error: string }

const MAX_ABS_AMOUNT = 5_000_000 // sanity ceiling, S$

function parseEntryDate(raw: string): Date | null {
  const d = new Date(raw)
  if (!Number.isFinite(d.getTime())) return null
  // Tomorrow+ is a typo, not a plan. (One day of slack covers SGT vs UTC.)
  if (d.getTime() > Date.now() + 86_400_000) return null
  return d
}

/** Record a cash contribution (positive) or withdrawal (negative) in SGD. */
export async function addManualContribution(input: {
  amount: number
  date: string
  note?: string
}): Promise<ActionResult> {
  try {
    const session = await getSession()
    if (!session) return { success: false, error: "Not authenticated" }
    const active = await activePortfolioContext(session)
    assertCanMutateOwner(session, active.owner.id)

    const amount = Number(input.amount)
    if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > MAX_ABS_AMOUNT) {
      return { success: false, error: "Enter a non-zero SGD amount (withdrawals are negative)." }
    }
    const date = parseEntryDate(input.date)
    if (!date) return { success: false, error: "Enter a valid date that is not in the future." }

    await db.contributionRecord.create({
      data: {
        userId: active.owner.id,
        amount,
        date,
        note: `[manual] ${input.note?.trim() || (amount > 0 ? "Contribution" : "Withdrawal")} — recorded by ${session.email}`,
      },
    })

    for (const p of ["/contributions", "/", "/reports", "/mission-control"]) revalidatePath(p)
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Could not record the contribution" }
  }
}

/** Record a dividend received (SGD) against one of the owner's holdings. */
export async function addManualDividend(input: {
  ticker: string
  amount: number
  paymentDate: string
  note?: string
}): Promise<ActionResult> {
  try {
    const session = await getSession()
    if (!session) return { success: false, error: "Not authenticated" }
    const active = await activePortfolioContext(session)
    assertCanMutateOwner(session, active.owner.id)

    const amount = Number(input.amount)
    if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_ABS_AMOUNT) {
      return { success: false, error: "Enter a positive SGD dividend amount." }
    }
    const paymentDate = parseEntryDate(input.paymentDate)
    if (!paymentDate) return { success: false, error: "Enter a valid payment date that is not in the future." }

    const ticker = input.ticker.trim().toUpperCase()
    // Dividends come from something you hold — tie the row to a real holding so
    // the ledger can't accumulate income against tickers this portfolio never owned.
    const holding = await db.holding.findFirst({ where: { userId: active.owner.id, ticker } })
    if (!holding) return { success: false, error: `${ticker} is not a holding in this portfolio.` }
    const snap = await db.snapshot.findFirst({ where: { holdingId: holding.id }, orderBy: { date: "desc" } })

    await db.dividend.create({
      data: {
        userId: active.owner.id,
        holdingId: holding.id,
        ticker,
        amount,
        units: snap?.units ?? 0,
        paymentDate,
        note: `[manual] ${input.note?.trim() || "Dividend"} — recorded by ${session.email}`,
      },
    })

    for (const p of ["/contributions", "/", "/reports", "/mission-control"]) revalidatePath(p)
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Could not record the dividend" }
  }
}
