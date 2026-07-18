/**
 * CI-only seed: provisions one Atlas Core user and one Silicon Brick Road user into a
 * throwaway local SQLite database (DATABASE_URL=file:...), for the Playwright smoke suite.
 * Never point this at production — it upserts the same well-known emails the app already
 * routes to each constitution (lib/constitutions.ts CONSTITUTION_BY_EMAIL), which is safe
 * here only because the CI database is freshly created per run and discarded after.
 */
import { PrismaClient } from "@prisma/client"
import { PrismaLibSql } from "@prisma/adapter-libsql"
import bcrypt from "bcryptjs"
import "dotenv/config"
import { HOLDINGS_SEED } from "./../prisma/governance-data"
import { provisionDami } from "../lib/provision-dami"

const url = process.env.DATABASE_URL
if (!url) throw new Error("DATABASE_URL is not set")
const prisma = new PrismaClient({ adapter: new PrismaLibSql({ url }) })

const ATLAS_EMAIL = "admin@atlas.local"
const ATLAS_PASSWORD = process.env.CI_ATLAS_PASSWORD ?? "ci-smoke-test-password"

async function seedAtlas() {
  const passwordHash = await bcrypt.hash(ATLAS_PASSWORD, 12)
  const user = await prisma.user.upsert({
    where: { email: ATLAS_EMAIL },
    update: { passwordHash, role: "admin" },
    create: { email: ATLAS_EMAIL, name: "CI Admin", passwordHash, role: "admin" },
  })
  const now = new Date()
  for (const h of HOLDINGS_SEED) {
    const holding = await prisma.holding.upsert({
      where: { userId_ticker: { userId: user.id, ticker: h.ticker } },
      update: { name: h.name, targetPct: h.targetPct, hardCapPct: h.hardCapPct, toleranceBand: h.toleranceBand, color: h.color },
      create: { userId: user.id, ticker: h.ticker, name: h.name, targetPct: h.targetPct, hardCapPct: h.hardCapPct, toleranceBand: h.toleranceBand, color: h.color },
    })
    const existing = await prisma.snapshot.findFirst({ where: { holdingId: holding.id }, orderBy: { date: "desc" } })
    if (!existing) {
      // A nominal non-zero position so the dashboard/forecast render real charts instead
      // of the empty-portfolio state.
      const price = h.snapshot.price || 100
      const units = h.snapshot.units || Math.round((h.targetPct * 1000) / price)
      await prisma.snapshot.create({
        data: { holdingId: holding.id, units, price, value: units * price, currency: "SGD", date: now, costBasis: units * price * 0.9, unrealizedPnl: units * price * 0.1, costBasisSource: "ibkr", costBasisAsOf: now },
      })
    }
  }
  console.log(`[ci-seed] Atlas Core: ${ATLAS_EMAIL} · ${HOLDINGS_SEED.length} holdings`)
}

async function seedSbr() {
  process.env.DAMI_KEY = process.env.CI_SBR_PASSWORD ?? "ci-smoke-test-password"
  const result = await provisionDami(prisma)
  if (!result.ok) throw new Error(`[ci-seed] SBR provisioning failed: ${result.error}`)
  // provisionDami sets up holdings at 0 units — give them a nominal position too.
  const user = await prisma.user.findUniqueOrThrow({ where: { email: "dutszm@gmail.com" } })
  const holdings = await prisma.holding.findMany({ where: { userId: user.id } })
  const now = new Date()
  for (const h of holdings) {
    const existing = await prisma.snapshot.findFirst({ where: { holdingId: h.id }, orderBy: { date: "desc" } })
    if (!existing || existing.units === 0) {
      const price = 100
      const units = Math.round((h.targetPct * 1000) / price)
      await prisma.snapshot.create({
        data: { holdingId: h.id, units, price, value: units * price, currency: "SGD", date: now, costBasis: units * price * 0.9, unrealizedPnl: units * price * 0.1, costBasisSource: "ibkr", costBasisAsOf: now },
      })
    }
  }
  console.log(`[ci-seed] Silicon Brick Road: ${result.email} · ${result.holdings} holdings`)
}

async function main() {
  await seedAtlas()
  await seedSbr()
}

main().catch((e) => { console.error("[ci-seed] Fatal:", e); process.exit(1) }).finally(() => prisma.$disconnect())
