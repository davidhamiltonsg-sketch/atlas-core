/**
 * Reset SBR portfolio to zero.
 *
 * Deletes all Snapshot records for Dami's holdings (dutszm@gmail.com) and
 * replaces them with a single zero-value snapshot per holding. Holding records
 * themselves are preserved so the targets/bands remain intact.
 *
 * Atlas Core holdings (any other user) are NOT touched — verified at the end.
 *
 * Run: npx tsx prisma/reset-sbr-portfolio.ts
 */
import { PrismaClient } from "@prisma/client"
import { PrismaLibSql } from "@prisma/adapter-libsql"
import "dotenv/config"

const url = process.env.DATABASE_URL
const authToken = process.env.DATABASE_AUTH_TOKEN || undefined
if (!url) throw new Error("DATABASE_URL is not set")
const prisma = new PrismaClient({ adapter: new PrismaLibSql({ url, authToken }) })

const SBR_EMAIL = "dutszm@gmail.com"

async function main() {
  console.log("Reset SBR Portfolio — zeroing Dami's snapshots\n")

  // 1. Find Dami
  const dami = await prisma.user.findUnique({ where: { email: SBR_EMAIL } })
  if (!dami) {
    console.error("  ✗ User not found:", SBR_EMAIL)
    console.error("    Run: npx tsx prisma/seed-sbr.ts  to provision Dami first.")
    process.exit(1)
  }
  console.log(`  ✓ Found user: ${dami.name} (${dami.email}) — id: ${dami.id}`)

  // 2. Get Dami's holdings
  const holdings = await prisma.holding.findMany({
    where: { userId: dami.id },
    include: { snapshots: { orderBy: { date: "desc" }, take: 1 } },
  })
  if (holdings.length === 0) {
    console.error("  ✗ No holdings found — run seed-sbr.ts first.")
    process.exit(1)
  }
  console.log(`  ✓ Holdings: ${holdings.map((h) => h.ticker).join(", ")}`)

  // 3. Delete all existing snapshots and create a zero snapshot per holding
  let totalDeleted = 0
  for (const h of holdings) {
    const { count } = await prisma.snapshot.deleteMany({ where: { holdingId: h.id } })
    totalDeleted += count
    await prisma.snapshot.create({
      data: { holdingId: h.id, units: 0, price: 0, value: 0, currency: "SGD", date: new Date() },
    })
    const prev = h.snapshots[0]
    console.log(
      `  - ${h.ticker}: deleted ${count} snapshot(s)` +
        (prev ? ` (was ${prev.units} units · S$${prev.value.toFixed(2)})` : "") +
        " → reset to 0"
    )
  }
  console.log(`\n  ✓ Deleted ${totalDeleted} snapshot(s) total. All SBR holdings now at zero.\n`)

  // 4. Verify Atlas Core holdings are untouched
  const others = await prisma.user.findMany({ where: { email: { not: SBR_EMAIL } } })
  console.log("  Verification — other users (Atlas Core / shared):")
  for (const u of others) {
    const uHoldings = await prisma.holding.findMany({
      where: { userId: u.id },
      include: { snapshots: { orderBy: { date: "desc" }, take: 1 } },
    })
    if (uHoldings.length === 0) {
      console.log(`    ${u.email}: no holdings`)
      continue
    }
    console.log(`    ${u.email} (${uHoldings.length} holdings):`)
    for (const h of uHoldings) {
      const s = h.snapshots[0]
      if (s) console.log(`      ${h.ticker}: ${s.units} units @ $${s.price} = $${s.value.toFixed(2)}`)
      else console.log(`      ${h.ticker}: no snapshot`)
    }
  }
  console.log("\n  Done. SBR is at zero; Atlas Core is untouched.")
}

main()
  .catch((e) => { console.error("ERR", e); process.exit(1) })
  .finally(() => prisma.$disconnect())
