// ─────────────────────────────────────────────────────────────────────────────
// Shared digest item type — used by both Atlas Core and SBR governance digests.
// Kept here (shared) so SBR modules don't need to import from Atlas-specific files.
export interface DigestItem {
  severity: "breach" | "watch" | "info"
  title: string
  detail: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Atlas Core — Governance Alignment
//
// Evaluates the live portfolio against the written rules and returns a plain-English
// pass / watch / breach for each. Powers the dashboard "Governance Alignment" panel,
// so the user sees in one place whether they are inside the rules.
// ─────────────────────────────────────────────────────────────────────────────

import { HARD_THRESHOLDS, COMBINED_TECH_RULE, getBtcModifier, OPERATING_ASSUMPTIONS } from "@/lib/constants"
import { BITCOIN_TICKERS } from "@/lib/next-best-move"
import { isInScope } from "@/lib/approved-alternatives"
import type { LookThroughResult } from "@/lib/look-through"

export type Align = "ok" | "watch" | "breach"

export interface GovCheck {
  id: string
  label: string
  status: Align
  detail: string
}

export interface GovAlignment {
  checks: GovCheck[]
  breaches: number
  watches: number
  overall: Align
}

interface Pos { ticker: string; actualPct: number; targetPct: number; toleranceBand?: number | null }

export function evaluateGovernance(input: {
  positions: Pos[]
  bufferPct: number
  lookThrough: LookThroughResult
  usSitedValueUsd?: number
}): GovAlignment {
  const { positions, bufferPct, lookThrough, usSitedValueUsd } = input
  const checks: GovCheck[] = []
  const pos = (t: string) => positions.find((p) => p.ticker.toUpperCase() === t)

  // 1 — Allocation drift (every holding inside its band)
  let hardDrift = 0, softDrift = 0
  for (const p of positions) {
    const ht = HARD_THRESHOLDS[p.ticker]
    if (!ht) continue
    const band = p.toleranceBand ?? 2.5
    const overHardHigh = p.actualPct > ht.high
    const underHardLow = ht.low !== undefined && p.actualPct < ht.low
    if (overHardHigh || underHardLow) hardDrift++
    else if (Math.abs(p.actualPct - p.targetPct) > band) softDrift++
  }
  checks.push({
    id: "drift",
    label: "Allocation on target",
    status: hardDrift > 0 ? "breach" : softDrift > 0 ? "watch" : "ok",
    detail: hardDrift > 0 ? `${hardDrift} holding${hardDrift > 1 ? "s" : ""} outside the safe range`
      : softDrift > 0 ? `${softDrift} holding${softDrift > 1 ? "s" : ""} drifting — top up with this month's money`
      : "Every holding is within its target range",
  })

  // 2 — SMH cap (≤12%)
  const smh = pos("SMH")
  if (smh) {
    checks.push({
      id: "smh", label: "Chip fund (SMH) under its 12% limit",
      status: smh.actualPct > 12 ? "breach" : smh.actualPct > 11 ? "watch" : "ok",
      detail: `SMH is ${smh.actualPct.toFixed(1)}% of your money (limit 12%)`,
    })
  }

  // 3 — Bitcoin sleeve (BTC + IBIT) under its cycle cap
  const btcCap = getBtcModifier().hardHigh
  const btcSleeve = positions.filter((p) => (BITCOIN_TICKERS as readonly string[]).includes(p.ticker.toUpperCase()))
    .reduce((s, p) => s + p.actualPct, 0)
  if (btcSleeve > 0) {
    checks.push({
      id: "btc", label: `Bitcoin (BTC + IBIT) under its ${btcCap}% limit`,
      status: btcSleeve > btcCap ? "breach" : btcSleeve > btcCap - 0.5 ? "watch" : "ok",
      detail: `Bitcoin is ${btcSleeve.toFixed(1)}% of your money (limit ${btcCap}%)`,
    })
  }

  // 4 — Combined tech (QQQM + SMH)
  const tech = positions
    .filter((p) => (COMBINED_TECH_RULE.tickers as readonly string[]).includes(p.ticker.toUpperCase()))
    .reduce((s, p) => s + p.actualPct, 0)
  checks.push({
    id: "tech", label: `Tech funds (QQQM + SMH) under ${COMBINED_TECH_RULE.hardCeiling}%`,
    status: tech > COMBINED_TECH_RULE.hardCeiling ? "breach" : tech >= COMBINED_TECH_RULE.softCeiling ? "watch" : "ok",
    detail: `Combined ${tech.toFixed(1)}% (review at ${COMBINED_TECH_RULE.softCeiling}%, limit ${COMBINED_TECH_RULE.hardCeiling}%)`,
  })

  // 5 — Shock buffer (SGOV ≥ 8%)
  checks.push({
    id: "buffer", label: "Safety buffer at least 8%",
    status: bufferPct >= 8 ? "ok" : bufferPct >= 6 ? "watch" : "breach",
    detail: bufferPct >= 8 ? `Buffer is ${bufferPct.toFixed(1)}% — healthy`
      : `Buffer is ${bufferPct.toFixed(1)}% — build toward 8–10% from new money`,
  })

  // 6 — Single-company concentration (worst company)
  const worstCo = lookThrough.companies[0]
  if (worstCo) {
    checks.push({
      id: "company", label: "No single company too large",
      status: lookThrough.companies.some((c) => c.status === "breach") ? "breach"
        : lookThrough.companies.some((c) => c.status === "watch") ? "watch" : "ok",
      detail: `Biggest is ${worstCo.label} at ${worstCo.pct.toFixed(1)}% (limit ${worstCo.hard}%)`,
    })
  }

  // 7 — Sector concentration (worst sector)
  const worstSec = lookThrough.sectors[0]
  if (worstSec) {
    checks.push({
      id: "sector", label: "No single area too large",
      status: lookThrough.sectors.some((s) => s.status === "breach") ? "breach"
        : lookThrough.sectors.some((s) => s.status === "watch") ? "watch" : "ok",
      detail: `Biggest is ${worstSec.label} at ${worstSec.pct.toFixed(1)}% (limit ${worstSec.hard}%)`,
    })
  }

  // 8 — US estate-tax exposure (US-sited ETFs above the ~$60k exemption → plan UCITS switch, §6B)
  if (usSitedValueUsd !== undefined && usSitedValueUsd > 0) {
    const trig = OPERATING_ASSUMPTIONS.usEstateTaxTriggerUsd
    const over = usSitedValueUsd > trig
    checks.push({
      id: "estate", label: "US estate-tax exposure",
      status: over ? "watch" : "ok",
      detail: over
        ? `~$${Math.round(usSitedValueUsd).toLocaleString()} USD in US-domiciled ETFs — above the ~$${trig.toLocaleString()} exemption. Plan a move to the Irish-UCITS alternatives (§6B).`
        : `US-domiciled ETFs within the ~$${trig.toLocaleString()} exemption.`,
    })
  }

  // 9 — Every holding inside the plan (no un-governed tickers held)
  const offScope = positions.filter((p) => p.actualPct > 0 && !isInScope(p.ticker)).map((p) => p.ticker.toUpperCase())
  if (offScope.length > 0) {
    checks.push({
      id: "scope", label: "Every holding is part of your plan",
      status: "watch",
      detail: `${offScope.join(", ")} ${offScope.length > 1 ? "are" : "is"} held but not in your policy. Decide: keep and set a target, switch to an approved fund (§6B), or exit.`,
    })
  }

  const breaches = checks.filter((c) => c.status === "breach").length
  const watches = checks.filter((c) => c.status === "watch").length
  return { checks, breaches, watches, overall: breaches > 0 ? "breach" : watches > 0 ? "watch" : "ok" }
}
