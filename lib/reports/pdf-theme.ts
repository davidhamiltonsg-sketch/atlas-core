// Shared, portfolio-neutral theme contract for branded PDF reports. Each portfolio supplies
// its own instance — no ticker/logic coupling, just colors and a display name — so the PDF
// kit (components/reports/pdf/kit.tsx) can render either brand without knowing which one.
export interface ReportTheme {
  portfolioName: string
  primary: string
  brandA: string
  brandB: string
  brandC: string
  tint: string // very light wash of the primary, for callout backgrounds
}

export const ATLAS_REPORT_THEME: ReportTheme = {
  portfolioName: "Atlas Core",
  primary: "#7c3aed",
  brandA: "#7c3aed",
  brandB: "#a78bfa",
  brandC: "#e879f9",
  tint: "#f5f3ff",
}

export const SBR_REPORT_THEME: ReportTheme = {
  portfolioName: "Silicon Brick Road",
  primary: "#0284c7",
  brandA: "#0284c7",
  brandB: "#38bdf8",
  brandC: "#22d3ee",
  tint: "#f0f9ff",
}

export type ReportPeriod = "monthly" | "quarterly" | "annual"

export const PERIOD_LABEL: Record<ReportPeriod, string> = {
  monthly: "Monthly Report",
  quarterly: "Quarterly Report",
  annual: "Annual Report",
}

export const PERIOD_MONTHS: Record<ReportPeriod, number> = {
  monthly: 1,
  quarterly: 3,
  annual: 12,
}

export const PERIOD_COMPARISON_LABEL: Record<ReportPeriod, string> = {
  monthly: "last month",
  quarterly: "last quarter",
  annual: "last year",
}

// Shared, ticker-agnostic period formatting so both portfolios' report-data modules
// compute the same label from the same `now` — never two slightly different formats.
export function formatPeriodLabel(period: ReportPeriod, now: Date): string {
  if (period === "annual") return String(now.getFullYear())
  if (period === "quarterly") return `Q${Math.floor(now.getMonth() / 3) + 1} ${now.getFullYear()}`
  return now.toLocaleDateString("en-GB", { month: "long", year: "numeric" })
}

export function formatGeneratedOn(now: Date): string {
  return now.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
}
