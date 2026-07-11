// ─────────────────────────────────────────────────────────────────────────────
// Atlas Universe — per-user Constitution registry.
//
// Atlas Core hosts more than one investment constitution. Which one a user sees is
// decided by WHO LOGS IN. David → Atlas Core (2045 retirement). Dami → Silicon Brick
// Road (HDB property deposit). Each constitution is config-as-data here, so the app can
// render a completely different governed portfolio without forking the codebase.
//
// David's Atlas Core keeps its bespoke engine (lib/next-best-move.ts, lib/constants.ts);
// this registry drives the Silicon Brick Road experience end-to-end (lib/sbr-engine.ts).
//
// The SBR rule NUMBERS below are DERIVED from the single source in lib/portfolio-spec.ts
// (SBR_SPEC); this file only adds the plain-English presentation (names, roles, colours,
// notes, phase copy). scripts/check-spec.ts asserts the derivation, so a rule value here
// can never drift from the spec / engine / served doc.
// ─────────────────────────────────────────────────────────────────────────────

import { SBR_SPEC } from "@/lib/portfolio-spec"

export type ConstitutionId = "atlas-core" | "silicon-brick-road"

export interface ConstitutionFund {
  ticker: string
  name: string
  role: string
  target: number          // % of portfolio
  rangeLow: number        // comfortable range low
  rangeHigh: number       // comfortable range high
  hardCap: number | null  // outer limit that triggers mandatory action (null = floor-only)
  floor?: number          // safety floor (A35) — below this, all contributions redirect here
  color: string
  note?: string
}

export interface ConstitutionPhase {
  key: string
  label: string
  range: string
  min: number             // portfolio value lower bound (inclusive)
  max: number | null      // upper bound (exclusive); null = open-ended
  selling: boolean
  body: string
  targets?: Record<string, number>  // redirect targets in this phase
}

export interface Constitution {
  id: ConstitutionId
  name: string
  shortName: string
  version: string
  updated: string
  motto?: string
  objective: string
  targetValue: number | null
  currency: "SGD" | "USD"
  monthlyContribution: number
  broker: string
  docPath: string                    // served from public/
  funds: ConstitutionFund[]
  combined?: { tickers: string[]; warning: number; hard: number; resume: number; label: string }
  totalEquityMaxPct?: number
  drawdownTriggerPct?: number
  skipAtHighPct: number
  phases?: ConstitutionPhase[]
  decisionLadder: { n: number; title: string; detail: string }[]
  rules: { category: string; title: string; description: string }[]
  scorecard?: { category: string; weight: number; assessed: string }[]
}

// Which constitution a user owns. Email-based so no schema migration is needed; add
// entries here as the Atlas Universe grows.
const CONSTITUTION_BY_EMAIL: Record<string, ConstitutionId> = {
  "dutszm@gmail.com": "silicon-brick-road",
}

export function constitutionIdForEmail(email: string | undefined | null): ConstitutionId {
  if (!email) return "atlas-core"
  return CONSTITUTION_BY_EMAIL[email.trim().toLowerCase()] ?? "atlas-core"
}

// ─── Atlas Core (David) — light registry entry; the full engine lives in lib/constants.ts ──
export const ATLAS_CORE: Constitution = {
  id: "atlas-core",
  name: "Atlas Core — Investment Constitution",
  shortName: "Atlas Core",
  version: "2.2",
  updated: "2026-07",
  motto: "Disciplina Supra Praedictio",
  objective: "A long-term retirement portfolio targeting 2045. Its job is to grow wealth by following a fixed set of rules instead of feelings, headlines, or random ideas. Not for trading or gambling — for staying invested until 2045 and letting compounding do the work.",
  targetValue: null,
  currency: "USD",
  monthlyContribution: 3000,
  broker: "IBKR Singapore",
  docPath: "/atlas-core-constitution.html",
  funds: [
    { ticker: "IMID", name: "SPDR MSCI ACWI IMI UCITS ETF (Acc)", role: "The global core — developed, emerging and small-cap equities in one accumulating Irish UCITS fund.", target: 67.5, rangeLow: 62.5, rangeHigh: 72.5, hardCap: 75, floor: 60, color: "#7c3aed" },
    { ticker: "EQAC", name: "Invesco EQQQ Nasdaq-100 UCITS ETF Acc", role: "A measured Nasdaq-100 growth tilt, capped so it never replaces global diversification.", target: 15, rangeLow: 12, rangeHigh: 18, hardCap: 20, floor: 10, color: "#a78bfa" },
    { ticker: "SMH", name: "VanEck Semiconductor UCITS ETF", role: "A deliberately small semiconductor satellite identified by ISIN IE00BMC38736.", target: 7.5, rangeLow: 5, rangeHigh: 9, hardCap: 10, floor: 3, color: "#c026d3" },
    { ticker: "BTC", name: "Bitcoin sleeve", role: "All direct and listed Bitcoin products count together; price falls alone never authorise a sale.", target: 5, rangeLow: 3, rangeHigh: 7, hardCap: 8, color: "#f59e0b" },
    { ticker: "IB01", name: "iShares $ Treasury Bond 0-1yr UCITS ETF USD (Acc)", role: "Short US Treasury reserve for liquidity and rebalancing during accumulation.", target: 5, rangeLow: 3, rangeHigh: 7, hardCap: 10, floor: 3, color: "#10b981" },
  ],
  skipAtHighPct: 3,
  decisionLadder: [],
  rules: [
    { category: "Authority", title: "The written constitution controls", description: "Atlas v2.2 governs. The app implements its thresholds and contribution-first decision process; any disagreement must be resolved in favour of the written constitution." },
    { category: "Portfolio construction", title: "Broad core, capped convictions", description: "Target IMID 67.5%, EQAC 15%, SMH 7.5%, Bitcoin 5% and IB01 5%. All Bitcoin products count as one sleeve and all approved UCITS share classes are controlled by ISIN." },
    { category: "Contributions", title: "Repair drift with new money", description: "Route each contribution to the furthest-underweight eligible holding. Buy whole shares after commission and FX; unused cash carries in Atlas's separate DCA bank." },
    { category: "Look-through", title: "Measure underlying concentration", description: "Combine repeated company, country, technology and semiconductor exposure across funds. Stale data block concentration-led trades until refreshed." },
    { category: "Crash behaviour", title: "A drawdown is not a sell rule", description: "Continue contributions when personal liquidity is secure. Do not borrow, use margin or panic sell. Wait 72 hours before an unscheduled trade." },
    { category: "Amendments", title: "Evidence before change", description: "Material allocation changes require a written case, versioned decision minute and 30-day cooling-off period unless a legal or operational emergency makes delay unsafe." },
  ],
}

// ─── Silicon Brick Road (Dami) — full config, drives the whole SBR experience ──────────

// Presentation only — plain-English names, roles, colours, notes. Rule numbers (target,
// range, cap, floor) come from SBR_SPEC.funds, merged in below.
const SBR_PRESENTATION: Record<string, { name: string; role: string; color: string; note?: string }> = {
  IMID: { name: "SPDR MSCI ACWI IMI UCITS ETF (Acc)", role: "The simple global core — most of the portfolio", color: "#38bdf8" },
  EQAC: { name: "Invesco EQQQ Nasdaq-100 UCITS ETF Acc", role: "A small Nasdaq-100 growth tilt", color: "#2563eb" },
  SMH: { name: "VanEck Semiconductor UCITS ETF", role: "A small semiconductor satellite with an 8% cap", color: "#818cf8" },
  IB01: { name: "iShares $ Treasury Bond 0-1yr UCITS ETF USD (Acc)", role: "Short Treasury reserve for rebalancing and a future transition", color: "#0891b2" },
}

const SBR_FUNDS: ConstitutionFund[] = SBR_SPEC.funds.map((f) => ({
  ticker: f.ticker,
  name: SBR_PRESENTATION[f.ticker]?.name ?? f.ticker,
  role: SBR_PRESENTATION[f.ticker]?.role ?? "",
  target: f.target,
  rangeLow: f.rangeLow,
  rangeHigh: f.rangeHigh,
  hardCap: f.hardCap,
  ...(f.floor !== undefined ? { floor: f.floor } : {}),
  color: SBR_PRESENTATION[f.ticker]?.color ?? "#64748b",
  ...(SBR_PRESENTATION[f.ticker]?.note ? { note: SBR_PRESENTATION[f.ticker]!.note } : {}),
}))

// Phase copy is presentation; the value bounds (min/max) are derived from SBR_SPEC.phases by key.
const SBR_PHASE_COPY: Array<Omit<ConstitutionPhase, "min" | "max">> = [
  { key: "GROWTH", label: "Flexible growth", range: "No fixed end date", selling: false, body: "Remain in growth mode until Dami records a genuine SGD use, amount and date. Market falls alone do not create an exit date.", targets: { IMID: 80, EQAC: 10, SMH: 5, IB01: 5 } },
]

const SBR_PHASES: ConstitutionPhase[] = SBR_PHASE_COPY.map((p) => {
  const spec = SBR_SPEC.phases.find((x) => x.key === p.key)
  if (!spec) throw new Error(`SBR phase ${p.key} missing from SBR_SPEC`)
  return { ...p, min: spec.min, max: spec.max }
})

export const SILICON_BRICK_ROAD: Constitution = {
  id: "silicon-brick-road",
  name: "Silicon Brick Road — Investment Constitution",
  shortName: "Silicon Brick Road",
  version: "3.2",
  updated: "2026-07",
  motto: "Discipline Over Prediction",
  objective: "Grow medium-term wealth through a simple global portfolio with no required end date. A future spending need must be written down before de-risking begins.",
  targetValue: null,
  currency: SBR_SPEC.currency,
  monthlyContribution: SBR_SPEC.monthlyContribution,
  broker: "IBKR Singapore",
  docPath: "/silicon-brick-road.html",
  funds: SBR_FUNDS,
  combined: { tickers: [...SBR_SPEC.combined.tickers], warning: SBR_SPEC.combined.warning, hard: SBR_SPEC.combined.hard, resume: SBR_SPEC.combined.resume, label: "Combined EQAC + SMH ceiling" },
  totalEquityMaxPct: SBR_SPEC.totalEquityMaxPct,
  drawdownTriggerPct: SBR_SPEC.drawdownTriggerPct,
  skipAtHighPct: SBR_SPEC.skipAtHighPct,
  phases: SBR_PHASES,
  decisionLadder: [
    { n: 1, title: "Is any holding above a hard cap or below a required floor?", detail: "Pause additions to the breached holding. Route new cash to the furthest-underweight eligible core or reserve. Document a correction; do not sell automatically." },
    { n: 2, title: "Is EQAC plus SMH above 20%?", detail: "Pause both satellites and direct new contributions to IMID or IB01 until the combined allocation is back within the mandate." },
    { n: 3, title: "Is look-through data stale or a concentration trigger active?", detail: "Refresh the source data. Data older than 95 days block concentration-led trades. A confirmed trigger pauses the overlapping satellite; it does not force a sale." },
    { n: 4, title: "Has Dami recorded a real SGD use, amount and date?", detail: "If no, remain in flexible growth mode. If yes, write a liability-matching transition plan before changing risk." },
    { n: 5, title: "Is a fund below its soft band?", detail: "Put the available whole-share contribution into the furthest-underweight eligible fund. Carry unused cash in SBR's separate DCA bank." },
    { n: 6, title: "None of the above — the portfolio is on mandate.", detail: "Continue the monthly contribution. Do not trade merely because markets moved or a forecast changed." },
  ],
  rules: [
    { category: "The Ground Rules", title: "Flexible medium-term growth", description: "SBR has no fixed end date and is not reserved for a property purchase. It remains in growth mode until Dami writes down a genuine use, SGD amount and date." },
    { category: "How to Split Your Money", title: "One broad core and three helpers", description: "Target IMID 80%, EQAC 10%, SMH 5% and IB01 5%. All four approved vehicles are Irish-domiciled accumulating UCITS share classes identified by ISIN." },
    { category: "Keeping Things in Balance", title: "Use contributions before selling", description: "Route each contribution to the furthest-underweight eligible holding. Soft bands guide new cash; hard caps require a documented correction. Market falls alone never force a sale." },
    { category: "Regular Investing", title: "Whole shares and the DCA cash bank", description: "Buy whole shares after reserving commission and FX. Unused contribution cash carries forward in SBR's separate SGD bank and is never treated as invested or as IB01." },
    { category: "What You Actually Own", title: "Look through every ETF", description: "Combine repeated exposure across IMID, EQAC and SMH. Watch/review levels: company 7/8%, technology 38/43%, semiconductors 18/22%, country 68/72%, and data age 35/95 days." },
    { category: "Staying Disciplined", title: "Crash protocol", description: "A sharp correction is accepted risk. Continue contributions if personal liquidity is secure; do not borrow, use margin or panic sell. Wait 72 hours before an unscheduled sale." },
    { category: "Future Spending", title: "Define the liability before de-risking", description: "Record the purpose, SGD amount, earliest and latest date, and flexibility after a market fall. Only then should required money transition toward suitable SGD-safe assets." },
    { category: "Changing the Rules", title: "Changes require evidence and cooling-off", description: "Material allocation changes need a written case and 30-day cooling-off period. Recent performance, fear or a persuasive forecast is not sufficient evidence." },
  ],
  scorecard: [
    { category: "Governance compliance", weight: 25, assessed: "Monthly decision ladder followed; no undocumented trades or hard-limit breaches." },
    { category: "Risk management", weight: 20, assessed: "Holding, combined-satellite and look-through limits respected or a documented correction is active." },
    { category: "Allocation discipline", weight: 15, assessed: "Contribution routed to the furthest-underweight eligible holding." },
    { category: "Contribution discipline", weight: 15, assessed: "Contribution and DCA-bank carry-forward recorded accurately." },
    { category: "Behavioural discipline", weight: 10, assessed: "No prediction-led trading; crash and 72-hour rules followed." },
    { category: "Liquidity and currency safety", weight: 10, assessed: "Personal SGD liquidity remains outside SBR; IB01 and FX risks understood." },
    { category: "Documentation", weight: 5, assessed: "Trades, source freshness, exceptions and any future liability are current." },
  ],
}

export const CONSTITUTIONS: Record<ConstitutionId, Constitution> = {
  "atlas-core": ATLAS_CORE,
  "silicon-brick-road": SILICON_BRICK_ROAD,
}

export function getConstitution(id: ConstitutionId): Constitution {
  return CONSTITUTIONS[id]
}

export function constitutionForEmail(email: string | undefined | null): Constitution {
  return CONSTITUTIONS[constitutionIdForEmail(email)]
}
