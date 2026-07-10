import { ATLAS_SPEC, SBR_SPEC } from "@/lib/portfolio-spec"
import { blendedGrowthRates } from "@/lib/forecast"
import { sbrBlendedGrowthRate, SBR_ASSET_EXPECTED_RETURNS } from "@/lib/sbr-forecast"
import { formatCurrency } from "@/lib/utils"

// ── Atlas Core derived constants ────────────────────────────────────────────

const atlasFundsWithTarget = ATLAS_SPEC.funds.filter(f => f.target > 0)

export const ATLAS_TARGET_HHI = atlasFundsWithTarget.reduce(
  (s, f) => s + (f.target / 100) ** 2, 0,
)
export const ATLAS_TARGET_HHI_PCT = ATLAS_TARGET_HHI * 100
export const ATLAS_TARGET_EFF_N = ATLAS_TARGET_HHI_PCT > 0 ? 100 / ATLAS_TARGET_HHI_PCT : 0

export const ATLAS_HHI_THRESHOLDS = {
  onTarget: ATLAS_TARGET_HHI + 0.04,
  drifting: ATLAS_TARGET_HHI + 0.10,
  onTargetPct: ATLAS_TARGET_HHI_PCT + 4,
  driftingPct: ATLAS_TARGET_HHI_PCT + 10,
} as const

export function atlasConcentrationLabel(hhi: number): "On Target" | "Drifting" | "Concentrated" {
  if (hhi < ATLAS_HHI_THRESHOLDS.onTarget) return "On Target"
  if (hhi < ATLAS_HHI_THRESHOLDS.drifting) return "Drifting"
  return "Concentrated"
}

export function atlasConcentrationLabelPct(hhiPct: number): "On Target" | "Drifting" | "Concentrated" {
  if (hhiPct < ATLAS_HHI_THRESHOLDS.onTargetPct) return "On Target"
  if (hhiPct < ATLAS_HHI_THRESHOLDS.driftingPct) return "Drifting"
  return "Concentrated"
}

export const ATLAS_EFF_N_THRESHOLDS = {
  near: ATLAS_TARGET_EFF_N - 0.3,
  below: ATLAS_TARGET_EFF_N - 0.8,
} as const

const atlasTargetAlloc = Object.fromEntries(
  atlasFundsWithTarget.map(f => [f.ticker, f.target]),
)
export const ATLAS_TARGET_BLEND = blendedGrowthRates(atlasTargetAlloc, 0)
export const ATLAS_TARGET_RATES = ATLAS_TARGET_BLEND.rates

// ── SBR derived constants ───────────────────────────────────────────────────

const sbrFundsWithTarget = SBR_SPEC.funds.filter(f => f.target > 0)

const sbrTargetAlloc = Object.fromEntries(
  sbrFundsWithTarget.map(f => [f.ticker, f.target]),
)
export const SBR_TARGET_RATES = sbrBlendedGrowthRate(sbrTargetAlloc)

export const SBR_FUND_RATE_STRINGS: Record<string, string> = Object.fromEntries(
  SBR_SPEC.funds
    .filter(f => f.expectedReturn)
    .map(f => [
      f.ticker,
      `${(f.expectedReturn!.conservative * 100).toFixed(0)}–${(f.expectedReturn!.aggressive * 100).toFixed(0)}%`,
    ]),
)

export type BrickRoadPhase = { key: string; threshold: number; label: string }

export function sbrBrickRoadPhases(target: number): BrickRoadPhase[] {
  return SBR_SPEC.phases.map(p => ({
    key: p.key,
    threshold: p.max ?? target,
    label: p.max !== null
      ? `< ${formatCurrency(p.max, "SGD")}`
      : `${formatCurrency(p.min, "SGD")}+`,
  }))
}

export { SBR_ASSET_EXPECTED_RETURNS }
