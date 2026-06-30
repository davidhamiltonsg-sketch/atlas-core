// ─────────────────────────────────────────────────────────────────────────────
// Atlas Core — Canonical seed/governance data (v6.7)
//
// SINGLE SOURCE OF TRUTH for the seeded holdings and the governance rule register.
// Imported by BOTH prisma/seed.ts (fresh installs) and prisma/update-governance-v6_7.ts
// (live-DB sync) so the two can never drift apart again.
//
// Numbers here mirror the Governance Document v6.7 (§1 composition, §2 caps,
// §3 drift bands, §4 look-through, §6B vehicle transitions, §11 rule register).
// The document is the source of truth for governance numbers; keep this file in lock-step.
// ─────────────────────────────────────────────────────────────────────────────

export interface SeedHolding {
  ticker: string
  name: string
  targetPct: number
  hardCapPct: number | null
  toleranceBand: number
  color: string
  snapshot: { units: number; price: number; value: number }
}

export interface SeedRule {
  title: string
  description: string
  category: string
  active: boolean
}

// §1 composition / §2 caps / §3 drift bands. The 5 core positions sum to 100% of the
// target weights; SGOV is the buffer (built from contributions, not target-weighted) and
// is added separately by the migrations that introduced it.
export const HOLDINGS_SEED: SeedHolding[] = [
  {
    ticker: "VT",
    name: "Vanguard Total World Stock ETF",
    targetPct: 52,
    hardCapPct: 60,
    toleranceBand: 6,
    color: "#6366f1",
    snapshot: { units: 428, price: 155.52, value: 85209.84 },
  },
  {
    ticker: "QQQM",
    name: "Invesco NASDAQ 100 ETF",
    targetPct: 23,
    hardCapPct: 30,
    toleranceBand: 5,
    color: "#8b5cf6",
    snapshot: { units: 63, price: 295.02, value: 23792.85 },
  },
  {
    ticker: "SMH",
    name: "VanEck Semiconductor ETF",
    targetPct: 10,
    hardCapPct: 12, // §2 — cap tightened 15% → 12% (v6.x)
    toleranceBand: 3,
    color: "#a78bfa",
    snapshot: { units: 24, price: 573.79, value: 17628.63 },
  },
  {
    ticker: "VWO",
    name: "Vanguard FTSE Emerging Markets ETF",
    targetPct: 8,
    hardCapPct: 13,
    toleranceBand: 3,
    color: "#c4b5fd",
    snapshot: { units: 109, price: 58.94, value: 8223.72 },
  },
  {
    ticker: "BTC",
    name: "Grayscale Bitcoin Mini ETF",
    targetPct: 7,
    hardCapPct: 8,
    toleranceBand: 1,
    color: "#f59e0b",
    snapshot: { units: 154, price: 33.58, value: 6620.85 },
  },
  {
    // Bitcoin sleeve (target vehicle). BTC is transitioned into IBIT like-for-like; the
    // engine governs BTC + IBIT as ONE sleeve (combined target 7%, combined 8% cycle cap).
    // Seeded at 0% target — the split shifts from BTC to IBIT as the transition proceeds.
    ticker: "IBIT",
    name: "iShares Bitcoin Trust ETF",
    targetPct: 0,
    hardCapPct: 8,
    toleranceBand: 1,
    color: "#f59e0b",
    snapshot: { units: 0, price: 0, value: 0 },
  },
]

// §11 — the 40-rule register (10 categories). Mirrors GOVERNANCE-v6.7.
export const GOVERNANCE_RULES: SeedRule[] = [
  // VT Governance · 4
  {
    title: "VT — Healthy Range 46–58%",
    description: "VT target 52%. Healthy range 46–58%. Soft drift below 46% or above 58% — redirect contributions. Hard drift below 42% or above 62% — rebalance review required.",
    category: "VT Governance",
    active: true,
  },
  {
    title: "VT — Diversification Anchor",
    description: "VT is the diversification anchor, behavioural stabiliser, and anti-fragility layer. It provides broad global ownership and prevents excessive thematic concentration, US-only dependency, and emotional portfolio fragility.",
    category: "VT Governance",
    active: true,
  },
  {
    title: "VT Underweight Response",
    description: "Portfolio is becoming excessively thematic, concentrated, or behaviourally fragile. Redirect all contributions toward VT until restored to healthy range.",
    category: "VT Governance",
    active: true,
  },
  {
    title: "VT Overweight Response",
    description: "Portfolio is becoming excessively defensive and diluted from its intended growth profile. Redirect contributions toward QQQM to restore balance.",
    category: "VT Governance",
    active: true,
  },
  // QQQM Governance · 4
  {
    title: "QQQM — Healthy Range 18–28%",
    description: "QQQM target 23%. Healthy range 18–28%. Soft drift below 18% or above 28%. Hard drift below 15% or above 31%.",
    category: "QQQM Governance",
    active: true,
  },
  {
    title: "QQQM — Digital Economy Engine",
    description: "QQQM is the portfolio's dominant long-term growth engine — software systems, cloud infrastructure, hyperscaler ecosystems, platform economies, AI monetisation, and enterprise digitisation.",
    category: "QQQM Governance",
    active: true,
  },
  {
    title: "QQQM Underweight Response",
    description: "Portfolio is becoming underexposed to digital expansion and insufficiently growth-oriented. Increase contributions to QQQM.",
    category: "QQQM Governance",
    active: true,
  },
  {
    title: "QQQM Overweight Response",
    description: "Portfolio is becoming excessively dependent on US mega-cap technology and more valuation-sensitive. Pause incremental QQQM accumulation.",
    category: "QQQM Governance",
    active: true,
  },
  // SMH Governance · 2
  {
    title: "SMH — Healthy Range 7–12%",
    description: "SMH target 10%. Healthy range 7–12%. Soft drift above 12% — halt accumulation. Hard cap 12% — selectively trim back to target.",
    category: "SMH Governance",
    active: true,
  },
  {
    title: "SMH — AI Infrastructure Tilt Identity Rule",
    description: "SMH is a targeted AI infrastructure tilt, not the portfolio foundation. Semiconductor concentration must never become the dominant portfolio risk factor. If underweight, resume controlled accumulation. If overweight, halt accumulation above 12%; selectively trim back to the 10% target once over the 12% hard cap.",
    category: "SMH Governance",
    active: true,
  },
  // VWO Governance · 3
  {
    title: "VWO — Identity & Thesis",
    description: "Geographic Diversifier. VWO's job is long-run exposure to the demographic and productivity convergence story across emerging markets — principally EM Asia (China, India, Taiwan, South Korea). It is not a tactical trade on any single country or commodity cycle. It reduces structural US-and-Europe dependency and adds a second long-run growth engine with low correlation to QQQM/SMH in non-risk-on environments. Broken-thesis criteria: thesis breaks only if EM equity markets structurally de-couple from global growth for 5+ years AND the demographic convergence thesis is falsified by sustained productivity stagnation across EM Asia broadly. Capital controls in a single major EM economy do not break the thesis.",
    category: "VWO Governance",
    active: true,
  },
  {
    title: "VWO — Healthy Range 5–11%",
    description: "VWO target 8%. Healthy range 5–11%. Soft drift below 5% or above 11%. Hard drift below 3% or above 13%. If underweight, resume modest accumulation. If overweight, pause accumulation.",
    category: "VWO Governance",
    active: true,
  },
  {
    title: "VWO — Response Rules",
    description: "Underweight (below 5%): redirect a portion of monthly contributions to VWO until restored to the healthy band. Overweight (above 11%): pause VWO contributions and redirect to VT or QQQM. Hard breach (above 13%): assess a selective trim at the next dealing window.",
    category: "VWO Governance",
    active: true,
  },
  // BTC Governance · 2
  {
    title: "BTC — Healthy Range 6–8%",
    description: "BTC target 7%. Healthy range 6–8%. Soft drift below 6%. Hard drift above 8% (cycle-aware per §4.1) — trim toward 7% target. If underweight, accumulate on weakness toward target — never sold for a paper loss.",
    category: "BTC Governance",
    active: true,
  },
  {
    title: "BTC — Optionality Overlay Identity Rule",
    description: "BTC is asymmetric optionality — not defensive capital, not retirement infrastructure, not a portfolio foundation. BTC should remain financially meaningful but psychologically unimportant. It must never become the largest or second-largest holding.",
    category: "BTC Governance",
    active: true,
  },
  // Vehicle Transitions (§6B) · 3
  {
    title: "Transition Qualifying Criteria",
    description: "A vehicle switch is an approved governance action (not a discretionary D1 change) only if all three hold: (1) the new ETF tracks the same underlying exposure, verified by prospectus; (2) it is a genuine structural improvement — lower fee, better domicile (e.g. Irish UCITS), liquidity, or regulatory status — documented at the decision; (3) no net exposure change: proceeds go straight into the new vehicle.",
    category: "Vehicle Transitions",
    active: true,
  },
  {
    title: "Transition Execution Rules",
    description: "The 90-day hold applies to the position, not the instrument. Execute at the next dealing window. Sell the old vehicle, buy the new one the same or next business day. No partial transitions without a completion plan. Log: old vehicle, new vehicle, units, structural reason, and confirmation the three criteria were met.",
    category: "Vehicle Transitions",
    active: true,
  },
  {
    title: "Governance Continuity on Transition",
    description: "All drift bands, caps, thesis criteria, and behavioural rules transfer to the new vehicle automatically. Only the instrument name in §1 is updated — no other rule amendments are required.",
    category: "Vehicle Transitions",
    active: true,
  },
  // Overlap & Concentration (§4) · 11
  {
    title: "Semiconductor Dependency — Cap 16%/20%",
    description: "Total semiconductor exposure must remain below 16%. Elevated 16–20%: pause SMH accumulation. Excessive above 20%: halt SMH; redirect contributions to VT.",
    category: "Overlap & Concentration",
    active: true,
  },
  {
    title: "Digital Economy Dependency — Cap 48%/54%",
    description: "Combined digital economy exposure must remain below 48%. Elevated 48–54%: increase VT and VWO contributions. Excessive above 54%: halt QQQM and SMH accumulation.",
    category: "Overlap & Concentration",
    active: true,
  },
  {
    title: "US Market Dependency — Cap 70%/78%",
    description: "Total effective US exposure must remain below 70%. Elevated 70–78%: prioritise VT and VWO contributions. Excessive above 78%: pause all technology concentration increases.",
    category: "Overlap & Concentration",
    active: true,
  },
  {
    title: "AI Infrastructure Cluster — Cap 38%/46%",
    description: "Combined AI infrastructure exposure must remain below 38%. Elevated 38–46%: reduce SMH additions; favour VT. Excessive above 46%: halt SMH; reduce QQQM additions.",
    category: "Overlap & Concentration",
    active: true,
  },
  {
    title: "Nvidia Exposure Cap — Soft 10%, Hard 13%",
    description: "Effective Nvidia look-through exposure across VT, QQQM, and SMH: soft cap 10%, hard cap 13%. Soft breach: redirect contributions to VT and VWO. Hard breach: pause all SMH and QQQM accumulation; assess selective trim. Monitor quarterly.",
    category: "Overlap & Concentration",
    active: true,
  },
  {
    title: "Microsoft Exposure Cap — Soft 10%, Hard 13%",
    description: "Effective Microsoft look-through exposure across VT and QQQM: soft cap 10%, hard cap 13%. Soft breach: monitor and warn. Hard breach: pause QQQM accumulation; redirect to VT. Monitor quarterly.",
    category: "Overlap & Concentration",
    active: true,
  },
  {
    title: "Apple Exposure Cap — Soft 8%, Hard 11%",
    description: "Effective Apple look-through exposure: soft cap 8%, hard cap 11%. Soft breach: monitor. Hard breach: pause QQQM; redirect to VT or VWO.",
    category: "Overlap & Concentration",
    active: true,
  },
  {
    title: "Amazon Exposure Cap — Soft 7%, Hard 9%",
    description: "Effective Amazon look-through exposure: soft cap 7%, hard cap 9%. Soft breach: monitor. Hard breach: pause QQQM accumulation.",
    category: "Overlap & Concentration",
    active: true,
  },
  {
    title: "Meta & Alphabet Exposure Cap — Soft 6%, Hard 8%",
    description: "Effective Meta and Alphabet look-through exposure: soft cap 6% each, hard cap 8% each. Soft breach: monitor. Hard breach: redirect future QQQM contributions to VT.",
    category: "Overlap & Concentration",
    active: true,
  },
  {
    title: "Broadcom & TSMC Exposure Cap — Soft 5%, Hard 7%",
    description: "Effective Broadcom and TSMC look-through exposure: soft cap 5% each, hard cap 7% each. Soft breach: monitor. Hard breach: halt SMH accumulation.",
    category: "Overlap & Concentration",
    active: true,
  },
  {
    title: "Redundant ETF Prevention",
    description: "Permanently excluded: VGT, FTEC, XLK, SOXX, IGV, and similar overlapping technology ETFs. They increase concentration without diversification. This boundary is permanent and not subject to review.",
    category: "Overlap & Concentration",
    active: true,
  },
  // Rebalancing · 2
  {
    title: "Rebalancing Priority Order",
    description: "Strict response hierarchy — do not skip steps. Step 1: redirect future contributions toward underweight assets. Step 2: pause or halt accumulation in overweight assets. Step 3: selective trimming only when hard thresholds are breached. Step 4: avoid wholesale portfolio redesign under any conditions.",
    category: "Rebalancing",
    active: true,
  },
  {
    title: "Review and Rebalance Cadence",
    description: "Monthly glance: allocation and contribution check only. Quarterly strategic review: drift, overlap, concentration, and behavioural audit. Formal rebalance: annual in January unless hard thresholds are breached mid-year. Emergency review trigger: portfolio falls more than 25% or any hard cap is breached.",
    category: "Rebalancing",
    active: true,
  },
  // Behavioural Guards · 5
  {
    title: "Market Timing Ban",
    description: "No tactical allocation shifts based on headlines, elections, macro predictions, or short-term underperformance. Market timing is a permanently prohibited action.",
    category: "Behavioural Guards",
    active: true,
  },
  {
    title: "Panic Selling Prohibition",
    description: "No sells during drawdowns without a 48-hour cooling-off period and a rule-based justification. Portfolio falls above 25% should increase contributions, not trigger exits. Drawdown responses are pre-defined and not subject to discretionary override.",
    category: "Behavioural Guards",
    active: true,
  },
  {
    title: "Redesign Moratorium",
    description: "No structural portfolio changes within 90 days of the last structural change. Boredom is not an investment thesis. The portfolio must not be redesigned more than once every three years without a structurally justified reason.",
    category: "Behavioural Guards",
    active: true,
  },
  {
    title: "Approved Reasons for Strategy Changes",
    description: "Allowed: major life changes, retirement horizon changes, liquidity requirements, risk tolerance changes, income changes above 15%. NOT allowed: headlines, elections, boredom, social media, temporary underperformance, or optimisation addiction.",
    category: "Behavioural Guards",
    active: true,
  },
  {
    title: "Market Crash Protocol",
    description: "Drawdown >10%: normal; continue contributions. Drawdown >15%: discourage changes; reinforce thesis. Drawdown >25%: maintain schedule; check monthly only. Drawdown >40%: do not open portfolio more than monthly; do not sell. Large declines feel permanent while they are happening. Historically they have not been.",
    category: "Behavioural Guards",
    active: true,
  },
  // Compliance · 4
  {
    title: "Manual Execution Only",
    description: "Manual execution, automated governance. All trades require manual execution within approved dealing windows and employer pre-approval where required by firm policy.",
    category: "Compliance",
    active: true,
  },
  {
    title: "Dealing Window Definition",
    description: "The monthly dealing window opens on the 3rd business day after the 15th of each month (allowing the contribution to land) and closes on the last business day of that month. Outside this window, no trades — except a hard-cap breach (§2, §4), which is acted on the first available business day after the breach is confirmed, with a governance log entry recording the rule that triggered it.",
    category: "Compliance",
    active: true,
  },
  {
    title: "Monthly Execution Cadence",
    description: "Monthly workflow: (1) confirm dealing window and employer pre-approval, (2) review allocation vs target, (3) check look-through concentration, (4) generate drift-adjusted contribution plan, (5) execute manually and log each transaction with date, asset, amount, and price, (6) update portfolio intelligence log.",
    category: "Compliance",
    active: true,
  },
  {
    title: "Emergency Reserve Rule",
    description: "Maintain adequate emergency reserves outside the investment portfolio at all times. The portfolio must not become the emergency fund or short-term liquidity source. No withdrawals before 2045 except in documented extraordinary circumstances.",
    category: "Compliance",
    active: true,
  },
]
