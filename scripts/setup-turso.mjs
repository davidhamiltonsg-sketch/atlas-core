/**
 * Creates schema + migrates all data from local atlas.db → Turso.
 * Usage: node scripts/setup-turso.mjs
 */
import Database from "better-sqlite3"
import { createClient } from "@libsql/client"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dbPath = path.resolve(__dirname, "../prisma/atlas.db")
const url = process.env.TURSO_DATABASE_URL
const authToken = process.env.TURSO_AUTH_TOKEN

if (!url) { console.error("Missing TURSO_DATABASE_URL"); process.exit(1) }

const local = new Database(dbPath)
const remote = createClient({ url, authToken })

const SCHEMA = `
CREATE TABLE IF NOT EXISTS "User" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "email" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'user',
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
  "updatedAt" TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS "PasswordResetToken" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "token" TEXT NOT NULL UNIQUE,
  "expiresAt" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS "Holding" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "ticker" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "targetPct" REAL NOT NULL,
  "hardCapPct" REAL,
  "toleranceBand" REAL NOT NULL DEFAULT 2.5,
  "color" TEXT NOT NULL DEFAULT '#6366f1',
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
  "updatedAt" TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
  UNIQUE("userId","ticker")
);
CREATE TABLE IF NOT EXISTS "Snapshot" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "holdingId" TEXT NOT NULL,
  "date" TEXT NOT NULL DEFAULT (datetime('now')),
  "units" REAL NOT NULL,
  "price" REAL NOT NULL,
  "value" REAL NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY ("holdingId") REFERENCES "Holding"("id") ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS "Contribution" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "date" TEXT NOT NULL,
  "amountGbp" REAL NOT NULL,
  "note" TEXT,
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS "GovernanceRule" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "active" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS "BehaviourLog" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT,
  "type" TEXT NOT NULL,
  "note" TEXT NOT NULL,
  "date" TEXT NOT NULL DEFAULT (datetime('now')),
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL
);
`

async function pushSchema() {
  console.log("Creating schema...")
  const statements = SCHEMA.split(";").map(s => s.trim()).filter(Boolean)
  for (const sql of statements) {
    await remote.execute(sql)
  }
  console.log("Schema ready.")
}

async function migrateTable(table) {
  let rows
  try { rows = local.prepare(`SELECT * FROM "${table}"`).all() }
  catch { console.log(`  ${table}: not found locally, skipping`); return }
  if (!rows.length) { console.log(`  ${table}: empty`); return }
  const cols = Object.keys(rows[0])
  const placeholders = cols.map(() => "?").join(", ")
  const sql = `INSERT OR REPLACE INTO "${table}" (${cols.map(c=>`"${c}"`).join(", ")}) VALUES (${placeholders})`
  for (const row of rows) {
    const args = cols.map(c => {
      const v = row[c]
      // Convert boolean integers and dates
      return v === null ? null : v
    })
    await remote.execute({ sql, args })
  }
  console.log(`  ${table}: ${rows.length} rows migrated`)
}

async function run() {
  console.log(`Connecting to ${url}`)
  await pushSchema()
  console.log("Migrating data...")
  for (const table of ["User","PasswordResetToken","Holding","Snapshot","Contribution","GovernanceRule","BehaviourLog"]) {
    await migrateTable(table)
  }
  console.log("\nAll done. Your Turso database is ready.")
  local.close()
}

run().catch(e => { console.error(e.message); process.exit(1) })
