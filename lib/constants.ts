// v5.8 hard drift thresholds (Section 3.1)
// BTC has no lower hard trigger — underweight is soft-alert only
export const HARD_THRESHOLDS: Record<string, { low?: number; high: number }> = {
  VT:   { low: 42, high: 62 },
  QQQM: { low: 15, high: 31 },
  SMH:  { low: 5,  high: 15 },
  VWO:  { low: 3,  high: 13 },
  BTC:  { high: 8  },
}
