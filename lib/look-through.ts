// ─────────────────────────────────────────────────────────────────────────────
// Atlas Core — Look-Through Concentration (§4)
//
// Computes EFFECTIVE exposure to individual companies and sectors after looking
// through every ETF to its underlying holdings, so the §4 caps are enforceable —
// not just documented. Caps here match the Governance Document (§4).
//
// Effective exposure for X = Σ over holdings of  (holding's % of NAV) × (ETF's % in X)
// ─────────────────────────────────────────────────────────────────────────────

import { ATLAS_SPEC } from "@/lib/portfolio-spec"

// As-of date for the hand-entered ETF weight tables below. These are fact-sheet
// approximations that drift as funds rebalance; they feed the §4 look-through caps (the
// "highest law"), so a staleness signal matters. Update this date whenever the weights are
// refreshed from the latest fact sheets. Consumed by lookThroughWeightsAgeDays() below.
export const ETF_WEIGHTS_AS_OF = "2026-06-30"

/** Age (days) of the ETF weight tables relative to `now`, and whether they are stale
 *  (older than `staleAfterDays`, default one quarter). Lets the UI flag §4 exposure as
 *  "based on weights last refreshed N days ago" instead of implying live precision. */
export function lookThroughWeightsAge(now: Date, staleAfterDays = 92): { ageDays: number; stale: boolean } {
  const ageDays = Math.max(0, Math.floor((now.getTime() - new Date(ETF_WEIGHTS_AS_OF).getTime()) / 86400000))
  return { ageDays, stale: ageDays > staleAfterDays }
}

// Approximate % of each ETF made up by each mega-cap (fund fact-sheet level).
export const ETF_COMPANY_WEIGHTS: Record<string, Record<string, number>> = {
  VT:   { Nvidia: 2.5, Microsoft: 3.0, Apple: 3.0, Amazon: 2.2, Meta: 1.4, Alphabet: 1.8, Broadcom: 0.9, TSMC: 0.8 },
  VWRA: { Nvidia: 2.5, Microsoft: 3.0, Apple: 3.0, Amazon: 2.2, Meta: 1.4, Alphabet: 1.8, Broadcom: 0.9, TSMC: 0.8 },
  QQQM: { Nvidia: 7.0, Microsoft: 8.5, Apple: 9.0, Amazon: 5.5, Meta: 4.5, Alphabet: 4.0, Broadcom: 3.5, TSMC: 0.0 },
  EQQQ: { Nvidia: 7.0, Microsoft: 8.5, Apple: 9.0, Amazon: 5.5, Meta: 4.5, Alphabet: 4.0, Broadcom: 3.5, TSMC: 0.0 },
  SMH:  { Nvidia: 20.0, Microsoft: 0.0, Apple: 0.0, Amazon: 0.0, Meta: 0.0, Alphabet: 0.0, Broadcom: 8.0, TSMC: 12.0 },
  SEMI: { Nvidia: 20.0, Microsoft: 0.0, Apple: 0.0, Amazon: 0.0, Meta: 0.0, Alphabet: 0.0, Broadcom: 8.0, TSMC: 12.0 },
  VWO:  { Nvidia: 0.0, Microsoft: 0.0, Apple: 0.0, Amazon: 0.0, Meta: 0.0, Alphabet: 0.0, Broadcom: 0.0, TSMC: 7.0 },
  VFEA: { Nvidia: 0.0, Microsoft: 0.0, Apple: 0.0, Amazon: 0.0, Meta: 0.0, Alphabet: 0.0, Broadcom: 0.0, TSMC: 7.0 },
  BTC:  {},
  IBIT: {},
  SGOV: {},
}

// Approximate sector / geography make-up of each ETF (% of the ETF).
export const ETF_SECTOR_WEIGHTS: Record<string, { semiconductor: number; digital: number; us: number; ai: number }> = {
  VT:   { semiconductor: 8,   digital: 35, us: 62,  ai: 15 },
  VWRA: { semiconductor: 8,   digital: 35, us: 62,  ai: 15 },
  QQQM: { semiconductor: 13,  digital: 65, us: 100, ai: 35 },
  EQQQ: { semiconductor: 13,  digital: 65, us: 100, ai: 35 },
  SMH:  { semiconductor: 100, digital: 90, us: 75,  ai: 70 },
  SEMI: { semiconductor: 100, digital: 90, us: 75,  ai: 70 },
  VWO:  { semiconductor: 12,  digital: 30, us: 0,   ai: 10 },
  VFEA: { semiconductor: 12,  digital: 30, us: 0,   ai: 10 },
  BTC:  { semiconductor: 0,   digital: 0,  us: 0,   ai: 0 },
  IBIT: { semiconductor: 0,   digital: 0,  us: 0,   ai: 0 },
  SGOV: { semiconductor: 0,   digital: 0,  us: 0,   ai: 0 },
}

// Geographic make-up of each ETF (% of the ETF): US / Intl-Developed / Emerging / Crypto.
export const ETF_GEO_WEIGHTS: Record<string, { us: number; intlDev: number; emerging: number; crypto: number }> = {
  VT:   { us: 62,  intlDev: 30, emerging: 8,   crypto: 0 },
  VWRA: { us: 62,  intlDev: 30, emerging: 8,   crypto: 0 },
  QQQM: { us: 100, intlDev: 0,  emerging: 0,   crypto: 0 },
  EQQQ: { us: 100, intlDev: 0,  emerging: 0,   crypto: 0 },
  SMH:  { us: 75,  intlDev: 13, emerging: 12,  crypto: 0 },
  SEMI: { us: 75,  intlDev: 13, emerging: 12,  crypto: 0 },
  VWO:  { us: 0,   intlDev: 0,  emerging: 100, crypto: 0 },
  VFEA: { us: 0,   intlDev: 0,  emerging: 100, crypto: 0 },
  BTC:  { us: 0,   intlDev: 0,  emerging: 0,   crypto: 100 },
  IBIT: { us: 0,   intlDev: 0,  emerging: 0,   crypto: 100 },
  SGOV: { us: 100, intlDev: 0,  emerging: 0,   crypto: 0 },
}

// Caps as written in the Governance Document (§4). Whole-number percent of NAV.
export const LOOKTHROUGH_COMPANY_CAPS: Record<string, { soft: number; hard: number }> = {
  Nvidia:    { soft: 10, hard: 13 },
  Microsoft: { soft: 10, hard: 13 },
  Apple:     { soft: 8,  hard: 11 },
  Amazon:    { soft: 7,  hard: 9 },
  Meta:      { soft: 6,  hard: 8 },
  Alphabet:  { soft: 6,  hard: 8 },
  Broadcom:  { soft: 5,  hard: 7 },
  TSMC:      { soft: 5,  hard: 7 },
}

// soft/hard derived from the single source (lib/portfolio-spec.ts); labels are presentation.
const SECTOR_LABELS: Record<string, string> = {
  semiconductor: "Semiconductor", digital: "Digital Economy", us: "US Market", ai: "AI Infrastructure",
}
export const LOOKTHROUGH_SECTOR_CAPS: Record<string, { label: string; soft: number; hard: number }> =
  Object.fromEntries(
    Object.entries(ATLAS_SPEC.lookThroughSectors).map(([k, v]) => [
      k, { label: SECTOR_LABELS[k] ?? k, soft: v.soft, hard: v.hard },
    ]),
  )

export type CapStatus = "ok" | "watch" | "breach"

export interface ExposureLine {
  key: string
  label: string
  pct: number
  soft: number
  hard: number
  status: CapStatus
}

export interface LookThroughResult {
  companies: ExposureLine[]
  sectors: ExposureLine[]
}

function statusFor(pct: number, soft: number, hard: number): CapStatus {
  if (pct > hard) return "breach"
  if (pct > soft) return "watch"
  return "ok"
}

/** Compute effective company + sector exposure for the live portfolio. */
export function computeLookThrough(positions: Array<{ ticker: string; actualPct: number }>): LookThroughResult {
  const companyTotals: Record<string, number> = {}
  const sectorTotals: Record<string, number> = { semiconductor: 0, digital: 0, us: 0, ai: 0 }

  for (const p of positions) {
    const w = p.actualPct / 100
    const cw = ETF_COMPANY_WEIGHTS[p.ticker.toUpperCase()] ?? {}
    for (const [co, pct] of Object.entries(cw)) {
      companyTotals[co] = (companyTotals[co] ?? 0) + w * pct
    }
    const sw = ETF_SECTOR_WEIGHTS[p.ticker.toUpperCase()]
    if (sw) {
      sectorTotals.semiconductor += w * sw.semiconductor
      sectorTotals.digital       += w * sw.digital
      sectorTotals.us            += w * sw.us
      sectorTotals.ai            += w * sw.ai
    }
  }

  const companies: ExposureLine[] = Object.keys(LOOKTHROUGH_COMPANY_CAPS).map((co) => {
    const cap = LOOKTHROUGH_COMPANY_CAPS[co]
    const pct = companyTotals[co] ?? 0
    return { key: co, label: co, pct, soft: cap.soft, hard: cap.hard, status: statusFor(pct, cap.soft, cap.hard) }
  }).sort((a, b) => b.pct - a.pct)

  const sectors: ExposureLine[] = Object.keys(LOOKTHROUGH_SECTOR_CAPS).map((k) => {
    const cap = LOOKTHROUGH_SECTOR_CAPS[k]
    const pct = sectorTotals[k] ?? 0
    return { key: k, label: cap.label, pct, soft: cap.soft, hard: cap.hard, status: statusFor(pct, cap.soft, cap.hard) }
  }).sort((a, b) => b.pct - a.pct)

  return { companies, sectors }
}

/** The single worst look-through breach (hard cap exceeded), if any — for the engine. */
export function worstLookThroughBreach(lt: LookThroughResult): ExposureLine | null {
  const breaches = [...lt.companies, ...lt.sectors]
    .filter((l) => l.status === "breach")
    .sort((a, b) => (b.pct - b.hard) - (a.pct - a.hard))
  return breaches[0] ?? null
}

/** The single worst look-through APPROACH (over soft, under hard) — for the ladder's Step-4
 *  "review, don't sell" warning. Returns null when something is already in hard breach (that
 *  is a higher-priority Step-1 trim, not a soft warning). */
export function worstLookThroughApproach(lt: LookThroughResult): ExposureLine | null {
  const all = [...lt.companies, ...lt.sectors]
  if (all.some((l) => l.status === "breach")) return null
  const watching = all
    .filter((l) => l.status === "watch")
    .sort((a, b) => (b.pct - b.soft) - (a.pct - a.soft))
  return watching[0] ?? null
}

/** Which holding contributes most to a given company/sector — the one to trim. */
export function largestContributor(
  exposureKey: string,
  kind: "company" | "sector",
  positions: Array<{ ticker: string; actualPct: number }>
): string | null {
  let best: { ticker: string; contrib: number } | null = null
  for (const p of positions) {
    const t = p.ticker.toUpperCase()
    const contrib = kind === "company"
      ? (ETF_COMPANY_WEIGHTS[t]?.[exposureKey] ?? 0) * (p.actualPct / 100)
      : ((ETF_SECTOR_WEIGHTS[t] as Record<string, number> | undefined)?.[exposureKey] ?? 0) * (p.actualPct / 100)
    if (contrib > 0 && (!best || contrib > best.contrib)) best = { ticker: p.ticker, contrib }
  }
  return best?.ticker ?? null
}
