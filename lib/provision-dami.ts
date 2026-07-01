import type { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"
import { SILICON_BRICK_ROAD as SBR } from "./constitutions"

// Shared Silicon Brick Road provisioning for Dami (dutszm@gmail.com). Used by both the CLI
// (prisma/seed-sbr.ts) and the admin route (/api/admin/provision-dami) so the two never drift.
// Sets Dami's password from `dami_key`, switches his contribution settings to SBR, and replaces
// his holdings with the four-fund set (QQQM/SMH units preserved). Idempotent.
export type ProvisionResult =
  | { ok: true; holdings: number; email: string }
  | { ok: false; error: string }

const EMAIL = "dutszm@gmail.com"
const band = (f: { target: number; rangeLow: number; rangeHigh: number }) => Math.min(f.target - f.rangeLow, f.rangeHigh - f.target)

export async function provisionDami(prisma: PrismaClient): Promise<ProvisionResult> {
  const key = process.env.dami_key || process.env.DAMI_KEY
  if (!key) return { ok: false, error: "dami_key (or DAMI_KEY) env var is not set." }

  const passwordHash = await bcrypt.hash(key, 12)
  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    update: { passwordHash, monthlyContribution: SBR.monthlyContribution, annualLumpSum: 0, contributionGrowthRate: 0 },
    create: { email: EMAIL, name: "Dami", passwordHash, role: "user", monthlyContribution: SBR.monthlyContribution, annualLumpSum: 0, contributionGrowthRate: 0 },
  })

  // Preserve QQQM / SMH units before replacing the holding set.
  const prior = await prisma.holding.findMany({
    where: { userId: user.id, ticker: { in: ["QQQM", "SMH"] } },
    include: { snapshots: { orderBy: { date: "desc" }, take: 1 } },
  })
  const priorByTicker = new Map(prior.map((h) => [h.ticker, h.snapshots[0]]))

  await prisma.dividend.deleteMany({ where: { userId: user.id } })
  await prisma.holding.deleteMany({ where: { userId: user.id } })

  let holdings = 0
  for (const f of SBR.funds) {
    const holding = await prisma.holding.create({
      data: { userId: user.id, ticker: f.ticker, name: f.name, targetPct: f.target, hardCapPct: f.hardCap, toleranceBand: band(f), color: f.color },
    })
    const prev = priorByTicker.get(f.ticker)
    const snap = prev ? { units: prev.units, price: prev.price, value: prev.value } : { units: 0, price: 0, value: 0 }
    await prisma.snapshot.create({ data: { holdingId: holding.id, units: snap.units, price: snap.price, value: snap.value, currency: "SGD", date: new Date() } })
    holdings++
  }
  return { ok: true, holdings, email: EMAIL }
}
