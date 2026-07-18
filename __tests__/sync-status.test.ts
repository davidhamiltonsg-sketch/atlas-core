import { describe, it, expect } from "vitest"
import { formatSyncStatus, type SyncStatusView } from "@/lib/sync-status"

describe("formatSyncStatus", () => {
  const now = new Date("2026-07-18T12:00:00Z")

  it("formats a recent success", () => {
    const status: SyncStatusView = { source: "reconcile", lastAttemptAt: new Date(now.getTime() - 5 * 60_000), lastOutcome: "success", lastError: null, lastSuccessAt: now }
    expect(formatSyncStatus(status, now)).toBe("Reconcile succeeded 5 min ago")
  })

  it("formats a failure with its error", () => {
    const status: SyncStatusView = { source: "positions", lastAttemptAt: new Date(now.getTime() - 2 * 3_600_000), lastOutcome: "failure", lastError: "IBKR busy, try again shortly", lastSuccessAt: null }
    expect(formatSyncStatus(status, now)).toBe("Closing Refresh failed 2h ago: IBKR busy, try again shortly")
  })

  it("formats just now for sub-minute gaps", () => {
    const status: SyncStatusView = { source: "cron", lastAttemptAt: new Date(now.getTime() - 10_000), lastOutcome: "success", lastError: null, lastSuccessAt: now }
    expect(formatSyncStatus(status, now)).toBe("Scheduled sync succeeded just now")
  })
})
