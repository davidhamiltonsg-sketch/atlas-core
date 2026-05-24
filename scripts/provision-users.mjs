/**
 * One-time user provisioning script.
 * Run with: node scripts/provision-users.mjs
 */
import Database from "better-sqlite3"
import { randomBytes } from "crypto"
import { existsSync } from "fs"
import { resolve } from "path"

function getDbPath() {
  const url = process.env.DATABASE_URL ?? "file:./prisma/atlas.db"
  if (url.startsWith("file:")) {
    const filePath = url.slice(5)
    return filePath.startsWith("/") ? filePath : resolve(process.cwd(), filePath)
  }
  return resolve(process.cwd(), "prisma/atlas.db")
}

function cuid() {
  const ts = Date.now().toString(36)
  const rand = randomBytes(8).toString("hex")
  return `c${ts}${rand}`
}

async function hashPassword(password) {
  const { default: bcrypt } = await import("bcryptjs")
  return bcrypt.hash(password, 12)
}

const users = [
  { email: "davidhamiltonsg@gmail.com", name: "David", password: "Atlas2025", role: "admin" },
  { email: "dutzsm@gmail.com",          name: "Dami",  password: "Atlas2026", role: "user"  },
]

async function main() {
  const dbPath = getDbPath()
  if (!existsSync(dbPath)) {
    console.error(`[provision] DB not found at ${dbPath} — run the app first.`)
    process.exit(1)
  }

  const db = new Database(dbPath)
  db.pragma("journal_mode = WAL")
  db.pragma("foreign_keys = ON")

  const now = new Date().toISOString()

  for (const u of users) {
    const passwordHash = await hashPassword(u.password)
    const existing = db.prepare("SELECT id FROM User WHERE email = ?").get(u.email)

    if (existing) {
      db.prepare(`
        UPDATE User SET name = ?, passwordHash = ?, role = ?, updatedAt = ? WHERE email = ?
      `).run(u.name, passwordHash, u.role, now, u.email)
      console.log(`[provision] Updated: ${u.email}`)
    } else {
      // New user — copy holding structure (zero positions) from admin
      const adminRow = db.prepare("SELECT id FROM User WHERE role = 'admin' LIMIT 1").get()
      const newId = cuid()

      db.prepare(`
        INSERT INTO User (id, email, name, passwordHash, role, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(newId, u.email, u.name, passwordHash, u.role, now, now)

      if (adminRow) {
        const adminHoldings = db.prepare("SELECT * FROM Holding WHERE userId = ?").all(adminRow.id)
        for (const h of adminHoldings) {
          const hId = cuid()
          db.prepare(`
            INSERT INTO Holding (id, userId, ticker, name, targetPct, hardCapPct, toleranceBand, color, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(hId, newId, h.ticker, h.name, h.targetPct, h.hardCapPct, h.toleranceBand, h.color, now, now)
        }
        console.log(`[provision] Created: ${u.email} (${adminHoldings.length} holdings cloned)`)
      } else {
        console.log(`[provision] Created: ${u.email} (no admin holdings to clone)`)
      }
    }
  }

  db.close()
  console.log("[provision] Done.")
}

main().catch((err) => {
  console.error("[provision] Fatal:", err)
  process.exit(1)
})
