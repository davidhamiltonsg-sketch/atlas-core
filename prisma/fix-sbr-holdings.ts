/**
 * Fix SBR holdings contamination.
 *
 * Removes any Atlas Core tickers (VT, VWO, BTC, IBIT, SGOV, etc.) that were
 * accidentally added to Dami's account by ensureCoreHoldings() during a
 * refreshLivePrices() call. Leaves VWRA, EQQQ, SEMI, A35 intact.
 *
 * Run: npx tsx prisma/fix-sbr-holdings.ts
 */
import { PrismaClient } from "@prisma/client"
import { PrismaLibSql } from "@prisma/adapter-libsql"
import "dotenv/config"

const url = process.env.DATABASE_URL
const authToken = process.env.DATABASE_AUTH_TOKEN || undefined
if (!url) throw new Error("DATABASE_URL is not set")
const prisma = new PrismaClient({ adapter: new PrismaLibSql({ url, authToken }) })

const SBR_EMAIL = "dutszm@gmail.com"
const SBR_TICKERS = new Set(["VWRA", "EQQQ", "SEMI", "A35"])

async function main() {
  console.log("Fix SBR holdings — removing contamination from Atlas Core tickers\n")

  const dami = await prisma.user.findUnique({ where: { email: SBR_EMAIL } })
  if (!dami) { console.error("  ✗ User not found:", SBR_EMAIL); process.exit(1) }

  const holdings = await prisma.holding.findMany({
    where: { userId: dami.id },
    include: { snapshots: { orderBy: { date: "desc" }, take: 1 } },
  })

  console.log(`  Found ${holdings.length} holdings for ${dami.email}:`)
  for (const h of holdings) {
    const snap = h.snapshots[0]
    const flag = SBR_TICKERS.has(h.ticker) ? "✓ keep" : "✗ remove"
    console.log(`  [${flag}] ${h.ticker} — ${snap ? `${snap.units} units · S$${snap.value.toFixed(2)}` : "no snapshot"}`)
  }

  const toRemove = holdings.filter(h => !SBR_TICKERS.has(h.ticker))
  if (toRemove.length === 0) {
    console.log("\n  No contamination found — all holdings are valid SBR tickers.")
    return
  }

  console.log(`\n  Removing ${toRemove.length} invalid holding(s)...`)
  for (const h of toRemove) {
    await prisma.snapshot.deleteMany({ where: { holdingId: h.id } })
    await prisma.dividend.deleteMany({ where: { holdingId: h.id } })
    await prisma.holding.delete({ where: { id: h.id } })
    console.log(`  ✓ Deleted ${h.ticker} and all associated records`)
  }

  const remaining = await prisma.holding.findMany({ where: { userId: dami.id } })
  console.log(`\n  SBR holdings after cleanup: ${remaining.map(h => h.ticker).join(", ")}`)
  console.log("  Done.")
}

main().catch((e) => { console.error("ERR", e); process.exit(1) }).finally(() => prisma.$disconnect())
