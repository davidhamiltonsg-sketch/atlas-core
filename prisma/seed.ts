import { PrismaClient } from "@prisma/client"
import { PrismaLibSql } from "@prisma/adapter-libsql"
import bcrypt from "bcryptjs"
import "dotenv/config"

const url = process.env.DATABASE_URL
const authToken = process.env.DATABASE_AUTH_TOKEN || undefined
if (!url) throw new Error("DATABASE_URL is not set")
const adapter = new PrismaLibSql({ url, authToken })
const prisma = new PrismaClient({ adapter })

// v5.8 target allocations (Section 2 hard caps, Section 3.1 tolerance bands)
const holdings = [
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
    hardCapPct: 15,
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
]

const governanceRules = [
  // VT
  {
    title: "VT — Healthy Range 45–57%",
    description: "VT target 52%. Healthy range 45–57%. Soft drift below 45% or above 57% — redirect contributions. Hard drift below 40% or above 62% — rebalance review required.",
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
  // QQQM
  {
    title: "QQQM — Healthy Range 19–27%",
    description: "QQQM target 23%. Healthy range 19–27%. Soft drift below 19% or above 27%. Hard drift below 16% or above 31%.",
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
  // SMH
  {
    title: "SMH — Healthy Range 8–12%",
    description: "SMH target 10%. Healthy range 8–12%. Soft drift above 12% — halt accumulation. Hard drift above 15% — selectively trim.",
    category: "SMH Governance",
    active: true,
  },
  {
    title: "SMH — AI Infrastructure Tilt Identity Rule",
    description: "SMH is a targeted AI infrastructure tilt, not the portfolio foundation. Semiconductor concentration must never become the dominant portfolio risk factor. If underweight, resume controlled accumulation. If overweight, halt accumulation above 12%; selectively trim above 15%.",
    category: "SMH Governance",
    active: true,
  },
  // VWO
  {
    title: "VWO — Healthy Range 6–10%",
    description: "VWO target 8%. Healthy range 6–10%. Soft drift below 6% or above 10%. Hard drift below 4% or above 12%. If underweight, resume modest accumulation. If overweight, pause accumulation.",
    category: "VWO Governance",
    active: true,
  },
  // BTC
  {
    title: "BTC — Healthy Range 5–8%",
    description: "BTC target 7%. Healthy range 5–8%. Soft drift above 8%. Hard drift above 8% — trim toward 7% target. If underweight, optionally resume controlled accumulation.",
    category: "BTC Governance",
    active: true,
  },
  {
    title: "BTC — Optionality Overlay Identity Rule",
    description: "BTC is asymmetric optionality — not defensive capital, not retirement infrastructure, not a portfolio foundation. BTC should remain financially meaningful but psychologically unimportant. It must never become the largest or second-largest holding.",
    category: "BTC Governance",
    active: true,
  },
  // Overlap & Concentration
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
  // Rebalancing
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
  // Behavioural Guards
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
  // Compliance
  {
    title: "Manual Execution Only",
    description: "Manual execution, automated governance. All trades require manual execution within approved dealing windows and employer pre-approval where required by firm policy.",
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

async function main() {
  console.log("Seeding Atlas Core v5.2...")

  // Clear all data
  await prisma.snapshot.deleteMany()
  await prisma.dividend.deleteMany()
  await prisma.holding.deleteMany()
  await prisma.trade.deleteMany()
  await prisma.contributionRecord.deleteMany()
  await prisma.watchlistItem.deleteMany()
  await prisma.governanceRule.deleteMany()
  await prisma.behaviourLog.deleteMany()
  await prisma.passwordResetToken.deleteMany()
  await prisma.user.deleteMany()

  // Create admin user
  const passwordHash = await bcrypt.hash("atlas2025", 12)
  const admin = await prisma.user.create({
    data: {
      email: "admin@atlas.local",
      name: "Portfolio Owner",
      passwordHash,
      role: "admin",
      monthlyContribution: 3000,
      annualLumpSum: 20000,
      contributionGrowthRate: 0.05,
    },
  })
  console.log(`  ✓ Admin user: admin@atlas.local`)

  // Create holdings for admin
  for (const h of holdings) {
    const holding = await prisma.holding.create({
      data: {
        userId: admin.id,
        ticker: h.ticker,
        name: h.name,
        targetPct: h.targetPct,
        hardCapPct: h.hardCapPct,
        toleranceBand: h.toleranceBand,
        color: h.color,
      },
    })
    await prisma.snapshot.create({
      data: {
        holdingId: holding.id,
        units: h.snapshot.units,
        price: h.snapshot.price,
        value: h.snapshot.value,
        currency: "USD",
        date: new Date(),
      },
    })
    console.log(`  ✓ ${h.ticker} — target ${h.targetPct}%`)
  }

  for (const rule of governanceRules) {
    await prisma.governanceRule.create({ data: rule })
  }
  console.log(`  ✓ ${governanceRules.length} governance rules`)
  console.log("Done.")
  console.log("")
  console.log("  Login: admin@atlas.local / atlas2025")
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })
