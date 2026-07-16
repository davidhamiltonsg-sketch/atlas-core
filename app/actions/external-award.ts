"use server"

import { revalidatePath } from "next/cache"
import { getSession } from "@/lib/session"
import { activePortfolioContext } from "@/lib/active-portfolio"
import { assertCanMutateOwner } from "@/lib/mutation-auth"
import { setExternalAward, type ExternalAward } from "@/lib/external-awards"

type ActionResult = { success: true } | { success: false; error: string }

// Save/clear the outside-Atlas RSU pipeline. Owner-only; Atlas surface only
// (the card is gated to atlas-core, and the marker is keyed to the owner).
export async function setExternalAwardAction(input: {
  cleared?: boolean
  ticker?: string
  label?: string
  taxRatePct?: number
  priceUsd?: number
  tranches?: Array<{ date: string; units: number }>
}): Promise<ActionResult> {
  try {
    const session = await getSession()
    if (!session) return { success: false, error: "Not authenticated" }
    const active = await activePortfolioContext(session)
    assertCanMutateOwner(session, active.owner.id)

    if (input.cleared) {
      await setExternalAward(active.owner.id, null)
    } else {
      const ticker = (input.ticker ?? "").trim().toUpperCase()
      if (!/^[A-Z.]{1,10}$/.test(ticker)) return { success: false, error: "Enter a valid US ticker (e.g. BK)." }
      const taxRatePct = Number(input.taxRatePct)
      if (!Number.isFinite(taxRatePct) || taxRatePct < 0 || taxRatePct > 60) {
        return { success: false, error: "Assumed tax rate must be between 0 and 60%." }
      }
      const tranches = (input.tranches ?? [])
        .filter((t) => t.date && Number.isFinite(Number(t.units)) && Number(t.units) > 0)
        .map((t) => ({ date: t.date, units: Number(t.units) }))
      if (tranches.length === 0) return { success: false, error: "Add at least one vesting tranche (date + units)." }
      if (tranches.length > 12) return { success: false, error: "At most 12 tranches." }
      if (tranches.some((t) => !Number.isFinite(new Date(t.date).getTime()))) {
        return { success: false, error: "Every tranche needs a valid date." }
      }
      const priceUsd = input.priceUsd !== undefined && input.priceUsd !== null && `${input.priceUsd}` !== ""
        ? Number(input.priceUsd)
        : undefined
      if (priceUsd !== undefined && (!Number.isFinite(priceUsd) || priceUsd <= 0)) {
        return { success: false, error: "Fallback price must be a positive USD amount." }
      }

      const award: ExternalAward = {
        ticker,
        label: input.label?.trim() || `${ticker} employer RSUs`,
        tranches,
        taxRatePct,
        ...(priceUsd !== undefined ? { priceUsd } : {}),
        asOf: new Date().toISOString().slice(0, 10),
      }
      await setExternalAward(active.owner.id, award)
    }

    for (const p of ["/", "/forecast", "/mission-control"]) revalidatePath(p)
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Could not save the award" }
  }
}
