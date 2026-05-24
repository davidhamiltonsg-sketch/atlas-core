/**
 * Exports all data from local atlas.db → Turso cloud database.
 * Usage: node scripts/export-to-turso.mjs
 * Requires TURSO_DATABASE_URL and TURSO_AUTH_TOKEN env vars.
 */

import Database from "better-sqlite3"
import { createClient } from "@libsql/client"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dbPath = path.resolve(__dirname, "../prisma/atlas.db")

const url = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL
const authToken = process.env.TURSO_AUTH_TOKEN || process.env.DATABASE_AUTH_TOKEN

if (!url || url.startsWith("file:")) {
  console.error("Set TURSO_DATABASE_URL to your Turso libsql:// URL")
  process.exit(1)
}

const local = new Database(dbPath)
const remote = createClient({ url, authToken })

async function exportTable(table, rows) {
  if (rows.length === 0) { console.log(`  ${table}: 0 rows`); return }
  const cols = Object.keys(rows[0])
  const placeholders = cols.map(() => "?").join(", ")
  const sql = `INSERT OR REPLACE INTO ${table} (${cols.join(", ")}) VALUES (${placeholders})`
  for (const row of rows) {
    await remote.execute({ sql, args: Object.values(row) })
  }
  console.log(`  ${table}: ${rows.length} rows`)
}

async function run() {
  console.log("Exporting from", dbPath, "→", url)

  const tables = ["User", "PasswordResetToken", "Holding", "Snapshot", "Contribution", "GovernanceRule", "BehaviourLog"]
  for (const table of tables) {
    try {
      const rows = local.prepare(`SELECT * FROM ${table}`).all()
      await exportTable(table, rows)
    } catch (e) {
      console.warn(`  ${table}: skipped (${e.message})`)
    }
  }

  console.log("Done.")
  local.close()
}

run().catch(e => { console.error(e); process.exit(1) })
