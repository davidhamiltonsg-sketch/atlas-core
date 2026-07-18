import { db } from "@/lib/db"

// A durable "did my last refresh actually work?" record — one row per owner, upserted on
// every IBKR sync attempt (success or failure). Distinct from lib/ibkr-rate-limiter.ts's
// IbkrSyncLog, which only ever logs successes for rate-limiting and was never meant to
// answer "why did it fail" for the owner. Without this, that information only ever existed
// as an ephemeral toast the owner had to be looking at the moment it fired, or in Vercel's
// own runtime logs, which the owner has no access to.

export type SyncSource = "positions" | "activity" | "reconcile" | "cron"

export interface SyncStatusView {
  source: SyncSource
  lastAttemptAt: Date
  lastOutcome: "success" | "failure"
  lastError: string | null
  lastSuccessAt: Date | null
}

export async function recordSyncAttempt(
  userId: string,
  source: SyncSource,
  outcome: "success" | "failure",
  error?: string,
): Promise<void> {
  const now = new Date()
  await db.syncStatus.upsert({
    where: { userId },
    create: {
      userId, source, lastAttemptAt: now, lastOutcome: outcome,
      lastError: outcome === "failure" ? (error ?? null) : null,
      lastSuccessAt: outcome === "success" ? now : null,
    },
    update: {
      source, lastAttemptAt: now, lastOutcome: outcome,
      lastError: outcome === "failure" ? (error ?? null) : null,
      ...(outcome === "success" ? { lastSuccessAt: now } : {}),
    },
  })
}

export async function getSyncStatus(userId: string): Promise<SyncStatusView | null> {
  const row = await db.syncStatus.findUnique({ where: { userId } })
  if (!row) return null
  return {
    source: row.source as SyncSource,
    lastAttemptAt: row.lastAttemptAt,
    lastOutcome: row.lastOutcome as "success" | "failure",
    lastError: row.lastError,
    lastSuccessAt: row.lastSuccessAt,
  }
}

const SOURCE_LABELS: Record<SyncSource, string> = {
  positions: "Closing Refresh",
  activity: "Closing Refresh",
  reconcile: "Reconcile",
  cron: "Scheduled sync",
}

/** "Closing Refresh succeeded 14 min ago" / "Reconcile failed 2h ago: IBKR busy, try again shortly" */
export function formatSyncStatus(status: SyncStatusView, now = new Date()): string {
  const minsAgo = Math.max(0, Math.round((now.getTime() - status.lastAttemptAt.getTime()) / 60_000))
  const ago = minsAgo < 1 ? "just now" : minsAgo < 60 ? `${minsAgo} min ago` : `${Math.round(minsAgo / 60)}h ago`
  const label = SOURCE_LABELS[status.source] ?? "Sync"
  if (status.lastOutcome === "success") return `${label} succeeded ${ago}`
  return `${label} failed ${ago}${status.lastError ? `: ${status.lastError}` : ""}`
}
