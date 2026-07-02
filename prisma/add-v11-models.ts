/**
 * Migration: add Constitution v1.1 compliance models
 *   - RiskRegisterItem  (Art. XX–XXI)
 *   - GovernanceLog     (Art. XXII — append-only audit ledger)
 *   - ThrottleState     (Art. XIII — per-user throttle machinery)
 *
 * Run with: npx tsx prisma/add-v11-models.ts
 * Idempotent: uses CREATE TABLE IF NOT EXISTS.
 */
import { createClient } from "@libsql/client"
import "dotenv/config"

const url = process.env.DATABASE_URL
const authToken = process.env.DATABASE_AUTH_TOKEN

if (!url) throw new Error("DATABASE_URL is not set")

const client = createClient({ url, authToken })

async function main() {
  console.log("Migrating — Constitution v1.1 compliance models...")

  await client.execute(`
    CREATE TABLE IF NOT EXISTS RiskRegisterItem (
      id                     TEXT     NOT NULL PRIMARY KEY,
      key                    TEXT     NOT NULL UNIQUE,
      title                  TEXT     NOT NULL,
      description            TEXT     NOT NULL,
      level                  TEXT     NOT NULL,
      countdownDate          DATETIME,
      preCommittedResponseId TEXT,
      sourceLinks            TEXT     NOT NULL DEFAULT '[]',
      createdAt              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
  console.log("  ✓ RiskRegisterItem")

  await client.execute(`
    CREATE TABLE IF NOT EXISTS GovernanceLog (
      id        TEXT     NOT NULL PRIMARY KEY,
      userId    TEXT     NOT NULL REFERENCES User(id) ON DELETE CASCADE,
      date      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      event     TEXT     NOT NULL,
      ruleId    TEXT,
      details   TEXT     NOT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
  console.log("  ✓ GovernanceLog")

  await client.execute(`
    CREATE TABLE IF NOT EXISTS ThrottleState (
      id                     TEXT     NOT NULL PRIMARY KEY,
      userId                 TEXT     NOT NULL UNIQUE REFERENCES User(id) ON DELETE CASCADE,
      timer72hExpiresAt      DATETIME,
      moratorium90dStartedAt DATETIME,
      discretionaryChangesQ  INTEGER  NOT NULL DEFAULT 0,
      quarter                TEXT     NOT NULL DEFAULT '2026-Q3',
      updatedAt              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
  console.log("  ✓ ThrottleState")

  console.log("Migration complete.")
  await client.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
