import { PrismaClient } from "@prisma/client"
import { PrismaLibSql } from "@prisma/adapter-libsql"
import bcrypt from "bcryptjs"
import "dotenv/config"
import { HOLDINGS_SEED as holdings, GOVERNANCE_RULES as governanceRules } from "./governance-data"

// ── Art. XX–XXI Risk Register seed data ──────────────────────────────────────
const RISK_REGISTER_ITEMS = [
  {
    key:   "ucits-migration",
    title: "US Estate Tax — UCITS Migration",
    level: "high",
    description:
      "Non-US persons are subject to US estate tax on US-sited assets above ~USD 60k. " +
      "Art. XV: estate-tax risk begins at USD 60k (warn); UCITS migration is mandatory above USD 100k. " +
      "Pre-committed response: migrate VT, QQQM, SMH, VWO to UCITS equivalents at the next dealing window " +
      "once the USD 100k threshold is crossed. No action required below USD 60k.",
    preCommittedResponseId: "A1",
  },
  {
    key:   "single-broker",
    title: "Single-Broker Concentration (IBKR)",
    level: "medium",
    description:
      "All holdings are custodied at IBKR Singapore. Risk of regulatory action, sanctions, " +
      "capital controls, or platform failure creating temporary or permanent access restriction. " +
      "Current policy: single-broker is accepted. Review a second custodian on any of: " +
      "regulatory change, sanctions risk materialising, or balance exceeding a material single-point risk threshold.",
    preCommittedResponseId: "B1",
  },
  {
    key:   "sgd-depreciation",
    title: "SGD Depreciation vs USD",
    level: "low",
    description:
      "Portfolio base currency is SGD but the majority of assets are priced in USD. " +
      "Structural FX mismatch: USD weakness (or SGD strength) reduces portfolio NAV in SGD terms. " +
      "Mitigated by VT's diversified global exposure and the portfolio's long 20-year horizon. " +
      "No active hedging — currency drag is accepted as the cost of global diversification.",
  },
  {
    key:   "tech-concentration",
    title: "Tech Sector Concentration",
    level: "medium",
    description:
      "QQQM and SMH hold overlapping semiconductor and mega-cap tech exposure. Combined QQQM+SMH " +
      "position must stay below the soft ceiling of 38% (Art. IX) and hard ceiling of 42%. " +
      "Individual caps (QQQM 30%, SMH 12%) understate the true sector concentration risk due to " +
      "their overlap. The combined tech rule is the binding constraint when both are elevated.",
  },
] as const

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
  await prisma.governanceLog.deleteMany()
  await prisma.throttleState.deleteMany()
  await prisma.riskRegisterItem.deleteMany()
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

  for (const item of RISK_REGISTER_ITEMS) {
    await prisma.riskRegisterItem.create({ data: item })
  }
  console.log(`  ✓ ${RISK_REGISTER_ITEMS.length} risk register items`)

  console.log("Done.")
  console.log("")
  console.log("  Login: admin@atlas.local / atlas2025")
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })
