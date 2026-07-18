CREATE TABLE "ConstitutionVersion" ("id" TEXT NOT NULL PRIMARY KEY, "constitutionId" TEXT NOT NULL, "version" TEXT NOT NULL, "updated" TEXT NOT NULL, "contentHash" TEXT NOT NULL, "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);

CREATE UNIQUE INDEX "ConstitutionVersion_constitutionId_version_key" ON "ConstitutionVersion" ("constitutionId", "version");

CREATE INDEX "ConstitutionVersion_constitutionId_idx" ON "ConstitutionVersion" ("constitutionId");
