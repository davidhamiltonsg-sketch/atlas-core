ALTER TABLE "Snapshot" ADD COLUMN "costBasis" REAL;
ALTER TABLE "Snapshot" ADD COLUMN "unrealizedPnl" REAL;
ALTER TABLE "Trade" ADD COLUMN "commission" REAL NOT NULL DEFAULT 0;
ALTER TABLE "Trade" ADD COLUMN "realizedPnl" REAL;
ALTER TABLE "Trade" ADD COLUMN "netCash" REAL;

CREATE TABLE "IbkrLedgerEntry" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "symbol" TEXT,
  "amount" REAL NOT NULL,
  "currency" TEXT NOT NULL,
  "amountBase" REAL,
  "fxRate" REAL,
  "date" DATETIME NOT NULL,
  "description" TEXT,
  "rawType" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IbkrLedgerEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "IbkrLedgerEntry_userId_externalId_key" ON "IbkrLedgerEntry"("userId", "externalId");
CREATE INDEX "IbkrLedgerEntry_userId_date_idx" ON "IbkrLedgerEntry"("userId", "date");
CREATE INDEX "IbkrLedgerEntry_userId_category_idx" ON "IbkrLedgerEntry"("userId", "category");
