import { db } from "@/lib/db"

/**
 * Server-side IBKR sync rate limiting. Enforces a 6-hour minimum between syncs
 * per user to avoid API quota abuse. Replaces client-side localStorage checks
 * which can be easily bypassed.
 */

const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6 hours

interface IbkrSyncLog {
  id: string
  userId: string
  syncedAt: Date
  createdAt: Date
}

/**
 * Check if a user can trigger an IBKR sync. Returns true if enough time has passed
 * since the last sync, false if rate-limited.
 */
export async function canSyncWithIbkr(userId: string): Promise<boolean> {
  const lastSync = await db.ibkrSyncLog.findFirst({
    where: { userId },
    orderBy: { syncedAt: "desc" },
  })

  if (!lastSync) return true // First sync always allowed

  const timeSinceSync = Date.now() - lastSync.syncedAt.getTime()
  return timeSinceSync > SYNC_INTERVAL_MS
}

/**
 * Get the time (in milliseconds) until the next allowed IBKR sync.
 * Returns 0 if sync is allowed now.
 */
export async function getTimeUntilNextIbkrSync(userId: string): Promise<number> {
  const lastSync = await db.ibkrSyncLog.findFirst({
    where: { userId },
    orderBy: { syncedAt: "desc" },
  })

  if (!lastSync) return 0

  const timeSinceSync = Date.now() - lastSync.syncedAt.getTime()
  const remaining = SYNC_INTERVAL_MS - timeSinceSync

  return Math.max(0, remaining)
}

/**
 * Record a successful IBKR sync for rate limiting purposes.
 * Called after a sync completes successfully.
 */
export async function recordIbkrSync(userId: string): Promise<void> {
  await db.ibkrSyncLog.create({
    data: {
      userId,
      syncedAt: new Date(),
    },
  })
}

/**
 * Format remaining time until next sync as human-readable string.
 */
export function formatTimeRemaining(ms: number): string {
  const hours = Math.floor(ms / (60 * 60 * 1000))
  const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000))

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m`
}
