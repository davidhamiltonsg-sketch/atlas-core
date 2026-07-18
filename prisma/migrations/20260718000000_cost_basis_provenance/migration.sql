-- Cost-basis provenance: explicit source + as-of date instead of inferring trustworthiness
-- by null-checking costBasis/unrealizedPnl at render time.
ALTER TABLE "Snapshot" ADD COLUMN "costBasisSource" TEXT;
ALTER TABLE "Snapshot" ADD COLUMN "costBasisAsOf" DATETIME;
