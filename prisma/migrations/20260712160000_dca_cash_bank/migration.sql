CREATE TABLE "DcaCashBank" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "constitutionId" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "balance" REAL NOT NULL DEFAULT 0,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "DcaCashBank_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DcaCashBank_userId_constitutionId_currency_key" ON "DcaCashBank"("userId", "constitutionId", "currency");

CREATE TABLE "DcaBankEntry" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "constitutionId" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "amount" REAL NOT NULL,
  "balanceAfter" REAL NOT NULL,
  "externalId" TEXT,
  "description" TEXT,
  "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DcaBankEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DcaBankEntry_userId_externalId_key" ON "DcaBankEntry"("userId", "externalId");
CREATE INDEX "DcaBankEntry_userId_constitutionId_date_idx" ON "DcaBankEntry"("userId", "constitutionId", "date");
