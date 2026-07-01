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
// ─────────────────────────────────────────────────────────────────────────────

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
  name: "Atlas Core — Governance Document",
  shortName: "Atlas Core",
  version: "6.7",
  updated: "2026-06",
  motto: "Discipline beats tinkering",
  objective: "A single retirement portfolio with a 2045 target date.",
  targetValue: null,
  currency: "USD",
  monthlyContribution: 3000,
  broker: "IBKR Singapore",
  docPath: "/atlas-core-governance.html",
  funds: [
    { ticker: "VT",   name: "Vanguard Total World Stock ETF", role: "Global Core",              target: 52, rangeLow: 46, rangeHigh: 58, hardCap: 60, color: "#6366f1" },
    { ticker: "QQQM", name: "Invesco NASDAQ-100 ETF",         role: "Digital Economy Engine",   target: 23, rangeLow: 18, rangeHigh: 28, hardCap: 30, color: "#8b5cf6" },
    { ticker: "SMH",  name: "VanEck Semiconductor ETF",       role: "AI Infrastructure Tilt",   target: 10, rangeLow: 7,  rangeHigh: 12, hardCap: 12, color: "#a78bfa" },
    { ticker: "VWO",  name: "Vanguard FTSE Emerging Markets", role: "Geographic Diversifier",   target: 8,  rangeLow: 5,  rangeHigh: 11, hardCap: 13, color: "#c4b5fd" },
    { ticker: "BTC",  name: "iShares Bitcoin Trust (IBIT)",   role: "Optionality Overlay",      target: 7,  rangeLow: 6,  rangeHigh: 8,  hardCap: 8,  color: "#f59e0b" },
  ],
  skipAtHighPct: 3,
  decisionLadder: [],
  rules: [],
}

// ─── Silicon Brick Road (Dami) — full config, drives the whole SBR experience ──────────
export const SILICON_BRICK_ROAD: Constitution = {
  id: "silicon-brick-road",
  name: "Silicon Brick Road — Investment Constitution",
  shortName: "Silicon Brick Road",
  version: "2.1",
  updated: "2026-07",
  motto: "Disciplina Supra Praedictio",
  objective: "Accumulate capital toward a Singapore residential property deposit (~3-year, flexible horizon).",
  targetValue: 120000,
  currency: "SGD",
  monthlyContribution: 2000,
  broker: "IBKR Singapore",
  docPath: "/silicon-brick-road.html",
  funds: [
    { ticker: "VWRA", name: "Vanguard FTSE All-World UCITS ETF", role: "Stable global core — always accumulate",        target: 50, rangeLow: 44, rangeHigh: 56, hardCap: 62, color: "#2dd4bf" },
    { ticker: "QQQM", name: "Invesco NASDAQ-100 ETF",            role: "Growth tilt — US large-cap tech",              target: 25, rangeLow: 20, rangeHigh: 30, hardCap: 30, color: "#60a5fa" },
    { ticker: "SMH",  name: "VanEck Semiconductor ETF",          role: "Growth tilt — semiconductors (most volatile)", target: 15, rangeLow: 11, rangeHigh: 19, hardCap: 20, color: "#a78bfa", note: "Only mandatory sell in the portfolio — trim to 15% if it exceeds 20%." },
    { ticker: "A35",  name: "ABF Singapore Bond Index Fund",     role: "SGD safety floor — dry powder for deployment", target: 10, rangeLow: 7,  rangeHigh: 13, hardCap: null, floor: 7, color: "#34d399", note: "Below 7% → all contributions to A35. Upper range suspended in Phases III–IV." },
  ],
  combined: { tickers: ["QQQM", "SMH"], warning: 40, hard: 45, resume: 42, label: "Combined QQQM + SMH ceiling" },
  totalEquityMaxPct: 92,
  drawdownTriggerPct: 15,
  skipAtHighPct: 3,
  phases: [
    { key: "I",   label: "Phase I — Full growth",              range: "Below SGD 72,000",        min: 0,      max: 72000,  selling: false, body: "Standard allocation. All contributions at target weights per the Decision Engine. Maximum equity exposure — let the portfolio run.", targets: { VWRA: 50, QQQM: 25, SMH: 15, A35: 10 } },
    { key: "II",  label: "Phase II — Controlled growth",       range: "SGD 72,000–101,000",      min: 72000,  max: 102000, selling: false, body: "No selling. Redirect new contributions only toward safety. Existing holdings unchanged.", targets: { VWRA: 55, QQQM: 20, SMH: 10, A35: 15 } },
    { key: "III", label: "Phase III — Progressive preservation", range: "SGD 102,000–113,000",   min: 102000, max: 114000, selling: true,  body: "Active de-risking. On the first monthly window of each quarter, sell enough QQQM and VWRA to reduce their weights by 3% and 2% (measured on current value); proceeds to A35. Do not reduce SMH (reserved for first liquidation). A35 upper range suspended.", targets: { VWRA: 45, QQQM: 20, SMH: 15, A35: 25 } },
    { key: "IV",  label: "Phase IV — Property readiness",      range: "Above SGD 114,000",       min: 114000, max: null,   selling: false, body: "Stop buying stocks entirely. All new contributions go to A35 — concentrating in SGD reduces FX dependence in the final weeks. Begin planning the purchase timeline; within 60 days, follow the Exit Sequence (Article XIII)." },
  ],
  decisionLadder: [
    { n: 1, title: "Is SMH above 20% of the portfolio?", detail: "→ Sell SMH back to 15%. The only mandatory sell. Execute within the current window. (Article IX)" },
    { n: 2, title: "Is QQQM + SMH combined above 45%?", detail: "→ Halt both; direct all contributions to VWRA until combined drops below 42%. (Article VII)" },
    { n: 3, title: "Is A35 below 7% of the portfolio?", detail: "→ Direct all contributions to A35 until restored above 8%. The safety floor is the priority. (Article VII)" },
    { n: 4, title: "Is the portfolio in Phase III or IV of de-risking?", detail: "→ Apply phase instructions (Article XII). Phase III sells; Phase IV halts equity contributions." },
    { n: 5, title: "Has the portfolio fallen more than 15% from its month-end peak?", detail: "→ Direct the full monthly contribution to VWRA only. Do not sell anything. In a falling market, accumulate the diversified core. (Article XI)" },
    { n: 6, title: "Is QQQM or SMH within 3% of its 52-week high?", detail: "→ Skip that fund this month; redirect to VWRA. A behavioural guard against regret-buying the peak. (Article XI)" },
    { n: 7, title: "Is any fund below its comfortable range?", detail: "→ Direct the full contribution to the fund furthest below its range (VWRA <44%, QQQM <20%, SMH <11%, A35 <7%). (Article VII)" },
    { n: 8, title: "Otherwise", detail: "→ Standard DCA at target weights: VWRA 50% · QQQM 25% · SMH 15% · A35 10%. (Article VII)" },
  ],
  rules: [
    { category: "Constitutional Principles", title: "Governance over prediction", description: "Investment governance is more valuable than investment prediction. When two rules conflict, the more conservative one governs. Markets fluctuate; the Constitution shall not." },
    { category: "Constitutional Principles", title: "Capital serves objectives", description: "Capital exists to serve objectives, not the reverse. Diversification is the primary defence against uncertainty. Constitutional compliance beats short-term performance." },
    { category: "Strategic Allocation", title: "Four-fund universe", description: "VWRA 50% (44–56%, cap 62%) · QQQM 25% (20–30%, cap 30%) · SMH 15% (11–19%, cap 20%) · A35 10% (7–13%, floor 7%). Drift rules redirect new money; outer limits trigger mandatory action." },
    { category: "Strategic Allocation", title: "SMH hard cap — the only mandatory sell", description: "If SMH exceeds 20% of the portfolio, sell back to the 15% target at the next window. The single forced sell in the system." },
    { category: "Strategic Allocation", title: "Combined QQQM + SMH ceiling", description: "Warning at 40% (stop adding to both, redirect to VWRA). Hard limit at 45% (halt both). Resume normal contributions once combined falls below 42%. This is the binding tech-concentration constraint." },
    { category: "Strategic Allocation", title: "Total equity maximum 92%", description: "VWRA + QQQM + SMH shall not exceed 92% of the portfolio (target 90%, 2% drift buffer). Above 92% → redirect contributions to A35 until back below 90%." },
    { category: "Rebalancing", title: "Contribution-based rebalancing is default", description: "Selling to rebalance is permitted only in four cases: SMH >20%, Phase III de-risking, property acquisition (exit sequence), or a ratified amendment. Otherwise, you do not sell." },
    { category: "Behavioural Constitution", title: "72-hour rule", description: "Any action not already mandated by a written Article waits 72 hours. Record it in the Decision Journal — the reason, the Article it relies on, the risk it creates. Most impulses do not survive three days." },
    { category: "Behavioural Constitution", title: "No panic selling; drawdowns are for buying", description: "A falling portfolio is a buying opportunity for new contributions. Loss aversion, recency bias, FOMO, and action bias are governed by the Decision Engine, not by discretion." },
    { category: "Behavioural Constitution", title: "Forecasts are never decision triggers", description: "No trade is ever justified by a market prediction. The Constitution governs what the Portfolio Manager does instead of predicting." },
    { category: "Contribution Framework", title: "Monthly contribution discipline", description: "SGD 2,000 on the 15th, regardless of highs, lows, recessions, or headlines. A missed contribution resumes normally next window — never double up or increase risk to catch up." },
    { category: "Phase Framework", title: "Target-triggered de-risking", description: "Operating mode shifts by portfolio value vs the SGD 120,000 target, not the calendar: Phase I <72k, II 72–101k, III 102–113k, IV >114k. If value falls back a phase, revert to that phase's rules immediately." },
    { category: "Trade Execution", title: "Dealing window & constitutional authority", description: "Trades execute between the 3rd business day after the 15th and month-end. Every trade cites its Article. Exception: an SMH cap breach is acted on the first business day after noticing it." },
    { category: "Hidden Exposure", title: "Look-through concentration limits", description: "Any single company ≤10%, Technology (IT + Communication Services, per GICS) ≤45%, semiconductors ≤20%, US total ≤75%, USD-denominated ≤85%. Reviewed quarterly from Vanguard/Invesco/VanEck factsheets." },
    { category: "Amendment Process", title: "Amendments are rare and reflective", description: "Only permitted triggers (objective, personal circumstances, law/tax, scale >SGD 500k, superior evidence) justify change. A 7-day reflection period applies. No amendments during market stress." },
  ],
  scorecard: [
    { category: "Governance compliance", weight: 25, assessed: "Decision Engine followed exactly; no unauthorised trades; constitutional authority cited." },
    { category: "Risk management",       weight: 20, assessed: "SMH below 20%; combined ceiling below 45%; no unresolved breaches." },
    { category: "Allocation discipline", weight: 15, assessed: "Positions within comfortable ranges, or correct phase response active." },
    { category: "Contribution discipline", weight: 15, assessed: "Monthly contribution made; no undocumented misses." },
    { category: "Behavioural discipline", weight: 10, assessed: "No trades outside the Decision Engine; 72-hour rule applied; Decision Journal maintained." },
    { category: "Liquidity & currency",  weight: 10, assessed: "A35 above 7%; emergency fund maintained; USD exposure within limits." },
    { category: "Documentation",         weight: 5,  assessed: "Trade log current; Command Centre completed; exception register updated." },
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
