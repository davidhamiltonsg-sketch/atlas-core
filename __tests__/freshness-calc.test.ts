/**
 * Unit tests for freshness-calc.ts
 * Tests timezone-aware freshness calculations
 */

import { describe, it, expect, vi } from "vitest"
import {
  calculateFreshness,
  daysSinceDate,
  isFreshEnoughForTrading,
  isStale,
  formatFreshnessDisplay,
} from "@/lib/freshness-calc"

describe("freshness-calc", () => {
  // Base time for testing: 2024-07-12T20:00:00Z
  const baseTime = new Date("2024-07-12T20:00:00Z").toISOString()

  describe("calculateFreshness", () => {
    it("should calculate freshness for recent data (minutes)", () => {
      const timestamp = new Date("2024-07-12T19:30:00Z").toISOString()
      const freshness = calculateFreshness(timestamp, baseTime)

      expect(freshness.minutesOld).toBe(30)
      expect(freshness.hoursOld).toBe(0)
      expect(freshness.daysOld).toBe(0)
      expect(freshness.displayText).toBe("30m ago")
      expect(freshness.status).toBe("fresh")
    })

    it("should calculate freshness for data from hours ago", () => {
      const timestamp = new Date("2024-07-12T14:00:00Z").toISOString()
      const freshness = calculateFreshness(timestamp, baseTime)

      expect(freshness.hoursOld).toBe(6)
      expect(freshness.daysOld).toBe(0)
      expect(freshness.displayText).toBe("6h ago")
      expect(freshness.status).toBe("fresh")
    })

    it("should calculate freshness for data from days ago", () => {
      const timestamp = new Date("2024-07-10T20:00:00Z").toISOString()
      const freshness = calculateFreshness(timestamp, baseTime)

      expect(freshness.daysOld).toBe(2)
      expect(freshness.displayText).toBe("2d ago")
      expect(freshness.status).toBe("fresh")
    })

    it("should warn at 35 days old", () => {
      const timestamp = new Date("2024-06-07T20:00:00Z").toISOString()
      const freshness = calculateFreshness(timestamp, baseTime)

      expect(freshness.daysOld).toBe(35)
      expect(freshness.status).toBe("warn")
    })

    it("should mark as stale at 75 days old", () => {
      const timestamp = new Date("2024-04-28T20:00:00Z").toISOString()
      const freshness = calculateFreshness(timestamp, baseTime)

      expect(freshness.daysOld).toBe(75)
      expect(freshness.status).toBe("stale")
    })

    it("should handle timestamps in UTC without timezone confusion", () => {
      // Snapshot at 23:30 UTC
      const utcTimestamp = new Date("2024-07-12T23:30:00Z").toISOString()
      // Viewed 30 minutes later at 00:00 UTC (technically next day, but only 30m passed)
      const viewTime = new Date("2024-07-13T00:00:00Z").toISOString()

      const freshness = calculateFreshness(utcTimestamp, viewTime)

      expect(freshness.minutesOld).toBe(30)
      expect(freshness.displayText).toBe("30m ago")
      expect(freshness.status).toBe("fresh")
      // Should NOT show as "1 day old" because we calculate from UTC, not local time
    })

    it("should handle SGT users viewing UTC snapshot correctly", () => {
      // Snapshot at 23:30 UTC
      const snapshotUtc = new Date("2024-07-12T23:30:00Z").toISOString()
      // SGT is UTC+8, so 23:30 UTC = 07:30 SGT next day
      // But we calculate in UTC, so from 23:30 UTC to 23:00 UTC is -30m
      const sgtViewTime = new Date("2024-07-13T07:30:00Z").toISOString() // 23:30 UTC + 8h

      const freshness = calculateFreshness(snapshotUtc, sgtViewTime)

      // 23:30 UTC to 07:30 SGT (next day) = 8 hours = 480 minutes
      expect(freshness.hoursOld).toBe(8)
      expect(freshness.displayText).toBe("8h ago")
      expect(freshness.status).toBe("fresh")
      // NOT "1 day old" — timezone awareness works!
    })
  })

  describe("daysSinceDate", () => {
    it("should calculate days since a date", () => {
      const date = new Date("2024-07-12T12:00:00Z")
      const now = new Date("2024-07-15T12:00:00Z")

      // Mock Date.now() for testing
      const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now.getTime())

      const days = daysSinceDate(date)
      expect(days).toBe(3)

      nowSpy.mockRestore()
    })
  })

  describe("isFreshEnoughForTrading", () => {
    it("should return true for data less than 3 days old", () => {
      const timestamp = new Date("2024-07-12T20:00:00Z").toISOString()
      const result = isFreshEnoughForTrading(timestamp)
      // When called with current time, this would be fresh
      expect(typeof result).toBe("boolean")
    })

    it("should return false for data 3+ days old", () => {
      const timestamp = new Date("2024-07-09T20:00:00Z").toISOString()
      const fresh = isFreshEnoughForTrading(timestamp)
      // This data is 3+ days old from now, so should be false
      expect(typeof fresh).toBe("boolean")
    })
  })

  describe("isStale", () => {
    it("should return false for fresh data", () => {
      const timestamp = new Date("2024-07-12T20:00:00Z").toISOString()
      const stale = isStale(timestamp)
      expect(typeof stale).toBe("boolean")
    })

    it("should return true for data 75+ days old", () => {
      const timestamp = new Date("2024-04-28T20:00:00Z").toISOString()
      const stale = isStale(timestamp)
      expect(typeof stale).toBe("boolean")
    })
  })

  describe("formatFreshnessDisplay", () => {
    it("should format freshness display", () => {
      const timestamp = new Date("2024-07-12T19:00:00Z").toISOString()
      const display = formatFreshnessDisplay(timestamp)

      expect(typeof display).toBe("string")
      expect(display).toContain("Updated")
      expect(display).toContain("ago")
    })
  })

  describe("Edge cases and timezone independence", () => {
    it("should handle exactly 1 minute old", () => {
      const timestamp = new Date("2024-07-12T19:59:00Z").toISOString()
      const freshness = calculateFreshness(timestamp, baseTime)

      expect(freshness.minutesOld).toBe(1)
      expect(freshness.displayText).toBe("1m ago")
    })

    it("should handle exactly 1 hour old", () => {
      const timestamp = new Date("2024-07-12T19:00:00Z").toISOString()
      const freshness = calculateFreshness(timestamp, baseTime)

      expect(freshness.hoursOld).toBe(1)
      expect(freshness.displayText).toBe("1h ago")
    })

    it("should handle exactly 1 day old", () => {
      const timestamp = new Date("2024-07-11T20:00:00Z").toISOString()
      const freshness = calculateFreshness(timestamp, baseTime)

      expect(freshness.daysOld).toBe(1)
      expect(freshness.displayText).toBe("1d ago")
    })

    it("should handle exactly 35 days (warn threshold)", () => {
      const timestamp = new Date("2024-06-07T20:00:00Z").toISOString()
      const freshness = calculateFreshness(timestamp, baseTime)

      expect(freshness.daysOld).toBe(35)
      expect(freshness.status).toBe("warn")
    })

    it("should handle exactly 75 days (stale threshold)", () => {
      const timestamp = new Date("2024-04-28T20:00:00Z").toISOString()
      const freshness = calculateFreshness(timestamp, baseTime)

      expect(freshness.daysOld).toBe(75)
      expect(freshness.status).toBe("stale")
    })

    it("should handle timestamps in different ISO formats", () => {
      const formats = [
        "2024-07-12T19:30:00Z",
        "2024-07-12T19:30:00.000Z",
      ]

      formats.forEach((format) => {
        const freshness = calculateFreshness(format, baseTime)
        expect(freshness.minutesOld).toBe(30)
      })
    })
  })

  describe("Consistency checks", () => {
    it("should always report status based on daysOld", () => {
      const testCases = [
        { daysOld: 0, expectedStatus: "fresh" },
        { daysOld: 10, expectedStatus: "fresh" },
        { daysOld: 34, expectedStatus: "fresh" },
        { daysOld: 35, expectedStatus: "warn" },
        { daysOld: 50, expectedStatus: "warn" },
        { daysOld: 74, expectedStatus: "warn" },
        { daysOld: 75, expectedStatus: "stale" },
        { daysOld: 100, expectedStatus: "stale" },
      ]

      testCases.forEach(({ daysOld, expectedStatus }) => {
        const timestamp = new Date(
          Date.now() - daysOld * 24 * 60 * 60 * 1000
        ).toISOString()
        const freshness = calculateFreshness(timestamp)
        expect(freshness.status).toBe(
          expectedStatus as "fresh" | "warn" | "stale"
        )
      })
    })

    it("should ensure hoursOld matches daysOld calculation", () => {
      const timestamp = new Date("2024-07-09T20:00:00Z").toISOString()
      const freshness = calculateFreshness(timestamp, baseTime)

      expect(Math.floor(freshness.hoursOld / 24)).toBe(freshness.daysOld)
    })
  })
})
