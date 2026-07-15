// Band-position datum shared by the cockpit data layers. The ComplianceBoard
// component that once rendered these rows was retired in favour of
// ThresholdGauge (components/governance/threshold-gauge.tsx), which shows the
// same actual-vs-band read on the governance page — one component, one job.
// The type stays here because app/page.tsx and components/sbr/sbr-dashboard.tsx
// still assemble these rows in their data builders.
export interface ComplianceBandPosition {
  ticker: string
  name: string
  color: string
  value: number
  actualPct: number
  targetPct: number
  softLow: number    // target - toleranceBand (soft underweight threshold)
  softHigh: number   // target + toleranceBand (soft overweight threshold)
  hardLow?: number   // hard underweight floor (from HARD_THRESHOLDS)
  hardHigh: number   // hard cap (from hardCapPct or HARD_THRESHOLDS)
  status: "healthy" | "soft" | "hard"
}
