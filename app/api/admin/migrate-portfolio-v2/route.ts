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

async function columnNames(table: string) {
  const rows = await db.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info("${table}")`)
  return new Set(rows.map(row => row.name))
}

export async function POST(req: NextRequest) {
  if (!authorised(req)) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const holdingDefinitions: Record<string, string> = {
    displayTicker: "TEXT", instrumentKey: "TEXT", isin: "TEXT", cusip: "TEXT",
    exchange: "TEXT", ibkrConid: "TEXT", instrumentStatus: "TEXT NOT NULL DEFAULT 'ACTIVE'",
  }
  const tradeDefinitions: Record<string, string> = {
    instrumentKey: "TEXT", isin: "TEXT", cusip: "TEXT", exchange: "TEXT", ibkrConid: "TEXT",
  }
  const holdingColumns = await columnNames("Holding")
  const tradeColumns = await columnNames("Trade")
  const added: string[] = []

  for (const [column, definition] of Object.entries(holdingDefinitions)) {
    if (!holdingColumns.has(column)) {
      await db.$executeRawUnsafe(`ALTER TABLE "Holding" ADD COLUMN "${column}" ${definition}`)
      added.push(`Holding.${column}`)
    }
  }
  for (const [column, definition] of Object.entries(tradeDefinitions)) {
    if (!tradeColumns.has(column)) {
      await db.$executeRawUnsafe(`ALTER TABLE "Trade" ADD COLUMN "${column}" ${definition}`)
      added.push(`Trade.${column}`)
    }
  }

  const statements = [
    `CREATE TABLE IF NOT EXISTS "DcaCashBank" ("id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "constitutionId" TEXT NOT NULL, "currency" TEXT NOT NULL, "balance" REAL NOT NULL DEFAULT 0, "updatedAt" DATETIME NOT NULL, FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "DcaCashBank_userId_constitutionId_currency_key" ON "DcaCashBank"("userId","constitutionId","currency")`,
    `CREATE TABLE IF NOT EXISTS "DcaBankEntry" ("id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "constitutionId" TEXT NOT NULL, "currency" TEXT NOT NULL, "type" TEXT NOT NULL, "amount" REAL NOT NULL, "balanceAfter" REAL NOT NULL, "externalId" TEXT, "description" TEXT, "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "DcaBankEntry_userId_externalId_key" ON "DcaBankEntry"("userId","externalId")`,
    `CREATE INDEX IF NOT EXISTS "DcaBankEntry_userId_constitutionId_date_idx" ON "DcaBankEntry"("userId","constitutionId","date")`,
    `UPDATE "Holding" SET "displayTicker"=COALESCE("displayTicker", "ticker"), "instrumentKey"=COALESCE("instrumentKey", CASE WHEN "ticker"='VT' THEN 'CUSIP:922042742' WHEN "ticker"='QQQM' THEN 'CUSIP:46090E103' WHEN "ticker"='VWO' THEN 'CUSIP:922042858' WHEN "ticker" IN ('SMH','SMH_US','SMH.US') THEN 'CUSIP:92189F676' WHEN "ticker"='IMID' THEN 'ISIN:IE00B3YLTY66' WHEN "ticker"='EQAC' THEN 'ISIN:IE00BFZXGZ54' WHEN "ticker"='SMH.L' THEN 'ISIN:IE00BMC38736' WHEN "ticker"='IB01' THEN 'ISIN:IE00BGSF1X88' WHEN "ticker" IN ('IBIT','BTC') THEN 'CUSIP:46438F101' ELSE 'TICKER:' || "ticker" END), "instrumentStatus"=CASE WHEN "ticker" IN ('VT','QQQM','VWO','SMH','SMH_US','SMH.US') THEN 'LEGACY' ELSE COALESCE("instrumentStatus",'ACTIVE') END`,
    `CREATE INDEX IF NOT EXISTS "Holding_userId_instrumentKey_idx" ON "Holding"("userId","instrumentKey")`,
    `CREATE INDEX IF NOT EXISTS "Holding_userId_instrumentStatus_idx" ON "Holding"("userId","instrumentStatus")`,
  ]
  for (const statement of statements) await db.$executeRawUnsafe(statement)

  const verifiedHolding = await columnNames("Holding")
  const verifiedTrade = await columnNames("Trade")
  const missing = [
    ...Object.keys(holdingDefinitions).filter(column => !verifiedHolding.has(column)).map(column => `Holding.${column}`),
    ...Object.keys(tradeDefinitions).filter(column => !verifiedTrade.has(column)).map(column => `Trade.${column}`),
  ]
  if (missing.length) return NextResponse.json({ error: "Verification failed", missing }, { status: 500 })

  return NextResponse.json({ ok: true, added, verified: true })
}
