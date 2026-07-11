/**
 * Atlas Core V5.8 — DB migration script
 * Updates hardCapPct and toleranceBand for all users' holdings.
 * Run with: npx tsx prisma/update-v58.ts
 */
import { PrismaClient } from "@prisma/client"
import { PrismaLibSql } from "@prisma/adapter-libsql"
import "dotenv/config"

const url = process.env.DATABASE_URL
const authToken = process.env.DATABASE_AUTH_TOKEN || undefined
if (!url) throw new Error("DATABASE_URL is not set")
const adapter = new PrismaLibSql({ url, authToken })
const prisma = new PrismaClient({ adapter })

// V5.8 updated parameters (Section 2 hard caps, Section 3.1 soft bands)
const V58: Record<string, { hardCapPct: number; toleranceBand: number }> = {
  VWRA: { hardCapPct: 60, toleranceBand: 6 }, // was 62 / 5
  EQQQ: { hardCapPct: 30, toleranceBand: 5 }, // was 31 / 4
  SEMI: { hardCapPct: 15, toleranceBand: 3 }, // was 15 / 2
  VFEA: { hardCapPct: 13, toleranceBand: 3 }, // was 12 / 2
  BTC:  { hardCapPct: 8,  toleranceBand: 1 }, // unchanged
}

async function main() {
  console.log("Atlas Core V5.8 migration — updating holding parameters...\n")
  for (const [ticker, updates] of Object.entries(V58)) {
    const result = await prisma.holding.updateMany({
      where: { ticker },
      data: updates,
    })
    console.log(`  ${ticker.padEnd(4)}  hardCapPct=${updates.hardCapPct}%  toleranceBand=±${updates.toleranceBand}%  (${result.count} holding(s) updated)`)
  }
  console.log("\nMigration complete.")
}

main().catch(console.error).finally(() => prisma.$disconnect())
