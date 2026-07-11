import { createClient } from "@libsql/client"

const apply = process.argv.includes("--apply")
const url = process.env.DATABASE_URL
const authToken = process.env.DATABASE_AUTH_TOKEN
if (!url) throw new Error("DATABASE_URL is required")
if (url.startsWith("libsql:") && !authToken) throw new Error("DATABASE_AUTH_TOKEN is required for Turso")

const db = createClient({ url, authToken })
const requiredHoldingColumns = {
  displayTicker: "TEXT",
  instrumentKey: "TEXT",
  isin: "TEXT",
  cusip: "TEXT",
  exchange: "TEXT",
  ibkrConid: "TEXT",
  instrumentStatus: "TEXT NOT NULL DEFAULT 'ACTIVE'",
}
const requiredTradeColumns = {
  instrumentKey: "TEXT",
  isin: "TEXT",
  cusip: "TEXT",
  exchange: "TEXT",
  ibkrConid: "TEXT",
}

async function columns(table) {
  const result = await db.execute(`PRAGMA table_info("${table}")`)
  return new Set(result.rows.map((r) => String(r.name)))
}

const holdingColumns = await columns("Holding")
const tradeColumns = await columns("Trade")
const missingHolding = Object.keys(requiredHoldingColumns).filter((c) => !holdingColumns.has(c))
const missingTrade = Object.keys(requiredTradeColumns).filter((c) => !tradeColumns.has(c))
const before = await db.execute(`
  SELECT u.email, h.ticker, COUNT(s.id) AS snapshots
  FROM User u LEFT JOIN Holding h ON h.userId=u.id LEFT JOIN Snapshot s ON s.holdingId=h.id
  GROUP BY u.email, h.ticker ORDER BY u.email, h.ticker
`)

console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", missingHolding, missingTrade, holdings: before.rows }, null, 2))
if (!apply) {
  console.log("Dry run only. Re-run with --apply after taking a Turso backup or confirming point-in-time recovery.")
  await db.close(); process.exit(0)
}

const statements = []
for (const c of missingHolding) statements.push(`ALTER TABLE "Holding" ADD COLUMN "${c}" ${requiredHoldingColumns[c]}`)
for (const c of missingTrade) statements.push(`ALTER TABLE "Trade" ADD COLUMN "${c}" ${requiredTradeColumns[c]}`)
statements.push(`CREATE TABLE IF NOT EXISTS "DcaCashBank" ("id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "constitutionId" TEXT NOT NULL, "currency" TEXT NOT NULL, "balance" REAL NOT NULL DEFAULT 0, "updatedAt" DATETIME NOT NULL, FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE)`)
statements.push(`CREATE UNIQUE INDEX IF NOT EXISTS "DcaCashBank_userId_constitutionId_currency_key" ON "DcaCashBank"("userId","constitutionId","currency")`)
statements.push(`CREATE TABLE IF NOT EXISTS "DcaBankEntry" ("id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "constitutionId" TEXT NOT NULL, "currency" TEXT NOT NULL, "type" TEXT NOT NULL, "amount" REAL NOT NULL, "balanceAfter" REAL NOT NULL, "externalId" TEXT, "description" TEXT, "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE)`)
statements.push(`CREATE UNIQUE INDEX IF NOT EXISTS "DcaBankEntry_userId_externalId_key" ON "DcaBankEntry"("userId","externalId")`)
statements.push(`CREATE INDEX IF NOT EXISTS "DcaBankEntry_userId_constitutionId_date_idx" ON "DcaBankEntry"("userId","constitutionId","date")`)
statements.push(`UPDATE "Holding" SET
  "displayTicker"=COALESCE("displayTicker", "ticker"),
  "instrumentKey"=COALESCE("instrumentKey", CASE
    WHEN "ticker"='VT' THEN 'CUSIP:922042742'
    WHEN "ticker"='QQQM' THEN 'CUSIP:46090E103'
    WHEN "ticker"='VWO' THEN 'CUSIP:922042858'
    WHEN "ticker" IN ('SMH','SMH_US','SMH.US') THEN 'CUSIP:92189F676'
    WHEN "ticker"='IMID' THEN 'ISIN:IE00B3YLTY66'
    WHEN "ticker"='EQAC' THEN 'ISIN:IE00BFZXGZ54'
    WHEN "ticker"='SMH.L' THEN 'ISIN:IE00BMC38736'
    WHEN "ticker"='IB01' THEN 'ISIN:IE00BGSF1X88'
    WHEN "ticker" IN ('IBIT','BTC') THEN 'CUSIP:46438F101'
    ELSE 'TICKER:' || "ticker" END),
  "instrumentStatus"=CASE WHEN "ticker" IN ('VT','QQQM','VWO','SMH','SMH_US','SMH.US') THEN 'LEGACY' ELSE COALESCE("instrumentStatus",'ACTIVE') END`)
statements.push(`CREATE INDEX IF NOT EXISTS "Holding_userId_instrumentKey_idx" ON "Holding"("userId","instrumentKey")`)
statements.push(`CREATE INDEX IF NOT EXISTS "Holding_userId_instrumentStatus_idx" ON "Holding"("userId","instrumentStatus")`)

await db.batch(statements, "write")

const sbr = await db.execute({ sql: `SELECT u.email, COUNT(CASE WHEN s.value > 0 THEN 1 END) AS valuedSnapshots FROM User u LEFT JOIN Holding h ON h.userId=u.id LEFT JOIN Snapshot s ON s.holdingId=h.id WHERE lower(u.email)=? GROUP BY u.email`, args: ["dutszm@gmail.com"] })
const atlasLegacy = await db.execute(`SELECT ticker, instrumentKey, instrumentStatus FROM Holding WHERE ticker IN ('VT','QQQM','VWO','SMH_US','SMH.US')`)
console.log(JSON.stringify({ applied: true, sbr: sbr.rows, atlasLegacy: atlasLegacy.rows }, null, 2))
await db.close()
