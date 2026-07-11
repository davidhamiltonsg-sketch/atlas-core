import { db } from "@/lib/db"

export async function recordDcaBankMovement(input: {
  userId: string
  constitutionId: "atlas-core" | "silicon-brick-road"
  currency: string
  type: "CONTRIBUTION" | "PURCHASE" | "COMMISSION" | "FX" | "ADJUSTMENT"
  amount: number
  externalId: string
  description?: string
  date?: Date
}): Promise<number> {
  return db.$transaction(async (tx) => {
    const duplicate = await tx.dcaBankEntry.findUnique({ where: { userId_externalId: { userId: input.userId, externalId: input.externalId } } })
    if (duplicate) return duplicate.balanceAfter
    const bank = await tx.dcaCashBank.upsert({
      where: { userId_constitutionId_currency: { userId: input.userId, constitutionId: input.constitutionId, currency: input.currency } },
      create: { userId: input.userId, constitutionId: input.constitutionId, currency: input.currency, balance: 0 },
      update: {},
    })
    // The DCA bank is a sub-ledger, not permission to create margin. A debit can use only
    // cash previously credited to this bank; any brokerage cash outside it remains separate.
    const appliedAmount = input.amount < 0 ? -Math.min(bank.balance, Math.abs(input.amount)) : input.amount
    const balanceAfter = Math.max(0, bank.balance + appliedAmount)
    await tx.dcaCashBank.update({ where: { id: bank.id }, data: { balance: balanceAfter } })
    await tx.dcaBankEntry.create({ data: {
      userId: input.userId, constitutionId: input.constitutionId, currency: input.currency,
      type: input.type, amount: appliedAmount, balanceAfter, externalId: input.externalId,
      description: input.description, date: input.date,
    } })
    return balanceAfter
  })
}
