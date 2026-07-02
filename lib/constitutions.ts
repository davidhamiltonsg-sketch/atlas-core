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
  name: "Atlas Core — Investment Constitution",
  shortName: "Atlas Core",
  version: "1.5",
  updated: "2026-07",
  motto: "Disciplina Supra Praedictio",
  objective: "A long-term retirement portfolio targeting 2045. Its job is to grow wealth by following a fixed set of rules instead of feelings, headlines, or random ideas. Not for trading or gambling — for staying invested until 2045 and letting compounding do the work.",
  targetValue: null,
  currency: "USD",
  monthlyContribution: 3000,
  broker: "IBKR Singapore",
  docPath: "/atlas-core-constitution.html",
  funds: [
    { ticker: "VT",   name: "Vanguard Total World Stock ETF",      role: "The big foundation — owns stocks from all over the world",                           target: 52, rangeLow: 46, rangeHigh: 58, hardCap: 60, color: "#6366f1" },
    { ticker: "QQQM", name: "Invesco NASDAQ-100 ETF",              role: "The growth engine — the 100 biggest US tech companies",                             target: 23, rangeLow: 18, rangeHigh: 28, hardCap: 30, color: "#8b5cf6" },
    { ticker: "SMH",  name: "VanEck Semiconductor ETF",            role: "The chip bet — semiconductor companies tied to AI and computing",                    target: 10, rangeLow: 7,  rangeHigh: 12, hardCap: 12, color: "#a78bfa" },
    { ticker: "VWO",  name: "Vanguard FTSE Emerging Markets ETF",  role: "The geography balancer — extra exposure to emerging market economies",              target: 8,  rangeLow: 5,  rangeHigh: 11, hardCap: 13, color: "#c4b5fd" },
    { ticker: "BTC",  name: "iShares Bitcoin Trust ETF (IBIT)",    role: "The wild card — high upside, but kept deliberately small to limit the damage if it falls", target: 7, rangeLow: 6, rangeHigh: 8, hardCap: 8, color: "#f59e0b" },
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
  version: "2.2",
  updated: "2026-07",
  motto: "Discipline Over Prediction",
  objective: "Save and grow your money toward a home deposit of S$120,000. The timeline is flexible — but being ready when the right property appears is not.",
  targetValue: 120000,
  currency: "SGD",
  monthlyContribution: 2000,
  broker: "IBKR Singapore",
  docPath: "/silicon-brick-road.html",
  funds: [
    { ticker: "VWRA", name: "Vanguard FTSE All-World UCITS ETF", role: "Stable global core — always accumulate",        target: 50, rangeLow: 44, rangeHigh: 56, hardCap: 62, color: "#2dd4bf" },
    { ticker: "QQQM", name: "Invesco NASDAQ-100 ETF",            role: "Growth tilt — US large-cap tech",              target: 25, rangeLow: 20, rangeHigh: 30, hardCap: 30, color: "#60a5fa" },
    { ticker: "SMH",  name: "VanEck Semiconductor ETF",          role: "Growth tilt — semiconductors (most volatile)", target: 15, rangeLow: 11, rangeHigh: 19, hardCap: 20, color: "#a78bfa", note: "Only mandatory sell in the portfolio — trim to 15% if it exceeds 20%." },
    { ticker: "A35",  name: "ABF Singapore Bond Index Fund",     role: "SGD safety buffer — your insurance policy in local currency", target: 10, rangeLow: 7,  rangeHigh: 13, hardCap: null, floor: 7, color: "#34d399", note: "Below 7% → all contributions to A35. Upper range suspended in Phases III–IV." },
  ],
  combined: { tickers: ["QQQM", "SMH"], warning: 40, hard: 45, resume: 42, label: "Combined QQQM + SMH ceiling" },
  totalEquityMaxPct: 92,
  drawdownTriggerPct: 15,
  skipAtHighPct: 3,
  phases: [
    { key: "I",   label: "Phase I — Full growth",              range: "Below SGD 72,000",        min: 0,      max: 72000,  selling: false, body: "Standard allocation. All contributions at target weights per the Decision Engine. Maximum equity exposure — let the portfolio run.", targets: { VWRA: 50, QQQM: 25, SMH: 15, A35: 10 } },
    { key: "II",  label: "Phase II — Controlled growth",       range: "SGD 72,000–102,000",      min: 72000,  max: 102000, selling: false, body: "No selling. Redirect new contributions only toward safety. Existing holdings unchanged.", targets: { VWRA: 55, QQQM: 20, SMH: 10, A35: 15 } },
    { key: "III", label: "Phase III — Locking in gains", range: "SGD 102,000–114,000",   min: 102000, max: 114000, selling: true,  body: "Start gradually moving money to safety. Once per quarter (on your monthly window), sell a small slice of QQQM and VWRA and put the proceeds into A35. Goal: shift from 90% stocks to roughly 80% stocks. Don't touch SMH — it will be liquidated last when you buy the property.", targets: { VWRA: 45, QQQM: 20, SMH: 15, A35: 25 } },
    { key: "IV",  label: "Phase IV — Ready to buy",      range: "Above SGD 114,000",       min: 114000, max: null,   selling: false, body: "Stop buying stocks entirely. Every monthly contribution goes straight into A35. This builds up your SGD cash pile so you're ready to move when the right property comes up. Start planning the purchase — the money should be ready to exit within 60 days of deciding." },
  ],
  decisionLadder: [
    { n: 1, title: "Is SMH over 20% of the portfolio?", detail: "→ You must sell some SMH to bring it back to 15%. This is the only time in the whole system you are required to sell. Do it in the current month's buying window." },
    { n: 2, title: "Are QQQM and SMH together over 45%?", detail: "→ Stop buying both. Put all new money into VWRA until their combined share drops below 42%." },
    { n: 3, title: "Is A35 below 7%?", detail: "→ Put all new money into A35 until it is back above 8%. The safety buffer comes first." },
    { n: 4, title: "Is the portfolio in Phase III or IV (close to the goal)?", detail: "→ Follow the phase rules. Phase III: start selling a little QQQM and VWRA each quarter and move it to A35. Phase IV: stop buying stocks entirely — all new money goes to A35." },
    { n: 5, title: "Is the portfolio down more than 15% from its recent high?", detail: "→ Put the full monthly amount into VWRA only. Don't sell anything. A dip is a buying opportunity, not a reason to panic." },
    { n: 6, title: "Is any fund below its target range?", detail: "→ Put the full monthly amount into whichever fund is furthest below its range — even if it is near its yearly high. Getting a fund back into range beats waiting for a better price (this is why it comes before the skip-the-highs step). Don't split it." },
    { n: 7, title: "Is QQQM or SMH already in range but near its highest price in the last year (within 3%)?", detail: "→ Skip buying that fund this month and put the money into VWRA instead. This only applies once every fund is already inside its range." },
    { n: 8, title: "None of the above — everything is fine.", detail: "→ Split the monthly contribution normally: VWRA 50% · QQQM 25% · SMH 15% · A35 10%." },
  ],
  rules: [
    { category: "The Ground Rules", title: "Rules beat gut feelings", description: "Having a clear system is more valuable than trying to predict markets. When two rules conflict, the safer one wins. Markets will go up and down — the plan stays the same." },
    { category: "The Ground Rules", title: "Your money has a job", description: "This money exists to buy a home, not to chase the highest return. Spreading across multiple funds protects you when one goes down. Following the rules matters more than any single year's performance." },
    { category: "How to Split Your Money", title: "Four funds plus a small cash reserve", description: "VWRA 50% · QQQM 25% · SMH 15% · A35 10% of your invested money, plus a small cash reserve of about 2% kept as spare cash. Each fund has a comfortable range and a hard limit. New money is directed wherever the plan needs it; hard limits trigger mandatory action. The fund line-up is closed — new products still need a rule change." },
    { category: "How to Split Your Money", title: "The one time you MUST sell", description: "If SMH goes above 20% of the portfolio, sell enough to bring it back to 15%. This is the only forced sale in the whole system." },
    { category: "How to Split Your Money", title: "Tech stocks cap", description: "QQQM and SMH together can't go above 45%. Warning at 40% — stop adding to both and redirect to VWRA. If they hit 45%, halt both funds until they drop below 42%." },
    { category: "How to Split Your Money", title: "Stock market maximum — 92%", description: "VWRA, QQQM and SMH together should stay at or below 90% of the portfolio. If they push above 92%, redirect contributions to A35 until they come back down." },
    { category: "Keeping Things in Balance", title: "Buy to rebalance — don't sell", description: "When something is out of balance, fix it by buying more of what's too small — not by selling what's too big. You only sell in five situations: SMH over 20%, a hidden-exposure limit still breached after ~3 months of redirecting contributions, Phase III de-risking, buying the property, or an approved rule change." },
    { category: "Staying Disciplined", title: "The 72-hour rule", description: "Any idea that isn't already in the plan must wait 72 hours before you act on it. Write it down first — what you want to do, why, and what could go wrong. Most ideas don't survive three days of thought." },
    { category: "Staying Disciplined", title: "A market drop is a buying opportunity", description: "When prices fall, keep investing the same amount. Don't panic, don't sell, don't stop. If the portfolio is more than 15% below its recent high, first deploy your small cash reserve into VWRA, then keep contributing. Markets have always recovered. Selling when things are down locks in a loss permanently." },
    { category: "Staying Disciplined", title: "Keep a small cash reserve (spare cash set aside)", description: "Hold about 2% of the portfolio as a cash reserve — spare cash set aside, not invested in any fund. Build it up a little at a time from your monthly contributions when everything is calm and on target. Its only job is to be deployed into VWRA when the market drops more than 15%. Never sell a fund to build it, and never spend it on anything else. For now you track this reserve yourself — the dashboard doesn't manage it automatically." },
    { category: "Staying Disciplined", title: "Hold for at least 30 days", description: "Once you buy a fund, hold it for at least 30 days before selling it. This does not apply to the required moves — the SMH-over-20% sell, the Phase III/IV de-risking, or the final sell-down to buy the property. It just stops you from churning in and out on a whim." },
    { category: "Staying Disciplined", title: "Never trade based on a prediction", description: "No buy or sell is ever justified by 'I think the market will go up/down.' The rules tell you what to do. Predictions are noise." },
    { category: "Regular Investing", title: "Invest every month, no matter what", description: "S$2,000 on the 15th of every month, regardless of whether markets are up, down, or sideways. If you miss a month, resume normally next month — never double up to catch up." },
    { category: "The Journey Phases", title: "Get safer as you get closer to your goal", description: "The plan changes based on how much you have saved, not the date on the calendar. Phase I (below S$72k): full growth. Phase II (S$72–102k): controlled growth. Phase III (S$102–114k): start moving to safety. Phase IV (above S$114k): stop buying stocks. If the portfolio drops back a phase, return to that phase's rules." },
    { category: "When to Buy", title: "Buy in the second half of each month", description: "Make purchases between the 3rd business day after the 15th and the end of the month. If SMH breaks its 20% cap, act on the first business day after you notice it." },
    { category: "What You Actually Own Inside the Funds", title: "Hidden exposure limits", description: "Your funds overlap — you can accidentally own too much of one company or sector. Limits: no single company above 10%, technology sector above 45%, semiconductors above 20%, US market above 75%, US dollar-denominated assets above 85%. Review these quarterly." },
    { category: "Changing the Rules", title: "Changing the rules is hard by design", description: "Only five things justify changing the plan: the property goal changes, your personal situation changes significantly, tax law changes, the portfolio grows above S$500k, or there is strong new evidence the current approach is wrong. You must wait 7 days before making any change. No changes during market downturns." },
  ],
  scorecard: [
    { category: "Governance compliance", weight: 25, assessed: "Followed the monthly decision steps exactly; no trades outside the plan; can explain which rule triggered the trade." },
    { category: "Risk management",       weight: 20, assessed: "SMH below 20%; QQQM+SMH combined below 45%; no unresolved limit breaches." },
    { category: "Allocation discipline", weight: 15, assessed: "Positions within comfortable ranges, or correct phase response active." },
    { category: "Contribution discipline", weight: 15, assessed: "Monthly contribution made; no undocumented misses." },
    { category: "Behavioural discipline", weight: 10, assessed: "No trades outside the Decision Engine; 72-hour rule applied; Decision Journal maintained." },
    { category: "Liquidity and currency safety",  weight: 10, assessed: "A35 above 7%; emergency fund maintained; USD exposure within limits." },
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
