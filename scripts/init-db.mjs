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

    CREATE TABLE IF NOT EXISTS IbkrLedgerEntry (
      id          TEXT PRIMARY KEY,
      userId      TEXT NOT NULL,
      externalId  TEXT NOT NULL,
      category    TEXT NOT NULL,
      symbol      TEXT,
      amount      REAL NOT NULL,
      currency    TEXT NOT NULL,
      amountBase  REAL,
      fxRate      REAL,
      date        DATETIME NOT NULL,
      description TEXT,
      rawType     TEXT,
      createdAt   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE,
      UNIQUE (userId, externalId)
    );
    CREATE INDEX IF NOT EXISTS IbkrLedgerEntry_userId_date_idx ON IbkrLedgerEntry(userId, date);
    CREATE INDEX IF NOT EXISTS IbkrLedgerEntry_userId_category_idx ON IbkrLedgerEntry(userId, category);
  `)

  // SQLite has no portable ADD COLUMN IF NOT EXISTS. Inspect first so startup remains
  // idempotent on both old Railway volumes and newly-created databases.
  function ensureColumn(table, column, definition) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name)
    if (columns.length === 0) return
    if (!columns.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
  ensureColumn("Snapshot", "costBasis", "REAL")
  ensureColumn("Snapshot", "unrealizedPnl", "REAL")
  ensureColumn("Trade", "commission", "REAL NOT NULL DEFAULT 0")
  ensureColumn("Trade", "realizedPnl", "REAL")
  ensureColumn("Trade", "netCash", "REAL")

  console.log("[init-db] Schema ready.")

  // ── Seed only if no users exist ───────────────────────────────────────────
  const userCount = db.prepare("SELECT COUNT(*) as c FROM User").get()
  if (userCount.c > 0) {
    console.log(`[init-db] ${userCount.c} user(s) found — skipping seed.`)
    db.close()
    return
  }

  console.log("[init-db] No users found — seeding initial data...")

  const adminEmail = process.env.ADMIN_EMAIL
  const adminPassword = process.env.ADMIN_PASSWORD
  const adminName = process.env.ADMIN_NAME ?? "Portfolio Owner"

  if (!adminEmail || !adminPassword) {
    throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD are required when seeding a new database")
  }
  if (adminPassword.length < 14) {
    throw new Error("ADMIN_PASSWORD must be at least 14 characters")
  }

  const passwordHash = await hashPassword(adminPassword)
  const adminId = cuid()
  const now = new Date().toISOString()

  db.prepare(`
    INSERT INTO User (id, email, name, passwordHash, role, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, 'admin', ?, ?)
  `).run(adminId, adminEmail, adminName, passwordHash, now, now)

  // Atlas Core Constitution v3.1 holdings. New databases begin empty; live values arrive from IBKR.
  const holdings = [
    { ticker: "IMID", name: "SPDR MSCI ACWI IMI UCITS ETF", targetPct: 52, hardCapPct: 62, toleranceBand: 5, color: "#6366f1", units: 0, price: 0, value: 0 },
    { ticker: "IWQU", name: "iShares Edge MSCI World Quality Factor UCITS ETF", targetPct: 29, hardCapPct: 35, toleranceBand: 5, color: "#06b6d4", units: 0, price: 0, value: 0 },
    { ticker: "EQAC", name: "Invesco EQQQ Nasdaq-100 UCITS ETF Acc", targetPct: 10, hardCapPct: 15, toleranceBand: 3, color: "#8b5cf6", units: 0, price: 0, value: 0 },
    { ticker: "SMH", name: "VanEck Semiconductor UCITS ETF", targetPct: 4, hardCapPct: 8, toleranceBand: 2, color: "#a78bfa", units: 0, price: 0, value: 0 },
    { ticker: "BTC", name: "Bitcoin sleeve", targetPct: 5, hardCapPct: 8, toleranceBand: 2, color: "#f59e0b", units: 0, price: 0, value: 0 },
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

  // Governance rules derived from Atlas Core Constitution v3.1.
  const rules = [
    ["Constitutional holdings", "IMID 52%, IWQU 29%, EQAC 10%, SMH 4%, Bitcoin sleeve 5%.", "Portfolio"],
    ["Contribution-first rebalancing", "Route settled cash to the furthest-underweight eligible holding; sell only for a hard breach or approved legacy migration.", "Rebalancing"],
    ["Whole-share DCA bank", "Reserve commission, buy whole shares, and carry unused proceeds into the next contribution cycle.", "Rebalancing"],
    ["Combined growth-satellite limit", "EQAC plus SMH: 16% watch level and 18% hard cap. EQAC plus SMH plus Bitcoin: 24% hard cap.", "Overlap & Concentration"],
    ["Look-through limits", "Refresh company, sector, industry, asset and country sources quarterly. Look-through limits override ticker-level comfort.", "Overlap & Concentration"],
    ["Rebalancing Priority Order", "Step 1: redirect contributions. Step 2: pause accumulation in overweight. Step 3: selective trimming only at hard thresholds. Step 4: avoid wholesale redesign.", "Rebalancing"],
    ["Review cadence", "Monthly reconciliation and DCA; quarterly source refresh; annual constitutional review.", "Rebalancing"],
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
