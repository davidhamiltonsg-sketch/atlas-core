/**
 * Add riskFreeRate column to User table
 * Run with: npx tsx prisma/add-risk-free-rate.ts
 */
import { createClient } from "@libsql/client"
import "dotenv/config"

const url = process.env.DATABASE_URL
const authToken = process.env.DATABASE_AUTH_TOKEN || undefined
if (!url) throw new Error("DATABASE_URL is not set")

const client = createClient({ url, authToken })

async function main() {
  console.log("Adding riskFreeRate column to User table...")
  try {
    await client.execute(
      "ALTER TABLE User ADD COLUMN riskFreeRate REAL NOT NULL DEFAULT 0.04"
    )
    console.log("Column added successfully.")
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes("duplicate column") || msg.includes("already exists")) {
      console.log("Column already exists — skipping.")
    } else {
      throw e
    }
  }
}

main().catch(console.error).finally(() => client.close())
