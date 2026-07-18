import crypto from "node:crypto"
import { db } from "@/lib/db"
import { getConstitution, type ConstitutionId } from "@/lib/constitutions"

/** Hash of the constitution's GOVERNING content only — funds, bands, caps, decision ladder,
 *  rules. Presentation-only fields (name, colour, motto) are deliberately excluded so a copy
 *  edit doesn't falsely register as a new version while a real rule change always does. Pure
 *  and DB-free so it's directly testable. */
export function constitutionContentHash(id: ConstitutionId): string {
  const c = getConstitution(id)
  const governing = {
    funds: c.funds.map((f) => ({ ticker: f.ticker, target: f.target, rangeLow: f.rangeLow, rangeHigh: f.rangeHigh, hardCap: f.hardCap, floor: f.floor })),
    combined: c.combined,
    totalEquityMaxPct: c.totalEquityMaxPct,
    drawdownTriggerPct: c.drawdownTriggerPct,
    skipAtHighPct: c.skipAtHighPct,
    phases: c.phases,
    decisionLadder: c.decisionLadder,
    rules: c.rules,
  }
  return crypto.createHash("sha256").update(JSON.stringify(governing)).digest("hex")
}

export interface VersionDrift { recordedHash: string; currentHash: string; recordedAt: Date }

/** Records the constitution's current version as a durable fact the first time the app runs
 *  with it. Idempotent — a no-op on every later call for the same version. Call this from a
 *  low-frequency, already-authenticated path (the compliance page, the monthly cron) rather
 *  than a public one; it's one indexed lookup on the common (already-recorded) path. */
export async function recordConstitutionVersionIfNew(id: ConstitutionId): Promise<void> {
  const c = getConstitution(id)
  const existing = await db.constitutionVersion.findUnique({ where: { constitutionId_version: { constitutionId: id, version: c.version } } })
  if (existing) return
  await db.constitutionVersion.create({
    data: { constitutionId: id, version: c.version, updated: c.updated, contentHash: constitutionContentHash(id) },
  })
}

/** Detects the one integrity failure this table exists to catch: the SAME version number now
 *  serving DIFFERENT governing content than what was first recorded under it — i.e. a rule
 *  changed without the version increment Article VI requires. Returns null when the version is
 *  unrecorded (recordConstitutionVersionIfNew will record it) or unchanged. */
export async function detectUnversionedDrift(id: ConstitutionId): Promise<VersionDrift | null> {
  const c = getConstitution(id)
  const existing = await db.constitutionVersion.findUnique({ where: { constitutionId_version: { constitutionId: id, version: c.version } } })
  if (!existing) return null
  const currentHash = constitutionContentHash(id)
  if (existing.contentHash === currentHash) return null
  return { recordedHash: existing.contentHash, currentHash, recordedAt: existing.recordedAt }
}

export async function getConstitutionVersionHistory(id: ConstitutionId) {
  return db.constitutionVersion.findMany({ where: { constitutionId: id }, orderBy: { recordedAt: "asc" } })
}
