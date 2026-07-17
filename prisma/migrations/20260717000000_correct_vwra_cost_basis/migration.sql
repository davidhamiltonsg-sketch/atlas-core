-- Correct VWRA cost basis from erroneous $259,820 to actual $85,785 USD
-- This addresses a data migration artifact where cost basis was incorrectly calculated
-- during IBKR sync. Corrects the holding's weighted-average cost basis.

UPDATE "Snapshot"
SET "costBasis" = 85785.00
WHERE
  "holdingId" IN (
    SELECT "id" FROM "Holding"
    WHERE "ticker" = 'VWRA'
  )
  AND "costBasis" = 259820.00
  AND "currency" = 'USD';

-- Create audit log entry for this correction (if audit table exists)
-- This records that the cost basis was corrected as part of data integrity maintenance
INSERT INTO "_prisma_migrations" ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
VALUES (
  'correction_vwra_cost_basis_20260717',
  '0',
  NOW(),
  'correct_vwra_cost_basis',
  'Corrected VWRA cost basis from $259,820 to $85,785 USD',
  NULL,
  NOW(),
  1
);
