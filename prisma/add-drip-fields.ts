/**
 * Migration: add isDrip + dripUnits columns to Dividend table
 * Run with: npx tsx prisma/add-drip-fields.ts
 */
import { createClient } from "@libsql/client"
import "dotenv/config"

const url = process.env.DATABASE_URL
const authToken = process.env.DATABASE_AUTH_TOKEN

if (!url) throw new Error("DATABASE_URL is not set")

const client = createClient({ url, authToken })

async function main() {
  console.log("Adding isDrip and dripUnits columns to Dividend table...")

  // SQLite does not support adding multiple columns in one ALTER TABLE,
  // so we run two separate statements.
  try {
    await client.execute(
      "ALTER TABLE Dividend ADD COLUMN isDrip INTEGER NOT NULL DEFAULT 0"
    )
    console.log("  ✓ isDrip column added")
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes("duplicate column")) {
      console.log("  ⚠ isDrip column already exists, skipping")
    } else {
      throw e
    }
  }

  try {
    await client.execute("ALTER TABLE Dividend ADD COLUMN dripUnits REAL")
    console.log("  ✓ dripUnits column added")
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes("duplicate column")) {
      console.log("  ⚠ dripUnits column already exists, skipping")
    } else {
      throw e
    }
  }

  console.log("Migration complete.")
  await client.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
