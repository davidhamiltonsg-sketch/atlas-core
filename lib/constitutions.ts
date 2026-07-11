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
    { category: "Art. I — Authority", title: "Constitution governs; app implements", description: "The Atlas Core Constitution is the governing instrument (current version tracked in the app). The app implements these rules mechanically but does not define or amend them. If the app and the written constitution disagree on a threshold, rule, or decision, the written constitution controls. Constitutional amendments require a committee minute, a 90-day moratorium, and a version increment. The constitution version number shown in the app is the implementation version — it tracks the constitution version but is not a substitute for the written document." },
    { category: "Art. XI — Shock Buffer", title: "SGOV yield — illustrative; update annually", description: "The 8% SGOV floor (Art. XI) is funded at approximately 3.5–4.0% annualised yield (illustrative — verify annually; last checked Jun 2026). The forgone expected growth from holding this buffer rather than deploying into full equity is approximately 0.4–0.5% CAGR — the insurance cost of guarding against sequence-of-returns risk near the portfolio's largest draw-down windows. Update the yield figure in lib/constants.ts (SGOV_YIELD) if rates have moved more than 1% since the last recorded date." },
    { category: "Art. XI — Shock Buffer", title: "Buffer deployment trigger — 12% ceiling", description: "If SGOV exceeds 12% of the portfolio at any dealing window, deploy half the excess above 8% into VWRA in that same window. Example: SGOV at 14% → deploy 3% into VWRA, bringing SGOV from 14% to 11%. This prevents the shock buffer from becoming a chronic performance drag (the expected cost of excess buffer is roughly 0.4–0.5% CAGR per excess percentage point held). The 8% floor is never violated; only the excess above 12% triggers deployment. Do not sell other positions to build SGOV — grow it only from new money and fund distributions." },
    { category: "Art. IX — Look-Through", title: "Minimum viable monthly look-through check", description: "The full look-through computation (run via the Look-Through page) takes 10–15 minutes quarterly. For the monthly quick-check, use this shortcut: look up the top-3 holdings of each of EQQQ, SEMI, and VWRA in your broker's fund overview. If none of those names appear in more than one fund's top-3 simultaneously, single-company concentration is almost certainly fine. Run the full computation once per quarter regardless — the shortcut detects obvious drift; the full run catches accumulated overlap. If you have not run the full look-through in more than 90 days, the Freshness dimension of the governance score will degrade." },
    { category: "Art. XVIII — Sell Criteria", title: "Broken-thesis proxies — observable triggers", description: "Each position has a thesis. These proxies signal when the thesis may be broken: EQQQ (NASDAQ-100 exposure) — watch if NASDAQ-100 companies' aggregate earnings as a share of global-ex-US tech revenue falls below 25% for two consecutive fiscal years (US mega-cap dominance thesis eroding). SEMI (semiconductor exposure) — watch if global semiconductor capital expenditure contracts for three consecutive quarters without a corresponding price increase (capex cycle thesis inverting). BTC — the thesis breaks if a consensus-critical protocol vulnerability is successfully exploited at scale — not a price drawdown or regulatory news, but an actual protocol failure. VWRA/VFEA — these are structural diversifiers, not theses; they are never sold for thesis reasons, only for rebalancing. If a proxy crosses its threshold, apply the 72-hour rule (Art. XIV) before taking any action. Price action alone is never sufficient." },
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
  combined: { tickers: [...SBR_SPEC.combined.tickers], warning: SBR_SPEC.combined.warning, hard: SBR_SPEC.combined.hard, resume: SBR_SPEC.combined.resume, label: "Combined EQQQ + SEMI ceiling" },
  totalEquityMaxPct: SBR_SPEC.totalEquityMaxPct,
  drawdownTriggerPct: SBR_SPEC.drawdownTriggerPct,
  skipAtHighPct: SBR_SPEC.skipAtHighPct,
  phases: SBR_PHASES,
  decisionLadder: [
    { n: 1, title: "Is SEMI over its phase cap?", detail: "→ Phase I (below S$72k): cap is 20%. Phase II: 18%. Phase III: 16%. Phase IV: 14%. If SEMI is over the cap for your current phase, you must sell enough to bring it back to 15%. This is the only time in the whole system you are required to sell. Do it in the current month's buying window." },
    { n: 2, title: "Are EQQQ and SEMI together over the phase ceiling?", detail: "→ Phase I: hard ceiling 45% (warning 40%). Phase II: 42% (warning 38%). Phase III: 38% (warning 35%). Phase IV: 33% (warning 30%). If combined is over the hard ceiling, stop buying both and put all new money into VWRA until they drop below the phase resume level. If in the warning band, skip both this month only." },
    { n: 3, title: "Is A35 below 7%?", detail: "→ Put all new money into A35 until it is back above 8%. The safety buffer comes first." },
    { n: 4, title: "Is the portfolio in Phase III or IV (close to the goal)?", detail: "→ Follow the phase rules. Phase III has two sub-stages: (a) S$96k–102k — redirect all contributions to A35; no equity sells yet (the quarterly sell gate hasn't opened). (b) S$102k–114k — redirect contributions to A35 and once each quarter also sell a little EQQQ (about 3% of portfolio) and VWRA (about 2%), moving the proceeds to A35. Phase IV (above S$114k): stop buying stocks entirely — all new money goes to A35." },
    { n: 5, title: "Is the portfolio down more than 15% from its recent high?", detail: "→ Put the full monthly amount into VWRA only. Don't sell anything. A dip is a buying opportunity, not a reason to panic. Important: if the portfolio is already in Phase III or IV, the phase rules (Step 4) take precedence — continue moving money to A35 rather than switching to VWRA." },
    { n: 6, title: "Is any fund below its target range?", detail: "→ Put the full monthly amount into whichever fund is furthest below its range — even if it is near its yearly high. Getting a fund back into range beats waiting for a better price (this is why it comes before the skip-the-highs step). Don't split it." },
    { n: 7, title: "Is EQQQ or SEMI already in range but near its highest price in the last year (within 3%)?", detail: "→ Skip buying that fund this month and put the money into VWRA instead. This only applies once every fund is already inside its range (Step 6 catches any fund below its range first — filling a depleted fund always beats skipping a near-high one). On a 3–5 year property timeline, a near-high entry followed by a 20–30% pullback would set your arrival date back by months — a cost that is negligible over a 19-year horizon (like Atlas Core) but material here. That time-horizon asymmetry is why this rule exists." },
    { n: 8, title: "None of the above — everything is fine.", detail: "→ Split the monthly contribution normally: VWRA 50% · EQQQ 25% · SEMI 15% · A35 10%." },
  ],
  rules: [
    { category: "The Ground Rules", title: "Rules beat gut feelings", description: "Having a clear system is more valuable than trying to predict markets. When two rules conflict, the safer one wins. Markets will go up and down — the plan stays the same." },
    { category: "The Ground Rules", title: "Your money has a job", description: "This money exists to buy a home, not to chase the highest return. Spreading across multiple funds protects you when one goes down. Following the rules matters more than any single year's performance." },
    { category: "How to Split Your Money", title: "Four funds plus a small cash reserve", description: "VWRA 50% · EQQQ 25% · SEMI 15% · A35 10% of your invested money, plus a small cash reserve of about 2% kept as spare cash. Each fund has a comfortable range and a hard limit. New money is directed wherever the plan needs it; hard limits trigger mandatory action. The fund line-up is closed — new products still need a rule change." },
    { category: "How to Split Your Money", title: "The one time you MUST sell", description: "If SEMI goes above its phase cap, sell enough to bring it back to 15%. The cap tightens as you near the goal to reduce sequencing risk: Phase I (below S$72k): 20%; Phase II: 18%; Phase III: 16%; Phase IV: 14%. This is the only forced sale in the whole system." },
    { category: "How to Split Your Money", title: "Tech stocks cap — tightens by phase", description: "EQQQ and SEMI together can't go above the phase hard ceiling (Phase I: 45%, Phase II: 42%, Phase III: 38%, Phase IV: 33%). A warning band fires a phase earlier (Phase I: 40%, Phase II: 38%, Phase III: 35%, Phase IV: 30%) — at that point, stop adding to both and redirect to VWRA. If they hit the hard ceiling, halt both funds until they drop below the phase resume level. The ceilings tighten as you approach the goal because concentrated tech + semis is the wrong risk to carry when you're close to buying." },
    { category: "How to Split Your Money", title: "Target recalibration — quarterly review with threshold scaling", description: "The S$120,000 target assumes a standard down-payment scenario. If your actual property budget, CPF OA balance, or loan terms change materially, recalibrate the target. When the target changes, the phase thresholds scale proportionally: Phase I/II boundary = 60% of target; Phase II/III = 80%; Phase III/IV = 95%. Example: if the target moves to S$100,000, the boundaries become S$60k / S$80k / S$95k. Review this at the start of every quarter (January, April, July, October) — log the review as a committee minute even if no change is made. No target changes during a market drawdown of more than 15%." },
    { category: "How to Split Your Money", title: "Stock market maximum — 92%", description: "VWRA, EQQQ and SEMI together should stay at or below 90% of the portfolio. If they push above 92%, redirect contributions to A35 until they come back down." },
    { category: "Keeping Things in Balance", title: "Buy to rebalance — don't sell", description: "When something is out of balance, fix it by buying more of what's too small — not by selling what's too big. You only sell in five situations: SEMI over 20%, a hidden-exposure limit still breached after ~3 months of redirecting contributions, Phase III de-risking, buying the property, or an approved rule change." },
    { category: "Staying Disciplined", title: "The 72-hour rule", description: "Any idea that isn't already in the plan must wait 72 hours before you act on it. Write it down first — what you want to do, why, and what could go wrong. Most ideas don't survive three days of thought." },
    { category: "Staying Disciplined", title: "A market drop is a buying opportunity", description: "When prices fall, keep investing the same amount. Don't panic, don't sell, don't stop. If the portfolio is more than 15% below its recent high, first deploy your small cash reserve into VWRA, then keep contributing. Markets have always recovered. Selling when things are down locks in a loss permanently." },
    { category: "Staying Disciplined", title: "Keep a small cash reserve (spare cash set aside)", description: "Hold about 2% of the portfolio as a cash reserve — spare cash set aside, not invested in any fund. Build it up a little at a time from your monthly contributions when everything is calm and on target. Its only job is to be deployed into VWRA when the market drops more than 15%. Never sell a fund to build it, and never spend it on anything else. For now you track this reserve yourself — the dashboard doesn't manage it automatically." },
    { category: "Staying Disciplined", title: "Hold for at least 30 days", description: "Once you buy a fund, hold it for at least 30 days before selling it. This does not apply to the required moves — the SEMI-over-20% sell, the Phase III/IV de-risking, or the final sell-down to buy the property. It just stops you from churning in and out on a whim." },
    { category: "Staying Disciplined", title: "Never trade based on a prediction", description: "No buy or sell is ever justified by 'I think the market will go up/down.' The rules tell you what to do. Predictions are noise." },
    { category: "Regular Investing", title: "Invest every month, no matter what", description: "At least S$1,000 on the 15th of every month, regardless of whether markets are up, down, or sideways. If you miss a month, resume normally next month — never double up to catch up." },
    { category: "The Journey Phases", title: "Get safer as you get closer to your goal", description: "The plan changes based on how much you have saved, not the date on the calendar. Phase I (below S$72k): full growth. Phase II (S$72–96k): controlled growth. Phase III (S$96–114k): start moving to safety. Phase IV (above S$114k): stop buying stocks. If the portfolio drops back a phase, return to that phase's rules." },
    { category: "When to Buy", title: "Buy in the second half of each month", description: "Make purchases between the 3rd business day after the 15th and the end of the month. If SEMI breaks its 20% cap, act on the first business day after you notice it." },
    { category: "When to Buy", title: "FX policy — convert de-risk proceeds to SGD immediately", description: "Any sale made as part of Phase III/IV de-risking must be converted from USD to SGD in the same dealing window. Do not leave de-risk proceeds sitting in USD. No currency hedging instruments are permitted. The goal is a SGD home deposit, so SGD cash in hand is the measure of progress." },
    { category: "What You Actually Own Inside the Funds", title: "Hidden exposure limits", description: "Your funds overlap — you can accidentally own too much of one company or sector. Limits: no single company above 10%, technology sector above 45%, semiconductors above 20%, US market above 75%, US dollar-denominated assets above 85%. Review these quarterly using the latest month-end fund holdings file from the fund provider (Vanguard for VWRA, Invesco for EQQQ, VanEck for SEMI). If two sources disagree on a company's weight, use the more conservative (higher) figure. Holdings data must be no older than 90 days at the time of review — if the provider hasn't updated within that window, treat the last known figure as current and flag it in the Decision Journal." },
    { category: "Changing the Rules", title: "Changing the rules is hard by design", description: "Only five things justify changing the plan: the property goal changes, your personal situation changes significantly, tax law changes, the portfolio grows above S$500k, or there is strong new evidence the current approach is wrong. You must wait 7 days before making any change. No changes during market downturns." },
    { category: "Exceptional Market Events", title: "When markets fall hard — Exceptional Market Event (EME) protocol", description: "An Exceptional Market Event is declared when either: (a) a broad global index falls 30% or more from its recent peak, or (b) technology or semiconductor indices fall 40% or more. During an EME: (1) the monthly contribution still follows the Decision Engine — VWRA drawdown step fires anyway; (2) no discretionary sells are permitted (the mandatory SEMI-over-cap sell may still apply); (3) before executing any non-mandatory sell, a committee minute must be filed (use the form in the app). The circuit breaker exists because panicked selling in a crash locks in losses permanently. The plan assumes that if both David and Dami must agree in writing, most panic sells don't happen. After the EME resolves (market recovers above the trigger), resume normal rules." },
    { category: "Changing the Rules", title: "Solo-operability covenant", description: "This plan is written so Dami can run the monthly ritual alone in under 5 minutes using only the dashboard. David reviews governance registers and exception logs quarterly. If David is unavailable for 90 days or more, Dami continues the monthly ritual unchanged — she has full authority to follow the Decision Engine without David's sign-off. A formal handoff checklist lives in the Document Centre." },
    { category: "Changing the Rules", title: "What happens if you don't reach S$120k in time", description: "The plan does not guarantee S$120k — it maximises the probability of getting there. Three scenarios to consider now, before you need them: WEAK (market down 25–35% the year before purchase, portfolio S$80–95k): use what you have plus CPF OA (illustrative: S$40–70k for a 30-35 year old), choose a property where HDB loan works (20% down, minimum 5% cash + CPF), or pick a lower-priced property in the S$450–500k range. A one-year delay lets the portfolio recover and contributions continue. BASE (on track, portfolio S$120k): comfortable for most BTO scenarios; HDB or bank loan both workable on properties up to S$600k; combined portfolio + CPF OA gives S$160–190k of purchasing power (illustrative). STRONG (portfolio S$140k+): consider retaining some A35 as an emergency buffer post-purchase rather than liquidating everything; the surplus reduces first-year cash-flow stress. For all scenarios, verify CPF OA rules and HDB eligibility with a licensed adviser — the numbers above are illustrative and based on 2026 policy; limits change. Write your contingency plan now." },
  ],
  scorecard: [
    { category: "Governance compliance", weight: 25, assessed: "Followed the monthly decision steps exactly; no trades outside the plan; can explain which rule triggered the trade." },
    { category: "Risk management",       weight: 20, assessed: "SEMI below 20%; EQQQ+SEMI combined below 45%; no unresolved limit breaches." },
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
