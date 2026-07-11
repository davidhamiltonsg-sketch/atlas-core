import type { DcaPlan } from "@/lib/next-best-move"

export interface DcaPrice {
  ticker: string
  price: number
  fxToBank: number
  commission: number
}

export interface WholeShareInstruction {
  ticker: string
  units: number
  securityCost: number
  commission: number
  totalDebit: number
  allocatedBudget: number
}

export interface WholeSharePlan {
  openingBank: number
  contribution: number
  available: number
  instructions: WholeShareInstruction[]
  closingBank: number
}

/** Convert a currency allocation plan into whole-share purchases and carry every unused
 * cent forward. Prices and commissions are expressed through fxToBank in bank currency. */
export function planWholeSharePurchases(plan: DcaPlan, prices: DcaPrice[], openingBank: number, contribution: number): WholeSharePlan {
  const available = Math.max(0, openingBank) + Math.max(0, contribution)
  const plannedTotal = plan.allocations.reduce((s, a) => s + Math.max(0, a.amount), 0)
  const priceMap = new Map(prices.map((p) => [p.ticker, p]))
  let remaining = available
  const instructions: WholeShareInstruction[] = []

  for (const allocation of plan.allocations.filter((a) => a.amount > 0)) {
    const quote = priceMap.get(allocation.ticker)
    if (!quote || quote.price <= 0 || quote.fxToBank <= 0) continue
    const allocatedBudget = plannedTotal > 0 ? Math.min(remaining, available * allocation.amount / plannedTotal) : 0
    const unitCost = quote.price * quote.fxToBank
    const commission = Math.max(0, quote.commission)
    const units = Math.max(0, Math.floor((allocatedBudget - commission) / unitCost))
    if (units === 0) continue
    const securityCost = units * unitCost
    const totalDebit = securityCost + commission
    remaining -= totalDebit
    instructions.push({ ticker: allocation.ticker, units, securityCost, commission, totalDebit, allocatedBudget })
  }

  return { openingBank: Math.max(0, openingBank), contribution: Math.max(0, contribution), available, instructions, closingBank: Math.max(0, remaining) }
}
