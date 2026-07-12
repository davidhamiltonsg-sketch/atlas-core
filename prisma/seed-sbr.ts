/**
 * Silicon Brick Road — provision Dami's account (dutszm@gmail.com) from the CLI.
 *
 * Sets Dami's password from the `dami_key` env var, switches him to the SBR contribution
 * framework (min SGD 1,000/mo), and provisions the current VWRA / EQAC / SMH / BTC / DBMFE mandate.
 * Idempotent. The logic is shared with the admin route
 * (/api/admin/provision-dami) via lib/provision-dami.ts.
 *
 * Run where `dami_key` is set (local .env, or use the admin route in Vercel):
 *   npx tsx prisma/seed-sbr.ts   (or: npm run seed:sbr)
 */
import { PrismaClient } from "@prisma/client"
import { PrismaLibSql } from "@prisma/adapter-libsql"
import "dotenv/config"
import { provisionDami } from "../lib/provision-dami"

const url = process.env.DATABASE_URL
const authToken = process.env.DATABASE_AUTH_TOKEN || undefined
if (!url) throw new Error("DATABASE_URL is not set")
const prisma = new PrismaClient({ adapter: new PrismaLibSql({ url, authToken }) })

async function main() {
  console.log("Silicon Brick Road — provisioning dutszm@gmail.com\n")
  const result = await provisionDami(prisma)
  if (!result.ok) { console.error("  ✗", result.error); process.exit(1) }
  console.log(`  ✓ password set from dami_key · min SGD 1,000/mo · ${result.holdings} SBR holdings (VWRA/EQAC/SMH/BTC/DBMFE)`)
  console.log("\nDone. Dami logs in at /login with", result.email, "and the dami_key password.")
}

main().catch((e) => { console.error("ERR", e); process.exit(1) }).finally(() => prisma.$disconnect())
