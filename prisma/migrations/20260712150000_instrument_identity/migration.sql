-- Additive identity migration. Existing ticker history remains untouched.
ALTER TABLE "Holding" ADD COLUMN "displayTicker" TEXT;
ALTER TABLE "Holding" ADD COLUMN "instrumentKey" TEXT;
ALTER TABLE "Holding" ADD COLUMN "isin" TEXT;
ALTER TABLE "Holding" ADD COLUMN "cusip" TEXT;
ALTER TABLE "Holding" ADD COLUMN "exchange" TEXT;
ALTER TABLE "Holding" ADD COLUMN "ibkrConid" TEXT;
ALTER TABLE "Holding" ADD COLUMN "instrumentStatus" TEXT NOT NULL DEFAULT 'ACTIVE';

ALTER TABLE "Trade" ADD COLUMN "instrumentKey" TEXT;
ALTER TABLE "Trade" ADD COLUMN "isin" TEXT;
ALTER TABLE "Trade" ADD COLUMN "cusip" TEXT;
ALTER TABLE "Trade" ADD COLUMN "exchange" TEXT;
ALTER TABLE "Trade" ADD COLUMN "ibkrConid" TEXT;

UPDATE "Holding"
SET "displayTicker" = "ticker",
    "instrumentKey" = CASE
      WHEN "ticker" = 'VT' THEN 'CUSIP:922042742'
      WHEN "ticker" = 'QQQM' THEN 'CUSIP:46090E103'
      WHEN "ticker" = 'VWO' THEN 'CUSIP:922042858'
      WHEN "ticker" IN ('SMH', 'SMH_US', 'SMH.US') THEN 'CUSIP:92189F676'
      WHEN "ticker" = 'IMID' THEN 'ISIN:IE00B3YLTY66'
      WHEN "ticker" = 'EQAC' THEN 'ISIN:IE00BFZXGZ54'
      WHEN "ticker" = 'SMH.L' THEN 'ISIN:IE00BMC38736'
      WHEN "ticker" = 'IB01' THEN 'ISIN:IE00BGSF1X88'
      WHEN "ticker" IN ('IBIT', 'BTC') THEN 'CUSIP:46438F101'
      ELSE 'TICKER:' || "ticker"
    END,
    "instrumentStatus" = CASE
      WHEN "ticker" IN ('VT','QQQM','VWO','SMH','SMH_US','SMH.US') THEN 'LEGACY'
      ELSE 'ACTIVE'
    END
WHERE "instrumentKey" IS NULL;

CREATE INDEX IF NOT EXISTS "Holding_userId_instrumentKey_idx" ON "Holding"("userId", "instrumentKey");
CREATE INDEX IF NOT EXISTS "Holding_userId_instrumentStatus_idx" ON "Holding"("userId", "instrumentStatus");
