/**
 * Atlas Core — Data Freshness Calculator v1
 *
 * Unified calculation for snapshot freshness and data age.
 * Ensures consistent freshness display across Dashboard, Reports, Portfolio, Risk, etc.
 *
 * Key principle:
 * - All timestamps are stored and compared in UTC (ISO 8601 format)
 * - Freshness is calculated purely on time elapsed (age in hours/days)
 * - Display text shows relative age (e.g., "8h ago", not "1d old")
 * - Status thresholds are conservative: warn at 35 days, stale at 75 days
 *
 * Problem solved:
 * - SGT users (UTC+8) saw snapshot timestamps as if they were local time,
 *   making a 23:30 UTC snapshot appear "1 day old" when viewed at 07:30 SGT.
 * - This fix treats all times in UTC, avoiding timezone confusion.
 */

export interface FreshnessStatus {
  daysOld: number
  hoursOld: number
  minutesOld: number
  displayText: string // e.g., "30m ago", "8h ago", "2d ago"
  status: "fresh" | "warn" | "stale"
}

/**
 * Calculate freshness of a snapshot or data point.
 * All timestamps should be ISO 8601 UTC strings (e.g., from Date.toISOString()).
 *
 * @param timestampIso ISO 8601 UTC timestamp of the data point
 * @param nowIso ISO 8601 UTC timestamp of "now" (defaults to current time)
 * @returns Freshness status with display text and severity level
 *
 * @example
 * const snapshot = new Date('2024-07-12T16:00:00Z');
 * const freshness = calculateFreshness(snapshot.toISOString());
 * // Returns: { daysOld: 0, hoursOld: 2, minutesOld: 120, displayText: "2h ago", status: "fresh" }
 */
export function calculateFreshness(
  timestampIso: string,
  nowIso: string = new Date().toISOString()
): FreshnessStatus {
  const timestamp = new Date(timestampIso).getTime()
  const now = new Date(nowIso).getTime()

  // All calculations in UTC (not affected by local timezone)
  const ageMs = now - timestamp

  // Compute relative age in different units
  const minutesOld = Math.floor(ageMs / 60_000)
  const hoursOld = Math.floor(ageMs / 3_600_000)
  const daysOld = Math.floor(ageMs / 86_400_000)

  // Display text: show most relevant unit
  let displayText: string
  if (hoursOld < 1) {
    displayText = `${minutesOld}m ago`
  } else if (hoursOld < 24) {
    displayText = `${hoursOld}h ago`
  } else {
    displayText = `${daysOld}d ago`
  }

  // Status levels (conservative thresholds per Art. XXII)
  let status: "fresh" | "warn" | "stale"
  if (daysOld >= 75) {
    status = "stale"
  } else if (daysOld >= 35) {
    status = "warn"
  } else {
    status = "fresh"
  }

  return { daysOld, hoursOld, minutesOld, displayText, status }
}

/**
 * Calculate days since a date (convenience function).
 * Useful for health scores and aged-data penalties.
 *
 * @param date Date to compare against now
 * @returns Number of days elapsed
 */
export function daysSinceDate(date: Date): number {
  const ageMs = Date.now() - date.getTime()
  return Math.floor(ageMs / 86_400_000)
}

/**
 * Check if a snapshot is fresh enough for operational decisions.
 * Returns true if the snapshot is less than 3 days old.
 *
 * @param timestampIso ISO 8601 UTC timestamp
 * @returns true if fresh enough for trading/rebalancing decisions
 */
export function isFreshEnoughForTrading(timestampIso: string): boolean {
  const freshness = calculateFreshness(timestampIso)
  return freshness.daysOld < 3
}

/**
 * Check if a snapshot is stale (>75 days).
 * Stale data may trigger governance alerts.
 *
 * @param timestampIso ISO 8601 UTC timestamp
 * @returns true if stale
 */
export function isStale(timestampIso: string): boolean {
  const freshness = calculateFreshness(timestampIso)
  return freshness.status === "stale"
}

/**
 * Format a timestamp for display without timezone confusion.
 * Shows relative age in human-readable format.
 *
 * @param timestampIso ISO 8601 UTC timestamp
 * @returns Display text like "Updated 2h ago" or "Last sync: 5d ago"
 */
export function formatFreshnessDisplay(timestampIso: string): string {
  const freshness = calculateFreshness(timestampIso)
  return `Updated ${freshness.displayText}`
}
