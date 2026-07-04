/**
 * Migration: add accrualBalanceSgd column to Holding table.
 * Needed for SBR v2.2 whole-share accrual engine carry-forward persistence.
 * Run with: npx tsx prisma/add-accrual-balance.ts
 */
import { createClient } from "@libsql/client"
import "dotenv/config"

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set")
const DB_URL = process.env.DATABASE_URL as string
const authToken = process.env.DATABASE_AUTH_TOKEN

async function main() {
  const client = createClient({ url: DB_URL, ...(authToken ? { authToken } : {}) })

  // Check if column already exists (SQLite/libSQL: PRAGMA table_info)
  const info = await client.execute("PRAGMA table_info(Holding)")
  const exists = info.rows.some((r) => r[1] === "accrualBalanceSgd")

  if (exists) {
    console.log("✓ accrualBalanceSgd already exists — nothing to do.")
  } else {
    await client.execute("ALTER TABLE Holding ADD COLUMN accrualBalanceSgd REAL NOT NULL DEFAULT 0")
    console.log("✓ Added accrualBalanceSgd REAL NOT NULL DEFAULT 0 to Holding table.")
  }

  client.close()
}

main().catch((e) => { console.error(e); process.exit(1) })
