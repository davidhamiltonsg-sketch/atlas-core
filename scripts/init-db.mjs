/**
 * Idempotent DB initializer — runs on every startup.
 * Creates tables if they don't exist, seeds admin user only if no users exist.
 * Plain ESM — no tsx/ts-node needed in production.
 */
import Database from "better-sqlite3"
import { createHash, randomBytes } from "crypto"
import { existsSync, mkdirSync } from "fs"
import { dirname, isAbsolute, resolve } from "path"

// Resolve DB path from DATABASE_URL env var or default
function getDbPath() {
  const url = process.env.DATABASE_URL ?? "file:./prisma/atlas.db"
  if (url.startsWith("file:")) {
    const filePath = url.slice(5)
    return isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath)
  }
  return resolve(process.cwd(), "prisma/atlas.db")
}

// Simple bcrypt-compatible hash — we use bcryptjs at runtime, but here we
// call the real bcryptjs via dynamic import to hash the initial password.
async function hashPassword(password) {
  const { default: bcrypt } = await import("bcryptjs")
  return bcrypt.hash(password, 12)
}

// cuid-lite: generate a collision-resistant ID without external deps
function cuid() {
  const ts = Date.now().toString(36)
  const rand = randomBytes(8).toString("hex")
  return `c${ts}${rand}`
}

async function main() {
  const dbPath = getDbPath()
  const dir = dirname(dbPath)

  // Ensure the directory exists (Railway volume may need it)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    console.log(`[init-db] Created directory: ${dir}`)
  }

  const db = new Database(dbPath)
  db.pragma("journal_mode = WAL")
  db.pragma("foreign_keys = ON")

  // ── Create all tables (IF NOT EXISTS — safe to run every time) ────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS User (
      id           TEXT PRIMARY KEY,
      email        TEXT UNIQUE NOT NULL,
      name         TEXT NOT NULL,
      passwordHash TEXT NOT NULL,
      role         TEXT NOT NULL DEFAULT 'user',
      createdAt    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS Holding (
      id            TEXT PRIMARY KEY,
      userId        TEXT NOT NULL,
      ticker        TEXT NOT NULL,
      name          TEXT NOT NULL,
      targetPct     REAL NOT NULL,
      hardCapPct    REAL,
      toleranceBand REAL NOT NULL DEFAULT 2.5,
      color         TEXT NOT NULL DEFAULT '#6366f1',
      createdAt     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE,
      UNIQUE (userId, ticker)
    );

    CREATE TABLE IF NOT EXISTS Snapshot (
      id        TEXT PRIMARY KEY,
      holdingId TEXT NOT NULL,
      date      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      units     REAL NOT NULL,
      price     REAL NOT NULL,
      value     REAL NOT NULL,
      currency  TEXT NOT NULL DEFAULT 'USD',
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (holdingId) REFERENCES Holding(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS Contribution (
      id        TEXT PRIMARY KEY,
      date      DATETIME NOT NULL,
      amountGbp REAL NOT NULL,
      note      TEXT,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS GovernanceRule (
      id          TEXT PRIMARY KEY,
      title       TEXT NOT NULL,
      description TEXT NOT NULL,
      category    TEXT NOT NULL,
      active      INTEGER NOT NULL DEFAULT 1,
      createdAt   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS BehaviourLog (
      id        TEXT PRIMARY KEY,
      type      TEXT NOT NULL,
      note      TEXT NOT NULL,
      date      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS PasswordResetToken (
      id        TEXT PRIMARY KEY,
      userId    TEXT NOT NULL,
      token     TEXT UNIQUE NOT NULL,
      expiresAt DATETIME NOT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE
    );
  `)

  console.log("[init-db] Schema ready.")

  // ── Seed only if no users exist ───────────────────────────────────────────
  const userCount = db.prepare("SELECT COUNT(*) as c FROM User").get()
  if (userCount.c > 0) {
    console.log(`[init-db] ${userCount.c} user(s) found — skipping seed.`)
    db.close()
    return
  }

  console.log("[init-db] No users found — seeding initial data...")

  const adminEmail = process.env.ADMIN_EMAIL ?? "admin@atlas.local"
  const adminPassword = process.env.ADMIN_PASSWORD ?? "atlas2025"
  const adminName = process.env.ADMIN_NAME ?? "Portfolio Owner"

  const passwordHash = await hashPassword(adminPassword)
  const adminId = cuid()
  const now = new Date().toISOString()

  db.prepare(`
    INSERT INTO User (id, email, name, passwordHash, role, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, 'admin', ?, ?)
  `).run(adminId, adminEmail, adminName, passwordHash, now, now)

  // v5.2 holdings
  const holdings = [
    { ticker: "VWRA", name: "Vanguard FTSE All-World UCITS ETF",      targetPct: 52, hardCapPct: 62, toleranceBand: 5, color: "#6366f1", units: 428,  price: 155.52, value: 85209.84 },
    { ticker: "EQQQ", name: "Invesco Nasdaq-100 UCITS ETF",           targetPct: 23, hardCapPct: 31, toleranceBand: 4, color: "#8b5cf6", units: 63,   price: 295.02, value: 23792.85 },
    { ticker: "SEMI", name: "VanEck Semiconductor UCITS ETF",         targetPct: 10, hardCapPct: 15, toleranceBand: 2, color: "#a78bfa", units: 24,   price: 573.79, value: 17628.63 },
    { ticker: "VFEA", name: "Vanguard FTSE Emerging Markets UCITS ETF", targetPct: 8,  hardCapPct: 12, toleranceBand: 2, color: "#c4b5fd", units: 109,  price: 58.94,  value: 8223.72  },
    { ticker: "BTC",  name: "Grayscale Bitcoin Mini ETF",            targetPct: 7,  hardCapPct: 8,  toleranceBand: 1, color: "#f59e0b", units: 154,  price: 33.58,  value: 6620.85  },
  ]

  for (const h of holdings) {
    const hId = cuid()
    const sId = cuid()
    db.prepare(`
      INSERT INTO Holding (id, userId, ticker, name, targetPct, hardCapPct, toleranceBand, color, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(hId, adminId, h.ticker, h.name, h.targetPct, h.hardCapPct, h.toleranceBand, h.color, now, now)
    db.prepare(`
      INSERT INTO Snapshot (id, holdingId, units, price, value, currency, date, createdAt)
      VALUES (?, ?, ?, ?, ?, 'USD', ?, ?)
    `).run(sId, hId, h.units, h.price, h.value, now, now)
  }

  // Governance rules (abbreviated — full set seeded via prisma/seed.ts for local dev)
  const rules = [
    ["VWRA — Healthy Range 45–57%", "VWRA target 52%. Healthy range 45–57%. Soft drift below 45% or above 57% — redirect contributions. Hard drift below 40% or above 62% — rebalance review required.", "VWRA Governance"],
    ["VWRA — Diversification Anchor", "VWRA is the diversification anchor, behavioural stabiliser, and anti-fragility layer.", "VWRA Governance"],
    ["VWRA Underweight Response", "Portfolio is becoming excessively thematic. Redirect all contributions toward VWRA until restored to healthy range.", "VWRA Governance"],
    ["VWRA Overweight Response", "Portfolio is becoming excessively defensive. Redirect contributions toward EQQQ to restore balance.", "VWRA Governance"],
    ["EQQQ — Healthy Range 19–27%", "EQQQ target 23%. Healthy range 19–27%. Soft drift below 19% or above 27%. Hard drift below 16% or above 31%.", "EQQQ Governance"],
    ["EQQQ — Digital Economy Engine", "EQQQ is the portfolio's dominant long-term growth engine — software, cloud, AI monetisation, enterprise digitisation.", "EQQQ Governance"],
    ["EQQQ Underweight Response", "Portfolio is underexposed to digital expansion. Increase contributions to EQQQ.", "EQQQ Governance"],
    ["EQQQ Overweight Response", "Portfolio is excessively US mega-cap dependent. Pause incremental EQQQ accumulation.", "EQQQ Governance"],
    ["SEMI — Healthy Range 8–12%", "SEMI target 10%. Healthy range 8–12%. Soft drift above 12% — halt accumulation. Hard drift above 15% — selectively trim.", "SEMI Governance"],
    ["SEMI — AI Infrastructure Tilt Identity Rule", "SEMI is a targeted AI infrastructure tilt, not the portfolio foundation. Semiconductor concentration must never become the dominant portfolio risk factor.", "SEMI Governance"],
    ["VFEA — Healthy Range 6–10%", "VFEA target 8%. Healthy range 6–10%. Soft drift below 6% or above 10%. Hard drift below 4% or above 12%.", "VFEA Governance"],
    ["BTC — Healthy Range 5–8%", "BTC target 7%. Healthy range 5–8%. Soft drift above 8%. Hard drift above 8% — trim toward 7% target.", "BTC Governance"],
    ["BTC — Optionality Overlay Identity Rule", "BTC is asymmetric optionality — not defensive capital, not retirement infrastructure. Must never become the largest or second-largest holding.", "BTC Governance"],
    ["Semiconductor Dependency — Cap 16%/20%", "Total semiconductor exposure must remain below 16%. Elevated 16–20%: pause SEMI accumulation. Excessive above 20%: halt SEMI; redirect to VWRA.", "Overlap & Concentration"],
    ["Digital Economy Dependency — Cap 48%/54%", "Combined digital economy exposure must remain below 48%. Elevated 48–54%: increase VWRA/VFEA. Excessive above 54%: halt EQQQ and SEMI.", "Overlap & Concentration"],
    ["US Market Dependency — Cap 70%/78%", "Total effective US exposure must remain below 70%. Elevated 70–78%: prioritise VWRA and VFEA. Excessive above 78%: pause all tech concentration increases.", "Overlap & Concentration"],
    ["AI Infrastructure Cluster — Cap 38%/46%", "Combined AI infrastructure exposure must remain below 38%. Elevated 38–46%: reduce SEMI; favour VWRA. Excessive above 46%: halt SEMI; reduce EQQQ.", "Overlap & Concentration"],
    ["Nvidia Exposure Cap — Soft 10%, Hard 13%", "Effective Nvidia look-through exposure: soft cap 10%, hard cap 13%. Hard breach: pause all SEMI and EQQQ accumulation.", "Overlap & Concentration"],
    ["Microsoft Exposure Cap — Soft 10%, Hard 13%", "Effective Microsoft look-through exposure: soft cap 10%, hard cap 13%. Hard breach: pause EQQQ accumulation; redirect to VWRA.", "Overlap & Concentration"],
    ["Apple Exposure Cap — Soft 8%, Hard 11%", "Effective Apple look-through exposure: soft cap 8%, hard cap 11%.", "Overlap & Concentration"],
    ["Amazon Exposure Cap — Soft 7%, Hard 9%", "Effective Amazon look-through exposure: soft cap 7%, hard cap 9%.", "Overlap & Concentration"],
    ["Meta & Alphabet Exposure Cap — Soft 6%, Hard 8%", "Effective Meta and Alphabet look-through exposure: soft cap 6% each, hard cap 8% each.", "Overlap & Concentration"],
    ["Broadcom & TSMC Exposure Cap — Soft 5%, Hard 7%", "Effective Broadcom and TSMC look-through exposure: soft cap 5% each, hard cap 7% each.", "Overlap & Concentration"],
    ["Redundant ETF Prevention", "Permanently excluded: VGT, FTEC, XLK, SOXX, IGV, and similar overlapping technology ETFs.", "Overlap & Concentration"],
    ["Rebalancing Priority Order", "Step 1: redirect contributions. Step 2: pause accumulation in overweight. Step 3: selective trimming only at hard thresholds. Step 4: avoid wholesale redesign.", "Rebalancing"],
    ["Review and Rebalance Cadence", "Monthly glance. Quarterly strategic review. Formal rebalance: annual in January unless hard thresholds breached. Emergency trigger: portfolio falls >25%.", "Rebalancing"],
    ["Market Timing Ban", "No tactical allocation shifts based on headlines, elections, macro predictions, or short-term underperformance.", "Behavioural Guards"],
    ["Panic Selling Prohibition", "No sells during drawdowns without a 48-hour cooling-off period and a rule-based justification.", "Behavioural Guards"],
    ["Redesign Moratorium", "No structural portfolio changes within 90 days of the last structural change.", "Behavioural Guards"],
    ["Approved Reasons for Strategy Changes", "Allowed: major life changes, retirement horizon changes, liquidity requirements. NOT allowed: headlines, boredom, temporary underperformance.", "Behavioural Guards"],
    ["Market Crash Protocol", "Drawdown >10%: normal, continue. >25%: maintain schedule; check monthly only. >40%: do not open portfolio more than monthly; do not sell.", "Behavioural Guards"],
    ["Manual Execution Only", "All trades require manual execution within approved dealing windows and employer pre-approval where required by firm policy.", "Compliance"],
    ["Monthly Execution Cadence", "Monthly workflow: confirm window, review allocation, check concentration, generate contribution plan, execute manually, log transaction.", "Compliance"],
    ["Emergency Reserve Rule", "Maintain adequate emergency reserves outside the investment portfolio at all times. No withdrawals before 2045 except in documented extraordinary circumstances.", "Compliance"],
  ]

  const insertRule = db.prepare(`
    INSERT INTO GovernanceRule (id, title, description, category, active, createdAt)
    VALUES (?, ?, ?, ?, 1, ?)
  `)
  for (const [title, description, category] of rules) {
    insertRule.run(cuid(), title, description, category, now)
  }

  db.close()
  console.log(`[init-db] Seeded: ${adminEmail} · ${holdings.length} holdings · ${rules.length} governance rules`)
  console.log(`[init-db] Done.`)
}

main().catch((err) => {
  console.error("[init-db] Fatal:", err)
  process.exit(1)
})
