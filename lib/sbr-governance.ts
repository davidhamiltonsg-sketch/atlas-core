// ─────────────────────────────────────────────────────────────────────────────
// Silicon Brick Road — Governance Alignment
//
// Evaluates the live four-fund portfolio against the written plan and returns a
// plain-English ok / watch / breach for each rule. Extracted so the dashboard and
// the PDF report compute the exact same checks — never two copies that could
// silently drift apart.
// ─────────────────────────────────────────────────────────────────────────────

import { SILICON_BRICK_ROAD as SBR } from "@/lib/constitutions"
import { computeSbrLookThrough, SBR_TECHNOLOGY_LIMIT, SBR_SINGLE_COMPANY_LIMIT } from "@/lib/sbr-look-through"
import { sbrPhase, getPhaseCaps, type SbrPosition } from "@/lib/sbr-engine"
import type { GovAlignment, Align } from "@/lib/governance-status"

export function evaluateSbrGovernance(positions: SbrPosition[], totalValue: number): GovAlignment {
  if (totalValue <= 0) return { checks: [], breaches: 0, watches: 0, overall: "ok" }

  const smh = positions.find((p) => p.ticker === "SMH")
  const combined = positions.filter((p) => ["QQQM", "SMH"].includes(p.ticker)).reduce((s, p) => s + p.actualPct, 0)
  const a35 = positions.find((p) => p.ticker === "A35")
  const equity = positions.filter((p) => ["VWRA", "QQQM", "SMH"].includes(p.ticker)).reduce((s, p) => s + p.actualPct, 0)
  const st = (breach: boolean, watch: boolean): Align => (breach ? "breach" : watch ? "watch" : "ok")
  const phase = sbrPhase(totalValue)
  const phaseCaps = getPhaseCaps(phase.key)

  // Hidden exposure (Article XVII): look through the funds to real technology + single-company
  // concentration. Without this, a breach hiding inside the funds would show "all rules met".
  const lt = computeSbrLookThrough(positions)

  // US estate-tax exposure (Article on US-registered funds): QQQM + SMH are US-registered, so
  // holding a lot of them creates a US estate-tax risk for a non-US person. Watch as the
  // combined value approaches ~USD 50k (act) and ~USD 60k (the NRA threshold). Converted to SGD
  // at roughly 1.35 for a plain, no-extra-lookup check.
  const usFundSgd = positions.filter((p) => ["QQQM", "SMH"].includes(p.ticker)).reduce((s, p) => s + p.value, 0)
  const usFundUsd = usFundSgd / 1.35

  const checks: GovAlignment["checks"] = [
    { id: "smh",     label: `Chip fund (SMH) under its ${phaseCaps.smhHard}% cap (Phase ${phase.key})`, status: st((smh?.actualPct ?? 0) > phaseCaps.smhHard, (smh?.actualPct ?? 0) > phaseCaps.smhHard - 1), detail: `SMH is ${(smh?.actualPct ?? 0).toFixed(1)}% (Phase ${phase.key} cap ${phaseCaps.smhHard}%, target 15%)` },
    { id: "combined",label: `Tech funds (QQQM + SMH) under ${phaseCaps.combinedHard}% (Phase ${phase.key})`, status: st(combined > phaseCaps.combinedHard, combined >= phaseCaps.combinedWarning), detail: `Combined ${combined.toFixed(1)}% (Phase ${phase.key} warning ${phaseCaps.combinedWarning}%, limit ${phaseCaps.combinedHard}%)` },
    { id: "tech-lt", label: `Technology under ${SBR_TECHNOLOGY_LIMIT}% (looking inside the funds)`, status: st(lt.technologyOver, lt.technologyPct > SBR_TECHNOLOGY_LIMIT - 3), detail: `Once you look inside the funds, technology works out to about ${lt.technologyPct.toFixed(0)}% (limit ${SBR_TECHNOLOGY_LIMIT}%)` },
    { id: "company-lt", label: `No single company over ${SBR_SINGLE_COMPANY_LIMIT}%`, status: st(lt.singleCompanyOver, lt.topCompany.pct > SBR_SINGLE_COMPANY_LIMIT - 2), detail: `Your biggest single-company exposure is ${lt.topCompany.name} at about ${lt.topCompany.pct.toFixed(1)}% (limit ${SBR_SINGLE_COMPANY_LIMIT}%)` },
    { id: "a35",     label: "Safety floor (A35) at least 7%",       status: st((a35?.actualPct ?? 0) < 7, (a35?.actualPct ?? 0) < 8), detail: `A35 is ${(a35?.actualPct ?? 0).toFixed(1)}% (floor 7%, target 10%)` },
    { id: "equity",  label: "Total equity under 92%",               status: st(equity > (SBR.totalEquityMaxPct ?? 92), equity > 90), detail: `Equities ${equity.toFixed(1)}% (max ${SBR.totalEquityMaxPct}%)` },
    { id: "us-tax",  label: "US-registered funds (QQQM + SMH) under the US estate-tax level", status: st(usFundUsd > 60000, usFundUsd > 50000), detail: `QQQM + SMH are about US$${Math.round(usFundUsd).toLocaleString()}. Above ~US$50k, start moving new tech money to Ireland-registered funds; ~US$60k is the US limit.` },
    { id: "ranges",  label: "Every fund within its range",          status: st(false, positions.some((p) => p.actualPct < p.rangeLow || p.actualPct > p.rangeHigh)), detail: positions.some((p) => p.actualPct < p.rangeLow || p.actualPct > p.rangeHigh) ? "A fund has drifted outside its comfortable range" : "All four funds are within range" },
  ]
  const breaches = checks.filter((c) => c.status === "breach").length
  const watches = checks.filter((c) => c.status === "watch").length
  return { checks, breaches, watches, overall: breaches > 0 ? "breach" : watches > 0 ? "watch" : "ok" }
}
