/**
 * Atlas Core v6.7 — governance reconciliation migration.
 *
 * Brings a LIVE database into line with the Governance Document v6.7 WITHOUT touching
 * money/units/trades/users. Idempotent — safe to run more than once. It:
 *
 *   1. Resyncs the GovernanceRule register to the canonical 40-rule set (./governance-data),
 *      preserving any rule a user had toggled inactive (matched by title).
 *   2. Corrects the SMH §2 hard cap on every holding: 15% → 12%.
 *
 * Run with:  npx tsx prisma/update-governance-v6_7.ts
 */
import { PrismaClient } from "@prisma/client"
import { PrismaLibSql } from "@prisma/adapter-libsql"
import "dotenv/config"
import { GOVERNANCE_RULES } from "./governance-data"

const url = process.env.DATABASE_URL
const authToken = process.env.DATABASE_AUTH_TOKEN || undefined
if (!url) throw new Error("DATABASE_URL is not set")
const adapter = new PrismaLibSql({ url, authToken })
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log("Atlas Core v6.7 — governance reconciliation\n")

  // ── 1. SMH §2 hard cap: 15% → 12% (governance parameter; no money touched) ──
  const smh = await prisma.holding.updateMany({
    where: { ticker: "SMH" },
    data: { hardCapPct: 12 },
  })
  console.log(`  SMH hard cap → 12%  (${smh.count} holding(s) updated)`)

  // ── 2. Resync the governance rule register to the canonical 40 ──────────────
  // Preserve any inactive toggles the user set (match by title).
  const existing = await prisma.governanceRule.findMany()
  const inactiveTitles = new Set(existing.filter((r) => !r.active).map((r) => r.title))
  console.log(`  Existing rules: ${existing.length} (inactive preserved: ${inactiveTitles.size})`)

  await prisma.governanceRule.deleteMany()
  let created = 0
  for (const rule of GOVERNANCE_RULES) {
    await prisma.governanceRule.create({
      data: { ...rule, active: rule.active && !inactiveTitles.has(rule.title) },
    })
    created++
  }
  console.log(`  Governance register resynced: ${created} rules written`)

  // ── Report by category ──────────────────────────────────────────────────────
  const after = await prisma.governanceRule.findMany()
  const byCat: Record<string, number> = {}
  for (const r of after) byCat[r.category] = (byCat[r.category] ?? 0) + 1
  console.log(`\n  Total rules now: ${after.length}`)
  for (const [c, n] of Object.entries(byCat).sort()) console.log(`    ${c}: ${n}`)
  console.log("\nReconciliation complete.")
}

main().catch((e) => { console.error("ERR", e); process.exit(1) }).finally(() => prisma.$disconnect())
