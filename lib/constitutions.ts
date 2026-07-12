// ─────────────────────────────────────────────────────────────────────────────
// Atlas Universe — per-user Constitution registry.
//
// Atlas Core hosts more than one investment constitution. Which one a user sees is
// decided by WHO LOGS IN. David → Atlas Core (2045 retirement). Dami → Silicon Brick
// Road (flexible medium-term investment). Each constitution is config-as-data here, so the app can
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

import { ATLAS_SPEC, SBR_SPEC } from "@/lib/portfolio-spec"

export type ConstitutionId = "atlas-core" | "silicon-brick-road"

export interface ConstitutionFund {
  ticker: string
  name: string
  role: string
  target: number          // % of portfolio
  rangeLow: number        // comfortable range low
  rangeHigh: number       // comfortable range high
  hardCap: number | null  // outer limit that triggers mandatory action (null = floor-only)
  floor?: number          // required allocation floor — below this, contributions redirect here
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
  version: "10.4",
  updated: "2026-07",
  motto: "Disciplina Supra Praedictio",
  objective: "A long-term retirement portfolio targeting 2045. Its job is to grow wealth by following a fixed set of rules instead of feelings, headlines, or random ideas. Not for trading or gambling — for staying invested until 2045 and letting compounding do the work.",
  targetValue: null,
  currency: "USD",
  monthlyContribution: 3000,
  broker: "IBKR Singapore",
  docPath: "/atlas-core-constitution.html",
  funds: ATLAS_SPEC.funds.map((f) => ({
    ticker: f.ticker,
    name: ({ VWRA: "Vanguard FTSE All-World UCITS ETF (Acc)", EQAC: "Invesco EQQQ Nasdaq-100 UCITS ETF Acc", SMH: "VanEck Semiconductor UCITS ETF", BTC: "Bitcoin sleeve — IBIT", DBMFE: "iMGP DBi Managed Futures Fund R EUR UCITS ETF" } as Record<string,string>)[f.ticker] ?? f.ticker,
    role: ({ VWRA: "The broad global equity core.", EQAC: "A capped Nasdaq-100 growth tilt.", SMH: "A deliberately bounded semiconductor satellite.", BTC: "IBIT is the approved vehicle; GBTC counts with it during migration.", DBMFE: "A Luxembourg UCITS managed-futures diversifier; not cash or a guaranteed hedge." } as Record<string,string>)[f.ticker] ?? "",
    target: f.target, rangeLow: f.target - f.band, rangeHigh: f.target + f.band,
    hardCap: f.hardCap, ...(f.hardFloor !== null && f.hardFloor !== undefined ? { floor: f.hardFloor } : {}),
    color: ({ VWRA: "#7c3aed", EQAC: "#a78bfa", SMH: "#c026d3", BTC: "#f59e0b", DBMFE: "#10b981" } as Record<string,string>)[f.ticker] ?? "#64748b",
  })),
  combined: { tickers: [...ATLAS_SPEC.combinedTech.tickers], warning: ATLAS_SPEC.combinedTech.soft, hard: ATLAS_SPEC.combinedTech.hard, resume: ATLAS_SPEC.combinedTech.soft, label: "Combined EQAC + SMH ceiling" },
  skipAtHighPct: 3,
  decisionLadder: [],
  rules: [
    { category: "Authority", title: "The written constitution controls", description: "Atlas v10.4 governs. The app implements its thresholds and contribution-first decision process; any disagreement must be resolved in favour of the written constitution." },
    { category: "Portfolio construction", title: "A broad core with bounded return sleeves", description: "Target VWRA 70%, EQAC 10%, SMH 5%, Bitcoin through IBIT 5% and DBMFE managed futures 10%. Personal SGD liquidity is maintained outside Atlas." },
    { category: "Legacy migration", title: "History stays with the original instrument", description: "VT, VWO, QQQM, US-listed SMH and GBTC remain visible until authoritative sale settlement. Never rename them or transfer their cost basis. Settled proceeds enter the DCA cash bank before replacement purchases." },
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
  VWRA: { name: "Vanguard FTSE All-World UCITS ETF (Acc)", role: "The simple global core — most of the portfolio", color: "#38bdf8" },
  EQAC: { name: "Invesco EQQQ Nasdaq-100 UCITS ETF Acc", role: "A small Nasdaq-100 growth tilt", color: "#2563eb" },
  SMH: { name: "VanEck Semiconductor UCITS ETF", role: "A bounded semiconductor satellite", color: "#818cf8" },
  BTC: { name: "Bitcoin sleeve", role: "A capped asymmetric return sleeve", color: "#f59e0b" },
  DBMFE: { name: "iMGP DBi Managed Futures Fund R EUR UCITS ETF", role: "A Luxembourg UCITS managed-futures diversifier with a governed floor", color: "#0891b2" },
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
  { key: "GROWTH", label: "Flexible growth", range: "No fixed end date", selling: false, body: "Remain in growth mode until Dami records a genuine SGD use, amount and date. Market falls alone do not create an exit date.", targets: Object.fromEntries(SBR_SPEC.funds.map(f => [f.ticker, f.target])) },
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
  version: "10.2",
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
    { n: 2, title: `Is EQAC plus SMH above ${SBR_SPEC.combined.hard}%?`, detail: "Pause both satellites and direct new contributions to the furthest-underweight eligible holding until the combined allocation is back within the mandate." },
    { n: 3, title: "Is look-through data stale or a concentration trigger active?", detail: "Refresh the source data. Warn after 35 days and block concentration-led trades after 75 days. A confirmed trigger pauses the overlapping satellite; it does not force a sale." },
    { n: 4, title: "Has Dami recorded a real SGD use, amount and date?", detail: "If no, remain in flexible growth mode. If yes, write a liability-matching transition plan before changing risk." },
    { n: 5, title: "Is a fund below its soft band?", detail: "Put the available whole-share contribution into the furthest-underweight eligible fund. Carry unused cash in SBR's separate DCA bank." },
    { n: 6, title: "None of the above — the portfolio is on mandate.", detail: "Continue the monthly contribution. Do not trade merely because markets moved or a forecast changed." },
  ],
  rules: [
    { category: "The Ground Rules", title: "Flexible medium-term growth", description: "SBR has no fixed end date or pre-assigned spending purpose. It remains in growth mode until Dami writes down a genuine use, SGD amount and date." },
    { category: "How to Split Your Money", title: "One broad core and four bounded sleeves", description: "Target VWRA 65%, EQAC 15%, SMH 5%, Bitcoin 5% and DBMFE managed futures 10%. Approved funds are identified by immutable instrument identity, not ticker alone." },
    { category: "Keeping Things in Balance", title: "Use contributions before selling", description: "Route each contribution to the furthest-underweight eligible holding. Soft bands guide new cash; hard caps require a documented correction. Market falls alone never force a sale." },
    { category: "Regular Investing", title: "Whole shares and the DCA cash bank", description: "Buy whole shares after reserving commission and FX. Unused contribution cash carries forward in SBR's separate SGD bank and is never treated as invested." },
    { category: "What You Actually Own", title: "Look through every fund", description: "Combine repeated exposure across VWRA, EQAC, SMH and DBMFE. Data freshness and concentration limits govern additions to overlapping sleeves." },
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
    { category: "Liquidity and currency safety", weight: 10, assessed: "Personal SGD liquidity remains outside SBR; investment and FX risks are understood." },
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
