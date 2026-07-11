import { timingSafeEqual } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export const dynamic = "force-dynamic"

function authorised(req: NextRequest) {
  const expected = process.env.MIGRATION_TOKEN
  const supplied = req.headers.get("x-migration-token")
  if (!expected || !supplied) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(supplied)
  return a.length === b.length && timingSafeEqual(a, b)
}

async function columns(table: string) {
  const rows = await db.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info("${table}")`)
  return new Set(rows.map(row => row.name))
}

export async function POST(req: NextRequest) {
  if (!authorised(req)) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const definitions: Record<string, Record<string, string>> = {
    Snapshot: { costBasis: "REAL", unrealizedPnl: "REAL" },
    Trade: { commission: "REAL NOT NULL DEFAULT 0", realizedPnl: "REAL", netCash: "REAL" },
  }
  const added: string[] = []
  for (const [table, tableDefinitions] of Object.entries(definitions)) {
    const existing = await columns(table)
    for (const [column, definition] of Object.entries(tableDefinitions)) {
      if (!existing.has(column)) {
        await db.$executeRawUnsafe(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`)
        added.push(`${table}.${column}`)
      }
    }
  }

  const statements = [
    `CREATE TABLE IF NOT EXISTS "IbkrLedgerEntry" ("id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "externalId" TEXT NOT NULL, "category" TEXT NOT NULL, "symbol" TEXT, "amount" REAL NOT NULL, "currency" TEXT NOT NULL, "amountBase" REAL, "fxRate" REAL, "date" DATETIME NOT NULL, "description" TEXT, "rawType" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "IbkrLedgerEntry_userId_externalId_key" ON "IbkrLedgerEntry"("userId","externalId")`,
    `CREATE INDEX IF NOT EXISTS "IbkrLedgerEntry_userId_date_idx" ON "IbkrLedgerEntry"("userId","date")`,
    `CREATE INDEX IF NOT EXISTS "IbkrLedgerEntry_userId_category_idx" ON "IbkrLedgerEntry"("userId","category")`,
  ]
  for (const statement of statements) await db.$executeRawUnsafe(statement)

  const missing: string[] = []
  for (const [table, tableDefinitions] of Object.entries(definitions)) {
    const actual = await columns(table)
    for (const column of Object.keys(tableDefinitions)) if (!actual.has(column)) missing.push(`${table}.${column}`)
  }
  if (missing.length) return NextResponse.json({ error: "Verification failed", missing }, { status: 500 })
  return NextResponse.json({ ok: true, added, verified: true })
}
