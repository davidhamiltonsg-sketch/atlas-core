/**
 * Migration: create EtfLookThrough table
 * Run with: npx tsx prisma/add-etf-look-through.ts
 */
import { createClient } from "@libsql/client"
import "dotenv/config"

const url = process.env.DATABASE_URL
const authToken = process.env.DATABASE_AUTH_TOKEN

if (!url) throw new Error("DATABASE_URL is not set")

const client = createClient({ url, authToken })

async function main() {
  console.log("Creating EtfLookThrough table...")
  await client.execute(`
    CREATE TABLE IF NOT EXISTS EtfLookThrough (
      id             TEXT NOT NULL PRIMARY KEY,
      ticker         TEXT NOT NULL UNIQUE,
      companyWeights TEXT NOT NULL,
      sectorWeights  TEXT NOT NULL,
      geoWeights     TEXT NOT NULL,
      source         TEXT NOT NULL DEFAULT 'yahoo_finance',
      updatedAt      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      createdAt      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
  console.log("  ✓ EtfLookThrough table created (or already exists)")
  console.log("Migration complete.")
  await client.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
