import { getDealingWindow } from "@/lib/constitution"

// Calendar "today" in the portfolio's home timezone (Singapore — the app trades
// in SGD against an SGD goal). The infra clock is UTC, so a plain `new Date()`
// keeps reading the previous calendar day until 08:00 SGT — which made the
// dealing-window countdown appear stuck a day behind. Anchor every day-count and
// month bucket to the Singapore wall-clock date instead. Extracted from
// app/page.tsx so the cockpit, /next and /contributions share one clock.
export const APP_TZ = "Asia/Singapore"

export interface SgtDate { y: number; m: number; d: number }

function sgtParts(date: Date): SgtDate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  return { y: get("year"), m: get("month") - 1, d: get("day") }
}

/** Today's Singapore calendar date (month is 0-based, like Date). */
export function sgtToday(): SgtDate {
  return sgtParts(new Date())
}

/** A local-midnight Date for a Singapore calendar date — for day-count arithmetic. */
export function sgtDateOnly({ y, m, d }: SgtDate): Date {
  return new Date(y, m, d)
}

/** "YYYY-MM" bucket of a DB timestamp, judged on the Singapore calendar. */
export function sgtMonthKey(date: Date): string {
  const { y, m } = sgtParts(date)
  return `${y}-${String(m + 1).padStart(2, "0")}`
}

/** Singapore calendar year of a DB timestamp. */
export function sgtYear(date: Date): number {
  return sgtParts(date).y
}

export interface DealingWindowStatus {
  isOpen: boolean
  /** Days until this month's window opens; null when open or already past. */
  daysUntilOpen: number | null
  /** e.g. "31 JUL" while the window is open; null otherwise. */
  windowClosesLabel: string | null
  opens: Date
  closes: Date
}

/**
 * The dealing-window view every countdown surface shares, computed from the single
 * canonical getDealingWindow (lib/constitution) and an SGT-anchored today — replaces
 * the private duplicate that used to live in app/page.tsx.
 */
export function dealingWindowStatus(today: SgtDate = sgtToday()): DealingWindowStatus {
  const todayDate = sgtDateOnly(today)
  const w = getDealingWindow(todayDate)
  const dayMs = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const t = todayDate.getTime()
  const openMs = dayMs(w.opens)
  const closeMs = dayMs(w.closes)
  if (t >= openMs && t <= closeMs) {
    return {
      isOpen: true, daysUntilOpen: null,
      windowClosesLabel: w.closes.toLocaleDateString("en-GB", { day: "numeric", month: "short" }).toUpperCase(),
      opens: w.opens, closes: w.closes,
    }
  }
  if (t < openMs) {
    return { isOpen: false, daysUntilOpen: Math.round((openMs - t) / 86_400_000), windowClosesLabel: null, opens: w.opens, closes: w.closes }
  }
  return { isOpen: false, daysUntilOpen: null, windowClosesLabel: null, opens: w.opens, closes: w.closes }
}
