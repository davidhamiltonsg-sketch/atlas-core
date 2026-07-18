-- SyncStatus: one row per owner, upserted on every IBKR sync attempt (success or failure),
-- so "did my last refresh work?" is a stored fact instead of only an ephemeral toast.
CREATE TABLE "SyncStatus" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "lastAttemptAt" DATETIME NOT NULL,
    "lastOutcome" TEXT NOT NULL,
    "lastError" TEXT,
    "lastSuccessAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SyncStatus_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "SyncStatus_userId_key" ON "SyncStatus"("userId");
