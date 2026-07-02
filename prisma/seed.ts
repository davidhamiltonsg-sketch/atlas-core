import { PrismaClient } from "@prisma/client"
import { PrismaLibSql } from "@prisma/adapter-libsql"
import bcrypt from "bcryptjs"
import "dotenv/config"
import { HOLDINGS_SEED as holdings, GOVERNANCE_RULES as governanceRules } from "./governance-data"

const url = process.env.DATABASE_URL
const authToken = process.env.DATABASE_AUTH_TOKEN || undefined
if (!url) throw new Error("DATABASE_URL is not set")
const adapter = new PrismaLibSql({ url, authToken })
const prisma = new PrismaClient({ adapter })

// Holdings (§1/§2/§3) and the 40-rule register (§11) live in ./governance-data — the single
// source of truth shared with prisma/update-governance-v6_7.ts so they never drift apart.

async function main() {
  console.log("Seeding Atlas Core v6.7...")

  // Clear all data
  await prisma.snapshot.deleteMany()
  await prisma.dividend.deleteMany()
  await prisma.holding.deleteMany()
  await prisma.trade.deleteMany()
  await prisma.contributionRecord.deleteMany()
  await prisma.watchlistItem.deleteMany()
  await prisma.governanceRule.deleteMany()
  await prisma.behaviourLog.deleteMany()
  await prisma.passwordResetToken.deleteMany()
  await prisma.user.deleteMany()

  // Create admin user
  const passwordHash = await bcrypt.hash("atlas2025", 12)
  const admin = await prisma.user.create({
    data: {
      email: "admin@atlas.local",
      name: "Portfolio Owner",
      passwordHash,
      role: "admin",
      monthlyContribution: 3000,
      annualLumpSum: 20000,
      contributionGrowthRate: 0.05,
    },
  })
  console.log(`  ✓ Admin user: admin@atlas.local`)

  // Create holdings for admin
  for (const h of holdings) {
    const holding = await prisma.holding.create({
      data: {
        userId: admin.id,
        ticker: h.ticker,
        name: h.name,
        targetPct: h.targetPct,
        hardCapPct: h.hardCapPct,
        toleranceBand: h.toleranceBand,
        color: h.color,
      },
    })
    await prisma.snapshot.create({
      data: {
        holdingId: holding.id,
        units: h.snapshot.units,
        price: h.snapshot.price,
        value: h.snapshot.value,
        currency: "SGD",
        date: new Date(),
      },
    })
    console.log(`  ✓ ${h.ticker} — target ${h.targetPct}%`)
  }

  for (const rule of governanceRules) {
    await prisma.governanceRule.create({ data: rule })
  }
  console.log(`  ✓ ${governanceRules.length} governance rules`)
  console.log("Done.")
  console.log("")
  console.log("  Login: admin@atlas.local / atlas2025")
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })
